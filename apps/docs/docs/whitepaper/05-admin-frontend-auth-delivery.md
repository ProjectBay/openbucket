# 5. Admin API, Frontend, Auth Flow & Delivery

This section specifies the JSON admin API that lives at `/api/admin/*`, the Angular SPA that lives at `/admin/*`, the authentication flow that ties them together, and the build pipeline that produces the single Docker image carrying both. The S3 wire protocol (everything else on port 9000) is owned by the S3 agent and only referenced where its boundary touches admin code.

The admin surface is single-tenant: one admin user record, one pair of root S3 access keys, no roles. The endpoints for sub-keys are defined so a future role model drops in without breaking the wire shape [see §2 of `ARCHITECTURE.md`].

---

## 5.1 Admin module tree

`AdminModule` is the root of the `/api/admin/*` controller tree. It imports five feature modules and one global JWT guard. Domain logic is never reimplemented here — every controller is a thin adapter over a domain service from `apps/backend/src/domain/*` [see §1 of `BACKEND-DESIGN.md`].

```
apps/backend/src/admin/
  admin.module.ts
  auth/
    auth.module.ts
    auth.controller.ts
    auth.service.ts
    jwt-auth.guard.ts
    jwt.strategy.ts
    refresh-token.service.ts
    dto/
      login.dto.ts
      login-response.dto.ts
      me-response.dto.ts
  buckets/
    buckets-admin.module.ts
    buckets-admin.controller.ts
    dto/
      create-bucket.dto.ts
      bucket-summary.dto.ts
      list-buckets-response.dto.ts
  objects/
    objects-admin.module.ts
    objects-admin.controller.ts
    dto/
      list-objects-query.dto.ts
      list-objects-response.dto.ts
      object-meta.dto.ts
  keys/
    keys-admin.module.ts
    keys-admin.controller.ts
    dto/
      create-key.dto.ts
      key-summary.dto.ts
      created-key.dto.ts
  settings/
    settings-admin.module.ts
    settings-admin.controller.ts
    dto/
      change-password.dto.ts
      settings.dto.ts
  audit/
    audit.service.ts        // structured admin-event emitter
  bootstrap/
    admin-bootstrap.service.ts   // first-run admin user seeding
```

### 5.1.1 `admin.module.ts`

```ts
// apps/backend/src/admin/admin.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import { AuthModule } from './auth/auth.module';
import { BucketsAdminModule } from './buckets/buckets-admin.module';
import { ObjectsAdminModule } from './objects/objects-admin.module';
import { KeysAdminModule } from './keys/keys-admin.module';
import { SettingsAdminModule } from './settings/settings-admin.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { AuditService } from './audit/audit.service';
import { AdminBootstrapService } from './bootstrap/admin-bootstrap.service';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    AuthModule,
    BucketsAdminModule,
    ObjectsAdminModule,
    KeysAdminModule,
    SettingsAdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    AuditService,
    AdminBootstrapService,
  ],
  exports: [AuditService],
})
export class AdminModule {}
```

The `APP_GUARD` binding makes `JwtAuthGuard` global — every admin route is authenticated unless the controller method is marked `@Public()`. Login and refresh use that decorator.

The throttler default (`100/min` per IP) covers normal traffic; the login endpoint overrides it to `5/min`.

---

## 5.2 Authentication endpoints

The admin auth flow uses two tokens [see §4.1 of `BACKEND-DESIGN.md`]:

1. **Access token** — HS256-signed JWT, 15-minute lifetime, carried in `Authorization: Bearer ...`. Held in Angular memory only.
2. **Refresh token** — opaque 256-bit value, 7-day lifetime, delivered as `Set-Cookie: ob_refresh=...; HttpOnly; Secure; SameSite=Strict; Path=/api/admin/auth`. Stored hashed (argon2id) in the `refresh_tokens` table. Rotated on every use.

Token reuse is treated as a compromise signal: if a refresh token that has already been rotated is presented again, the entire chain (every descendant) is revoked.

### 5.2.1 `auth.module.ts`

```ts
// apps/backend/src/admin/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { RefreshTokenService } from './refresh-token.service';
import { PersistenceModule } from '../../persistence/persistence.module';
import { AuditService } from '../audit/audit.service';

@Module({
  imports: [
    PassportModule,
    PersistenceModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5, name: 'login' }]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: '15m',
          issuer: 'openbucket',
          audience: 'openbucket-admin',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, RefreshTokenService, AuditService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
```

### 5.2.2 `auth.service.ts`

```ts
// apps/backend/src/admin/auth/auth.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';

import { AdminUserRepository } from '../../persistence/repositories/admin-user.repository';
import { RefreshTokenService } from './refresh-token.service';

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;        // seconds
  refreshToken: string;     // raw value; controller sets cookie
  refreshExpiresAt: Date;
}

@Injectable()
export class AuthService {
  private static readonly ACCESS_TTL_SECONDS = 15 * 60;

  constructor(
    private readonly jwt: JwtService,
    private readonly users: AdminUserRepository,
    private readonly refresh: RefreshTokenService,
  ) {}

  async login(username: string, password: string): Promise<IssuedTokens> {
    const user = await this.users.findByUsername(username);
    if (!user) {
      // Constant-time dummy verify to avoid user-enumeration timing.
      await argon2.verify(
        '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        password,
      ).catch(() => false);
      throw new UnauthorizedException('invalid credentials');
    }

    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('invalid credentials');

    return this.issueTokens(user.id, user.username, user.mustChangePassword);
  }

  async refresh(rawRefreshToken: string): Promise<IssuedTokens> {
    const rotated = await this.refresh.rotate(rawRefreshToken);
    return this.issueTokens(rotated.subjectId, rotated.username, false, rotated.token, rotated.expiresAt);
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (rawRefreshToken) await this.refresh.revoke(rawRefreshToken);
  }

  private async issueTokens(
    subjectId: string,
    username: string,
    mustChangePassword: boolean,
    preIssuedRefreshRaw?: string,
    preIssuedRefreshExpiresAt?: Date,
  ): Promise<IssuedTokens> {
    const accessToken = await this.jwt.signAsync({
      sub: subjectId,
      username,
      mustChangePassword,
    });

    if (preIssuedRefreshRaw && preIssuedRefreshExpiresAt) {
      return {
        accessToken,
        expiresIn: AuthService.ACCESS_TTL_SECONDS,
        refreshToken: preIssuedRefreshRaw,
        refreshExpiresAt: preIssuedRefreshExpiresAt,
      };
    }

    const minted = await this.refresh.mint(subjectId, username);
    return {
      accessToken,
      expiresIn: AuthService.ACCESS_TTL_SECONDS,
      refreshToken: minted.token,
      refreshExpiresAt: minted.expiresAt,
    };
  }
}
```

### 5.2.3 `refresh-token.service.ts`

```ts
// apps/backend/src/admin/auth/refresh-token.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes, createHash } from 'node:crypto';

import { RefreshTokenRepository } from '../../persistence/repositories/refresh-token.repository';

export interface MintedRefresh {
  token: string;        // raw, base64url
  expiresAt: Date;
}

export interface RotatedRefresh extends MintedRefresh {
  subjectId: string;
  username: string;
}

@Injectable()
export class RefreshTokenService {
  private static readonly TTL_MS = 7 * 24 * 60 * 60 * 1000;

  constructor(private readonly repo: RefreshTokenRepository) {}

  async mint(subjectId: string, username: string, rotatedFromId?: string): Promise<MintedRefresh> {
    const raw = randomBytes(32).toString('base64url');
    const lookup = createHash('sha256').update(raw).digest('hex'); // indexed
    const hash = await argon2.hash(raw, { type: argon2.argon2id });
    const expiresAt = new Date(Date.now() + RefreshTokenService.TTL_MS);

    await this.repo.insert({
      lookup,
      hash,
      subjectId,
      username,
      issuedAt: new Date(),
      expiresAt,
      rotatedFromId: rotatedFromId ?? null,
      revokedAt: null,
      rotatedAt: null,
    });

    return { token: raw, expiresAt };
  }

  async rotate(rawToken: string): Promise<RotatedRefresh> {
    const lookup = createHash('sha256').update(rawToken).digest('hex');
    const row = await this.repo.findByLookup(lookup);
    if (!row) throw new UnauthorizedException('invalid refresh');

    if (row.revokedAt) throw new UnauthorizedException('revoked');
    if (row.expiresAt.getTime() < Date.now()) throw new UnauthorizedException('expired');

    if (row.rotatedAt) {
      // Reuse of an already-rotated token — treat as compromise.
      await this.repo.revokeDescendants(row.id);
      throw new UnauthorizedException('token reuse detected');
    }

    const ok = await argon2.verify(row.hash, rawToken);
    if (!ok) throw new UnauthorizedException('invalid refresh');

    await this.repo.markRotated(row.id, new Date());
    const minted = await this.mint(row.subjectId, row.username, row.id);
    return { ...minted, subjectId: row.subjectId, username: row.username };
  }

  async revoke(rawToken: string): Promise<void> {
    const lookup = createHash('sha256').update(rawToken).digest('hex');
    const row = await this.repo.findByLookup(lookup);
    if (!row || row.revokedAt) return;
    await this.repo.revoke(row.id, new Date());
  }
}
```

The `lookup` column is a fast SHA-256 used solely to find the row; the argon2id `hash` is the actual cryptographic gate. Without the indexed lookup we would argon2-verify against every row in the table.

### 5.2.4 `auth.controller.ts`

```ts
// apps/backend/src/admin/auth/auth.controller.ts
import {
  Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { MeResponseDto } from './dto/me-response.dto';
import { AuditService } from '../audit/audit.service';

const REFRESH_COOKIE = 'ob_refresh';

@Controller('api/admin/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ login: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const tokens = await this.auth.login(dto.username, dto.password);
    this.setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
    this.audit.emit({ event: 'admin.login', subject: dto.username, ip: req.ip });
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) throw new UnauthorizedException('missing refresh');
    const tokens = await this.auth.refresh(raw);
    this.setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const raw = req.cookies?.[REFRESH_COOKIE];
    await this.auth.logout(raw);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/admin/auth' });
    this.audit.emit({ event: 'admin.logout', subject: (req as any).user?.username ?? 'unknown' });
  }

  @Get('me')
  me(@Req() req: Request): MeResponseDto {
    const user = (req as any).user as { sub: string; username: string; mustChangePassword: boolean };
    return {
      id: user.sub,
      username: user.username,
      mustChangePassword: user.mustChangePassword,
    };
  }

  private setRefreshCookie(res: Response, value: string, expiresAt: Date): void {
    res.cookie(REFRESH_COOKIE, value, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/api/admin/auth',
      expires: expiresAt,
    });
  }
}
```

`@Public()` is a tiny metadata-only decorator:

```ts
// apps/backend/src/admin/auth/public.decorator.ts
import { SetMetadata } from '@nestjs/common';
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
```

---

## 5.3 `JwtAuthGuard`

The guard sits on `APP_GUARD`. It skips any handler annotated `@Public()`, validates the bearer token, and attaches the decoded payload to `req.user`.

```ts
// apps/backend/src/admin/auth/jwt-auth.guard.ts
import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { IS_PUBLIC_KEY } from './public.decorator';

export interface AdminJwtPayload {
  sub: string;
  username: string;
  mustChangePassword: boolean;
  iat: number;
  exp: number;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    // Only protect /api/admin/* — let S3 and SPA pass.
    if (!req.path.startsWith('/api/admin/')) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('missing bearer');

    const token = header.slice('Bearer '.length).trim();
    try {
      const payload = await this.jwt.verifyAsync<AdminJwtPayload>(token, {
        issuer: 'openbucket',
        audience: 'openbucket-admin',
      });
      (req as any).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('invalid token');
    }
  }
}
```

The path-prefix guard at the top is the safety net: the `AdminModule` is mounted globally, but the S3 and SPA controller trees must never see a `401` from this guard. If they ever share a controller path, the JWT guard is invisible to them.

---

## 5.4 `nestjs-zod` DTO patterns

DTOs are Zod schemas first, classes second. The class is what NestJS uses for DI and Swagger; the schema is what the global `ZodValidationPipe` runs against the request body, query, and params. The backend-architect agent wires the global pipe and applies `patchNestjsSwagger()` in `main.ts`; this section shows what controllers consume.

The general pattern:

```ts
// somewhere/dto/example.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'nestjs-zod/z';

export const ExampleSchema = z.object({
  name: z.string().min(3).max(63),
  count: z.number().int().nonnegative().default(0),
});

export class ExampleDto extends createZodDto(ExampleSchema) {}
```

`createZodDto` produces a class whose static `schema` is the Zod object. `patchNestjsSwagger()` (called once in `main.ts`) walks every controller and emits the schema into the OpenAPI document.

### 5.4.1 `CreateBucketDto`

```ts
// apps/backend/src/admin/buckets/dto/create-bucket.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'nestjs-zod/z';

const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

export const CreateBucketSchema = z
  .object({
    name: z
      .string()
      .min(3)
      .max(63)
      .regex(BUCKET_NAME, 'bucket name must match S3 naming rules'),
    versioning: z.enum(['disabled', 'enabled']).default('disabled'),
    objectLock: z.boolean().default(false),
    region: z.string().default('us-east-1'),
  })
  .strict();

export class CreateBucketDto extends createZodDto(CreateBucketSchema) {}
```

`.strict()` rejects unknown keys — a quiet but important defense against typo'd request bodies silently succeeding.

### 5.4.2 `BucketSummaryDto` / `ListBucketsResponseDto`

```ts
// apps/backend/src/admin/buckets/dto/bucket-summary.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'nestjs-zod/z';

export const BucketSummarySchema = z.object({
  name: z.string(),
  createdAt: z.string().datetime(),
  versioning: z.enum(['disabled', 'enabled', 'suspended']),
  objectLock: z.boolean(),
  objectCount: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
});

export class BucketSummaryDto extends createZodDto(BucketSummarySchema) {}
```

```ts
// apps/backend/src/admin/buckets/dto/list-buckets-response.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'nestjs-zod/z';

import { BucketSummarySchema } from './bucket-summary.dto';

export const ListBucketsResponseSchema = z.object({
  buckets: z.array(BucketSummarySchema),
  total: z.number().int().nonnegative(),
});

export class ListBucketsResponseDto extends createZodDto(ListBucketsResponseSchema) {}
```

Both response and request DTOs flow into the OpenAPI document, which the generator turns into Angular models — no hand-written interfaces on the frontend.

### 5.4.3 `ListObjectsQueryDto`

```ts
// apps/backend/src/admin/objects/dto/list-objects-query.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'nestjs-zod/z';

export const ListObjectsQuerySchema = z.object({
  prefix: z.string().max(1024).optional(),
  delimiter: z.string().max(1).optional(),         // typically '/'
  marker: z.string().max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

export class ListObjectsQueryDto extends createZodDto(ListObjectsQuerySchema) {}
```

`z.coerce.number()` is essential for query strings — Express delivers everything as a string.

---

## 5.5 Admin bucket endpoints

```ts
// apps/backend/src/admin/buckets/buckets-admin.controller.ts
import {
  Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { BucketService } from '../../domain/buckets/bucket.service';
import { ObjectService } from '../../domain/objects/object.service';
import { CreateBucketDto } from './dto/create-bucket.dto';
import { BucketSummaryDto } from './dto/bucket-summary.dto';
import { ListBucketsResponseDto } from './dto/list-buckets-response.dto';
import { AuditService } from '../audit/audit.service';

@Controller('api/admin/buckets')
export class BucketsAdminController {
  constructor(
    private readonly buckets: BucketService,
    private readonly objects: ObjectService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(): Promise<ListBucketsResponseDto> {
    const items = await this.buckets.listWithStats();
    return {
      buckets: items.map((b) => ({
        name: b.name,
        createdAt: b.createdAt.toISOString(),
        versioning: b.versioning,
        objectLock: b.objectLock,
        objectCount: b.stats.objectCount,
        sizeBytes: b.stats.sizeBytes,
      })),
      total: items.length,
    };
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body() dto: CreateBucketDto,
    @Req() req: Request,
  ): Promise<BucketSummaryDto> {
    const bucket = await this.buckets.create({
      name: dto.name,
      versioning: dto.versioning,
      objectLock: dto.objectLock,
      region: dto.region,
    });
    this.audit.emit({
      event: 'bucket.created',
      subject: (req as any).user.username,
      bucket: bucket.name,
      requestId: (req as any).requestId,
    });
    return {
      name: bucket.name,
      createdAt: bucket.createdAt.toISOString(),
      versioning: bucket.versioning,
      objectLock: bucket.objectLock,
      objectCount: 0,
      sizeBytes: 0,
    };
  }

  @Get(':name')
  async get(@Param('name') name: string): Promise<BucketSummaryDto> {
    const bucket = await this.buckets.findByName(name);
    if (!bucket) throw new NotFoundException(`bucket ${name} not found`);
    const stats = await this.objects.statsFor(name);
    return {
      name: bucket.name,
      createdAt: bucket.createdAt.toISOString(),
      versioning: bucket.versioning,
      objectLock: bucket.objectLock,
      objectCount: stats.objectCount,
      sizeBytes: stats.sizeBytes,
    };
  }

  @Delete(':name')
  @HttpCode(204)
  async delete(
    @Param('name') name: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.buckets.deleteByName(name);   // throws BucketNotEmpty if non-empty
    this.audit.emit({
      event: 'bucket.deleted',
      subject: (req as any).user.username,
      bucket: name,
      requestId: (req as any).requestId,
    });
  }
}
```

`BucketService` and `ObjectService` are the same domain services the S3 controllers call. The admin controller is a thin shape adapter — no business rules live here.

---

## 5.6 Admin object browser endpoints

```ts
// apps/backend/src/admin/objects/objects-admin.controller.ts
import {
  Controller, Delete, Get, HttpCode, NotFoundException, Param, Query, Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { ObjectService } from '../../domain/objects/object.service';
import { ListObjectsQueryDto } from './dto/list-objects-query.dto';
import { ListObjectsResponseDto } from './dto/list-objects-response.dto';
import { ObjectMetaDto } from './dto/object-meta.dto';
import { AuditService } from '../audit/audit.service';

@Controller('api/admin/buckets/:name/objects')
export class ObjectsAdminController {
  constructor(
    private readonly objects: ObjectService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(
    @Param('name') bucket: string,
    @Query() q: ListObjectsQueryDto,
  ): Promise<ListObjectsResponseDto> {
    const page = await this.objects.list({
      bucket,
      prefix: q.prefix,
      delimiter: q.delimiter,
      marker: q.marker,
      limit: q.limit,
    });
    return {
      bucket,
      prefix: q.prefix ?? '',
      delimiter: q.delimiter,
      marker: q.marker,
      nextMarker: page.nextMarker,
      isTruncated: page.isTruncated,
      contents: page.contents.map((o) => ({
        key: o.key,
        size: o.size,
        etag: o.etag,
        lastModified: o.lastModified.toISOString(),
        storageClass: o.storageClass,
      })),
      commonPrefixes: page.commonPrefixes,
    };
  }

  @Get(':key(*)/meta')
  async meta(
    @Param('name') bucket: string,
    @Param('key') key: string,
  ): Promise<ObjectMetaDto> {
    const obj = await this.objects.head(bucket, decodeURIComponent(key));
    if (!obj) throw new NotFoundException();
    return {
      key: obj.key,
      bucket,
      size: obj.size,
      etag: obj.etag,
      contentType: obj.contentType,
      contentEncoding: obj.contentEncoding,
      lastModified: obj.lastModified.toISOString(),
      userMetadata: obj.userMetadata,
      tagging: obj.tagging,
      versionId: obj.versionId,
      storageClass: obj.storageClass,
    };
  }

  @Delete(':key(*)')
  @HttpCode(204)
  async delete(
    @Param('name') bucket: string,
    @Param('key') key: string,
    @Req() req: Request,
  ): Promise<void> {
    const decoded = decodeURIComponent(key);
    await this.objects.delete(bucket, decoded);
    this.audit.emit({
      event: 'object.deleted',
      subject: (req as any).user.username,
      bucket,
      key: decoded,
      requestId: (req as any).requestId,
    });
  }
}
```

The `:key(*)` route param captures slash-bearing object keys (`folder/sub/file.txt`). The client URL-encodes the key before sending; the controller `decodeURIComponent`s it once. Double-decode bugs are avoided by encoding exactly once on the client side (see §5.13).

---

## 5.7 Access-key management

```ts
// apps/backend/src/admin/keys/keys-admin.controller.ts
import {
  Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { KeyService } from '../../domain/keys/key.service';
import { CreateKeyDto } from './dto/create-key.dto';
import { CreatedKeyDto } from './dto/created-key.dto';
import { KeySummaryDto } from './dto/key-summary.dto';
import { UpdateKeyDto } from './dto/update-key.dto';
import { AuditService } from '../audit/audit.service';

@Controller('api/admin/keys')
export class KeysAdminController {
  constructor(
    private readonly keys: KeyService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(): Promise<KeySummaryDto[]> {
    const rows = await this.keys.list();
    return rows.map((k) => ({
      id: k.id,
      accessKeyId: k.accessKeyId,
      label: k.label,
      role: k.role,                   // 'root' for v1
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      disabled: k.disabled,
    }));
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body() dto: CreateKeyDto,
    @Req() req: Request,
  ): Promise<CreatedKeyDto> {
    const created = await this.keys.create({ label: dto.label, role: 'root' });
    this.audit.emit({
      event: 'key.created',
      subject: (req as any).user.username,
      keyId: created.id,
      requestId: (req as any).requestId,
    });
    // SECURITY: secretAccessKey is returned ONCE. Never persisted in plaintext;
    // never returned again on any other endpoint.
    return {
      id: created.id,
      accessKeyId: created.accessKeyId,
      secretAccessKey: created.secretAccessKey,
      label: created.label,
      role: created.role,
      createdAt: created.createdAt.toISOString(),
    };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateKeyDto,
    @Req() req: Request,
  ): Promise<KeySummaryDto> {
    const updated = await this.keys.update(id, { disabled: dto.disabled, label: dto.label });
    if (!updated) throw new NotFoundException();
    this.audit.emit({
      event: dto.disabled === true ? 'key.disabled' : 'key.updated',
      subject: (req as any).user.username,
      keyId: id,
      requestId: (req as any).requestId,
    });
    return {
      id: updated.id,
      accessKeyId: updated.accessKeyId,
      label: updated.label,
      role: updated.role,
      createdAt: updated.createdAt.toISOString(),
      lastUsedAt: updated.lastUsedAt?.toISOString() ?? null,
      disabled: updated.disabled,
    };
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string, @Req() req: Request): Promise<void> {
    await this.keys.delete(id);
    this.audit.emit({
      event: 'key.deleted',
      subject: (req as any).user.username,
      keyId: id,
      requestId: (req as any).requestId,
    });
  }
}
```

The `role` field is hard-coded to `'root'` on creation in v1 and exposed in responses so the frontend already renders the column. When sub-keys ship, the schema gains `role: z.enum(['root', 'app'])` and `policy: z.string().optional()`, and no controller path moves.

`CreateKeyDto` and `UpdateKeyDto` are trivial:

```ts
// apps/backend/src/admin/keys/dto/create-key.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'nestjs-zod/z';

export const CreateKeySchema = z.object({
  label: z.string().min(1).max(128),
}).strict();

export class CreateKeyDto extends createZodDto(CreateKeySchema) {}
```

```ts
// apps/backend/src/admin/keys/dto/update-key.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'nestjs-zod/z';

export const UpdateKeySchema = z.object({
  label: z.string().min(1).max(128).optional(),
  disabled: z.boolean().optional(),
}).strict().refine((v) => v.label !== undefined || v.disabled !== undefined, {
  message: 'at least one field required',
});

export class UpdateKeyDto extends createZodDto(UpdateKeySchema) {}
```

---

## 5.8 Initial admin bootstrap

`AdminBootstrapService` runs in `OnApplicationBootstrap`. Three branches:

1. **`ADMIN_PASSWORD_HASH` env is set** — write/update the admin user row with that hash directly and `mustChangePassword = false`. Lets ops control credentials via the orchestrator.
2. **No admin user row, no env override** — generate a random 24-char temporary password, hash it with argon2id, persist with `mustChangePassword = true`, and log the plaintext to stdout exactly once. The line is intentionally easy to grep (`docker logs openbucket | grep TEMP-ADMIN-PASSWORD`).
3. **Admin user row exists, no env override** — do nothing.

```ts
// apps/backend/src/admin/bootstrap/admin-bootstrap.service.ts
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

import { AdminUserRepository } from '../../persistence/repositories/admin-user.repository';

@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    private readonly users: AdminUserRepository,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const envHash = this.config.get<string>('ADMIN_PASSWORD_HASH');

    if (envHash) {
      await this.users.upsert({
        username: 'admin',
        passwordHash: envHash,
        mustChangePassword: false,
      });
      this.logger.log('Admin user provisioned from ADMIN_PASSWORD_HASH env.');
      return;
    }

    const existing = await this.users.findByUsername('admin');
    if (existing) return;

    const tempPassword = this.generateTempPassword();
    const hash = await argon2.hash(tempPassword, { type: argon2.argon2id });

    await this.users.insert({
      username: 'admin',
      passwordHash: hash,
      mustChangePassword: true,
    });

    // Visible in `docker logs`. Logged once, at startup, when no user exists.
    // The pino logger is configured to NOT redact this single field.
    this.logger.warn(
      `TEMP-ADMIN-PASSWORD username=admin password=${tempPassword} ` +
      `change-on-first-login=true`,
    );
  }

  private generateTempPassword(): string {
    return randomBytes(18).toString('base64url'); // 24 chars
  }
}
```

The change-on-first-login flow lives in `SettingsAdminController`:

```ts
// apps/backend/src/admin/settings/settings-admin.controller.ts
import { Body, Controller, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import * as argon2 from 'argon2';

import { AdminUserRepository } from '../../persistence/repositories/admin-user.repository';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuditService } from '../audit/audit.service';

@Controller('api/admin/settings')
export class SettingsAdminController {
  constructor(
    private readonly users: AdminUserRepository,
    private readonly audit: AuditService,
  ) {}

  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    const subject = (req as any).user as { sub: string; username: string };
    const user = await this.users.findById(subject.sub);
    if (!user) throw new UnauthorizedException();

    const ok = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!ok) throw new UnauthorizedException('current password incorrect');

    const newHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });
    await this.users.update(user.id, { passwordHash: newHash, mustChangePassword: false });

    this.audit.emit({
      event: 'admin.password.changed',
      subject: user.username,
      requestId: (req as any).requestId,
    });
  }
}
```

The JWT `mustChangePassword` claim drives the SPA to a forced-rotation screen on login. The bearer token is still valid for normal `/api/admin/*` calls; the SPA enforces the redirect on the client side. Defense-in-depth at the API level is deferred to v2 (mustChangePassword is currently advisory, since the only data the user could mutate before rotating is their own password).

---

## 5.9 Audit logging

Every state-changing admin call emits a structured event via Pino. `AuditService` is a thin wrapper that guarantees the standard fields (timestamp, `requestId`, `subject`) are populated.

```ts
// apps/backend/src/admin/audit/audit.service.ts
import { Injectable, Logger } from '@nestjs/common';

export interface AuditEvent {
  event: string;
  subject: string;
  requestId?: string;
  [k: string]: unknown;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('admin.audit');

  emit(event: AuditEvent): void {
    // nestjs-pino flattens the second argument into the JSON record.
    this.logger.log({ ...event, audit: true });
  }
}
```

### Canonical event catalogue (v1)

| Event | Emitted when | Required fields |
|---|---|---|
| `admin.login` | successful login | `subject`, `ip` |
| `admin.login.failed` | failed login attempt | `username`, `ip` (no `subject` if unknown) |
| `admin.logout` | logout call | `subject` |
| `admin.password.changed` | password rotated | `subject` |
| `bucket.created` | new bucket | `subject`, `bucket` |
| `bucket.deleted` | bucket dropped | `subject`, `bucket` |
| `bucket.versioning.changed` | versioning toggled | `subject`, `bucket`, `from`, `to` |
| `object.deleted` | object purge via admin | `subject`, `bucket`, `key` |
| `key.created` | access key minted | `subject`, `keyId` |
| `key.disabled` | access key disabled | `subject`, `keyId` |
| `key.updated` | access key edited | `subject`, `keyId` |
| `key.deleted` | access key removed | `subject`, `keyId` |
| `settings.changed` | settings update | `subject`, `field` |

Read-only calls (`GET`) are not audited at v1 — they would dwarf the event stream. The `requestId` field is set by the backend-architect agent's request-id middleware.

---

## 5.10 Angular SPA structure

```
apps/frontend/src/app/
  app.config.ts
  app.routes.ts
  app.component.ts
  auth/
    login.component.ts
    force-rotate.component.ts
    auth.service.ts
    auth.guard.ts
    auth.interceptor.ts
  buckets/
    bucket-list.component.ts
    bucket-detail.component.ts
    bucket-create-dialog.component.ts
    buckets.signal-store.ts
  objects/
    object-browser.component.ts
    object-row.component.ts
    object-breadcrumb.component.ts
    object-upload.component.ts
    objects.signal-store.ts
  keys/
    keys-list.component.ts
    key-create-dialog.component.ts
    key-secret-once-dialog.component.ts
    keys.signal-store.ts
  settings/
    settings.component.ts
    change-password.component.ts
  shared/
    layout/shell.component.ts
    layout/topbar.component.ts
    layout/sidenav.component.ts
    ui/byte-size.pipe.ts
    ui/relative-time.pipe.ts
    ui/confirm-dialog.component.ts
    api/api-client.providers.ts
  app.routes.ts
  main.ts
```

Every component is standalone (Angular 18+). The app uses signals for local state and a small signal-store pattern (see §5.15) for cross-component state.

Standalone bootstrap:

```ts
// apps/frontend/src/main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
```

```ts
// apps/frontend/src/app/app.config.ts
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors, withFetch } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './auth/auth.interceptor';
import { provideApiClient } from './shared/api/api-client.providers';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    provideApiClient(),
  ],
};
```

---

## 5.11 Routing

```ts
// apps/frontend/src/app/app.routes.ts
import { Routes } from '@angular/router';
import { authGuard, unauthGuard, mustNotRotateGuard } from './auth/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'buckets' },

  {
    path: 'login',
    canActivate: [unauthGuard],
    loadComponent: () =>
      import('./auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'force-rotate',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./auth/force-rotate.component').then((m) => m.ForceRotateComponent),
  },

  {
    path: '',
    canActivate: [authGuard, mustNotRotateGuard],
    loadComponent: () =>
      import('./shared/layout/shell.component').then((m) => m.ShellComponent),
    children: [
      {
        path: 'buckets',
        loadComponent: () =>
          import('./buckets/bucket-list.component').then((m) => m.BucketListComponent),
      },
      {
        path: 'buckets/:name',
        loadComponent: () =>
          import('./buckets/bucket-detail.component').then((m) => m.BucketDetailComponent),
      },
      {
        path: 'buckets/:name/browse',
        loadComponent: () =>
          import('./objects/object-browser.component').then((m) => m.ObjectBrowserComponent),
      },
      {
        path: 'keys',
        loadComponent: () =>
          import('./keys/keys-list.component').then((m) => m.KeysListComponent),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./settings/settings.component').then((m) => m.SettingsComponent),
      },
    ],
  },

  { path: '**', redirectTo: 'buckets' },
];
```

```ts
// apps/frontend/src/app/auth/auth.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthenticated()) return true;
  return router.createUrlTree(['/login']);
};

export const unauthGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isAuthenticated() ? router.createUrlTree(['/buckets']) : true;
};

export const mustNotRotateGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.mustChangePassword() ? router.createUrlTree(['/force-rotate']) : true;
};
```

The router is mounted under `/admin` by the backend's static-serve module [see §8.3 of `BACKEND-DESIGN.md`]; Angular's `base href` is set to `/admin/` at build time:

```jsonc
// apps/frontend/project.json (excerpt)
"build": {
  "executor": "@angular-devkit/build-angular:application",
  "options": {
    "baseHref": "/admin/",
    "outputPath": "dist/apps/frontend"
  }
}
```

---

## 5.12 Auth state — `AuthService` and HTTP interceptor

The access token never touches `localStorage`. It lives in a private signal in `AuthService` for the lifetime of the page. On a hard reload, the SPA calls `/api/admin/auth/refresh` first thing; the browser sends the HttpOnly cookie, the backend returns a fresh access token, and the SPA proceeds. If refresh fails, the user lands on `/login`.

```ts
// apps/frontend/src/app/auth/auth.service.ts
import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

interface LoginResponse {
  accessToken: string;
  expiresIn: number;
}

interface MeResponse {
  id: string;
  username: string;
  mustChangePassword: boolean;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly accessToken = signal<string | null>(null);
  private readonly me = signal<MeResponse | null>(null);

  readonly isAuthenticated = computed(() => this.accessToken() !== null);
  readonly mustChangePassword = computed(() => this.me()?.mustChangePassword === true);
  readonly username = computed(() => this.me()?.username ?? null);

  getAccessToken(): string | null {
    return this.accessToken();
  }

  async login(username: string, password: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<LoginResponse>('/api/admin/auth/login', { username, password }, {
        withCredentials: true,
      }),
    );
    this.accessToken.set(res.accessToken);
    await this.loadMe();
    await this.router.navigate([this.mustChangePassword() ? '/force-rotate' : '/buckets']);
  }

  /**
   * Calls the refresh endpoint exactly once. Used both at app start and by the
   * HTTP interceptor on 401. The HttpOnly cookie carries the refresh token.
   */
  async refresh(): Promise<boolean> {
    try {
      const res = await firstValueFrom(
        this.http.post<LoginResponse>('/api/admin/auth/refresh', {}, {
          withCredentials: true,
        }),
      );
      this.accessToken.set(res.accessToken);
      if (!this.me()) await this.loadMe();
      return true;
    } catch {
      this.accessToken.set(null);
      this.me.set(null);
      return false;
    }
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post('/api/admin/auth/logout', {}, { withCredentials: true }),
      );
    } finally {
      this.accessToken.set(null);
      this.me.set(null);
      await this.router.navigate(['/login']);
    }
  }

  private async loadMe(): Promise<void> {
    const me = await firstValueFrom(this.http.get<MeResponse>('/api/admin/auth/me'));
    this.me.set(me);
  }
}
```

The interceptor injects the bearer header on every request and retries exactly once on a 401, calling `refresh()` in between. A second 401 forces logout — the refresh either failed or the access token was rejected for a reason refresh cannot fix.

```ts
// apps/frontend/src/app/auth/auth.interceptor.ts
import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpEvent } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';

const AUTH_PATHS = ['/api/admin/auth/login', '/api/admin/auth/refresh'];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  // Don't attach a bearer to the login/refresh calls themselves.
  if (AUTH_PATHS.some((p) => req.url.startsWith(p))) {
    return next(req.clone({ withCredentials: true }));
  }

  const withAuth = attachToken(req, auth.getAccessToken());

  return next(withAuth).pipe(
    catchError((err) => {
      if (err?.status !== 401) return throwError(() => err);

      // Attempt a single refresh, then retry the original request.
      return from(auth.refresh()).pipe(
        switchMap((ok): Observable<HttpEvent<unknown>> => {
          if (!ok) {
            auth.logout(); // fire-and-forget; will route to /login
            return throwError(() => err);
          }
          return next(attachToken(req, auth.getAccessToken()));
        }),
      );
    }),
  );
};

function attachToken(req: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> {
  if (!token) return req;
  return req.clone({
    setHeaders: { Authorization: `Bearer ${token}` },
    withCredentials: true,
  });
}
```

A subtle but important detail: the interceptor passes `withCredentials: true` on every request so the browser sends the refresh cookie when the API path falls inside `/api/admin/auth/*`. Since the cookie is scoped to that path, other admin endpoints will not receive it, and there is no CSRF surface for state-changing endpoints — those rely solely on the bearer token, which lives in JS memory.

---

## 5.13 API client integration

The generated client lives in `libs/api-client` and is published as `@openbucket/api-client` in the Nx workspace (TypeScript paths only — never NPM). The Angular app imports the generated services directly.

```ts
// apps/frontend/src/app/shared/api/api-client.providers.ts
import { Provider, EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import {
  ApiModule,
  Configuration,
  ConfigurationParameters,
  BucketsService,
  ObjectsService,
  KeysService,
} from '@openbucket/api-client';

export function provideApiClient(): EnvironmentProviders {
  const params: ConfigurationParameters = {
    basePath: '', // same origin — admin SPA is served by the same backend
  };
  return makeEnvironmentProviders([
    { provide: Configuration, useValue: new Configuration(params) },
    BucketsService,
    ObjectsService,
    KeysService,
  ]);
}
```

The interceptor handles auth header injection, so the generated services need zero customization. Consuming the generated `BucketsService` in a component:

```ts
// apps/frontend/src/app/buckets/bucket-list.component.ts
import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BucketsService, BucketSummaryDto } from '@openbucket/api-client';
import { ByteSizePipe } from '../shared/ui/byte-size.pipe';
import { RelativeTimePipe } from '../shared/ui/relative-time.pipe';

@Component({
  standalone: true,
  selector: 'ob-bucket-list',
  imports: [CommonModule, RouterLink, ByteSizePipe, RelativeTimePipe],
  template: `
    <div class="toolbar">
      <h1>Buckets</h1>
      <button (click)="openCreate()">Create bucket</button>
    </div>

    @if (loading()) {
      <p>Loading…</p>
    } @else {
      <table>
        <thead>
          <tr><th>Name</th><th>Objects</th><th>Size</th><th>Created</th></tr>
        </thead>
        <tbody>
          @for (b of buckets(); track b.name) {
            <tr>
              <td><a [routerLink]="['/buckets', b.name, 'browse']">{{ b.name }}</a></td>
              <td>{{ b.objectCount }}</td>
              <td>{{ b.sizeBytes | byteSize }}</td>
              <td>{{ b.createdAt | relativeTime }}</td>
            </tr>
          }
        </tbody>
      </table>
    }
  `,
})
export class BucketListComponent implements OnInit {
  private readonly api = inject(BucketsService);

  readonly buckets = signal<BucketSummaryDto[]>([]);
  readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    try {
      const res = await this.api.bucketsAdminControllerList().toPromise();
      this.buckets.set(res?.buckets ?? []);
    } finally {
      this.loading.set(false);
    }
  }

  openCreate(): void { /* opens BucketCreateDialogComponent */ }
}
```

The method name `bucketsAdminControllerList` is produced by openapi-generator from the controller class + method. To keep names tolerable, use `@nestjs/swagger`'s `@ApiOperation({ operationId: 'listBuckets' })` on each handler — the generator picks up `operationId` and produces `bucketsService.listBuckets()` instead.

---

## 5.14 Object browser UI

The bucket detail page hosts an `ObjectBrowserComponent` that paginates with `prefix` + `delimiter='/'` to give the "folder" experience S3 users expect.

Component tree:

```
ObjectBrowserComponent (route /buckets/:name/browse)
  ObjectBreadcrumbComponent          // prefix path: bucket > a > b > c
  ObjectUploadComponent              // drag-and-drop + button
  table
    ObjectRowComponent (one per common prefix or object)
      - folder rows → click sets prefix to <currentPrefix><name>/
      - object rows → click opens metadata side-panel; download via signed URL or admin endpoint
```

Pagination model: `marker` from the API drives the next page. The browser keeps a stack of `(prefix, marker)` tuples so the back button works without hitting the server.

For uploads, **v1 uses the admin endpoint, not presigned URLs** — the SPA is same-origin and already authenticated, so the simpler route is to `PUT /api/admin/buckets/:name/objects/:key(*)` with a streaming body, which the backend forwards into the same domain `ObjectService` the S3 controller calls. (The admin upload endpoint is added under §5.6's controller as `@Put(':key(*)')` and is non-XML; spec details belong to the streaming agent.)

```ts
// apps/frontend/src/app/objects/object-upload.component.ts
import { Component, EventEmitter, Input, Output, signal, inject } from '@angular/core';
import { HttpClient, HttpEventType } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

@Component({
  standalone: true,
  selector: 'ob-object-upload',
  template: `
    <div class="dropzone"
         (dragover)="onDragOver($event)"
         (drop)="onDrop($event)">
      <input type="file" multiple (change)="onPick($event)" />
      <span>Drop files here, or click to select.</span>
    </div>

    @for (u of uploads(); track u.id) {
      <div class="row">
        <span>{{ u.name }}</span>
        <progress [value]="u.progress" max="100"></progress>
        @if (u.error) { <span class="error">{{ u.error }}</span> }
      </div>
    }
  `,
})
export class ObjectUploadComponent {
  private readonly http = inject(HttpClient);

  @Input({ required: true }) bucket!: string;
  @Input({ required: true }) prefix = '';
  @Output() uploaded = new EventEmitter<string>();   // emits key

  readonly uploads = signal<UploadState[]>([]);

  onDragOver(e: DragEvent): void { e.preventDefault(); }
  onDrop(e: DragEvent): void {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (files) this.startMany(files);
  }
  onPick(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.files) this.startMany(input.files);
  }

  private startMany(list: FileList): void {
    for (const f of Array.from(list)) void this.startOne(f);
  }

  private async startOne(file: File): Promise<void> {
    const id = crypto.randomUUID();
    const key = this.prefix + file.name;
    const encoded = encodeURIComponent(key);
    this.uploads.update((arr) => [...arr, { id, name: key, progress: 0 }]);
    const url = `/api/admin/buckets/${this.bucket}/objects/${encoded}`;
    try {
      await firstValueFrom(
        this.http.put(url, file, {
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          reportProgress: true,
          observe: 'events',
        }).pipe(
          // see RxJS tap operator in real code; collapsed here for brevity
        ),
      );
      this.uploaded.emit(key);
      this.patch(id, { progress: 100 });
    } catch (err: unknown) {
      this.patch(id, { error: (err as Error).message });
    }
  }

  private patch(id: string, fields: Partial<UploadState>): void {
    this.uploads.update((arr) => arr.map((u) => (u.id === id ? { ...u, ...fields } : u)));
  }
}

interface UploadState {
  id: string;
  name: string;
  progress: number;
  error?: string;
}
```

The encoded-once rule (`encodeURIComponent` on the client, `decodeURIComponent` once on the server) is the single rule that keeps slash-bearing keys from being treated as path segments.

---

## 5.15 State management — signals

No NgRx in v1. Each feature exposes a tiny "signal store" — a service holding signals plus mutation methods. Components read via the signals; mutations call API and update the signals on success.

```ts
// apps/frontend/src/app/buckets/buckets.signal-store.ts
import { Injectable, computed, inject, signal } from '@angular/core';
import { BucketsService, BucketSummaryDto, CreateBucketDto } from '@openbucket/api-client';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class BucketsSignalStore {
  private readonly api = inject(BucketsService);

  private readonly _items = signal<BucketSummaryDto[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly items = this._items.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly count = computed(() => this._items().length);

  async refresh(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const res = await firstValueFrom(this.api.listBuckets());
      this._items.set(res?.buckets ?? []);
    } catch (e) {
      this._error.set((e as Error).message);
    } finally {
      this._loading.set(false);
    }
  }

  async create(dto: CreateBucketDto): Promise<void> {
    const created = await firstValueFrom(this.api.createBucket(dto));
    if (created) this._items.update((arr) => [...arr, created]);
  }

  async remove(name: string): Promise<void> {
    await firstValueFrom(this.api.deleteBucket(name));
    this._items.update((arr) => arr.filter((b) => b.name !== name));
  }
}
```

This pattern scales until app-wide state shape becomes non-trivial — if that day arrives, NgRx SignalStore is a small migration; the public read surface (`items`, `loading`, `error`) stays the same.

---

## 5.16 OpenAPI generation pipeline

The pipeline has three Nx targets and a CI check:

1. **`backend:openapi:export`** — boots the Nest app in spec-only mode and writes `apps/backend/dist/openapi.json`.
2. **`api-client:generate`** — runs `openapi-generator-cli` against that file, output into `libs/api-client/src/lib`.
3. **`api-client:check`** — re-runs `generate` and checks for git diff; fails in CI if the committed lib is stale.

### 5.16.1 Spec export script

```ts
// apps/backend/src/openapi-export.ts
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { patchNestjsSwagger } from 'nestjs-zod';

import { AppModule } from './app.module';

async function exportSpec(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  patchNestjsSwagger();

  const config = new DocumentBuilder()
    .setTitle('OpenBucket Admin API')
    .setVersion(process.env.npm_package_version ?? '0.0.0')
    .addServer('/')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    deepScanRoutes: true,
    operationIdFactory: (controllerKey, methodKey) => methodKey,
  });

  const out = resolve(__dirname, '../dist/openapi.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(document, null, 2));
  await app.close();
  // eslint-disable-next-line no-console
  console.log(`OpenAPI spec written to ${out}`);
}

void exportSpec();
```

`operationIdFactory: (controllerKey, methodKey) => methodKey` keeps generated method names short (`listBuckets`, not `BucketsAdminController_list`).

### 5.16.2 Backend project target

```jsonc
// apps/backend/project.json (relevant excerpt)
{
  "targets": {
    "openapi:export": {
      "executor": "nx:run-commands",
      "options": {
        "commands": [
          "tsx apps/backend/src/openapi-export.ts"
        ],
        "parallel": false
      },
      "outputs": ["{workspaceRoot}/apps/backend/dist/openapi.json"]
    }
  }
}
```

### 5.16.3 API-client project targets

```jsonc
// libs/api-client/project.json
{
  "name": "api-client",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "projectType": "library",
  "sourceRoot": "libs/api-client/src",
  "targets": {
    "generate": {
      "executor": "nx:run-commands",
      "dependsOn": [{ "projects": ["backend"], "target": "openapi:export" }],
      "options": {
        "commands": [
          "rimraf libs/api-client/src/lib",
          "openapi-generator-cli generate -i apps/backend/dist/openapi.json -g typescript-angular -o libs/api-client/src/lib --additional-properties=ngVersion=18.0.0,providedIn=root,withInterfaces=true,fileNaming=kebab-case,stringEnums=true,supportsES6=true"
        ],
        "parallel": false
      },
      "outputs": ["{workspaceRoot}/libs/api-client/src/lib"]
    },
    "check": {
      "executor": "nx:run-commands",
      "dependsOn": ["generate"],
      "options": {
        "commands": [
          "git diff --exit-code -- libs/api-client/src/lib || (echo 'api-client is stale — run: nx run api-client:generate && commit' && exit 1)"
        ]
      }
    },
    "build": {
      "executor": "@nx/angular:package",
      "options": {
        "project": "libs/api-client/ng-package.json"
      },
      "dependsOn": ["generate"]
    }
  },
  "tags": ["scope:shared", "type:client"]
}
```

The `check` target is wired into CI (`nx run api-client:check`). It re-generates, then asks git whether anything changed; if so, the PR is told to run `nx run api-client:generate` locally and commit.

### 5.16.4 Library barrel

```ts
// libs/api-client/src/index.ts
export * from './lib/api/api';
export * from './lib/model/models';
export * from './lib/configuration';
```

A tsconfig path alias (`@openbucket/api-client`) points to `libs/api-client/src/index.ts`; consumers import from the package name only.

---

## 5.17 Docker multi-stage build

```dockerfile
# Dockerfile
# syntax=docker/dockerfile:1.7

# ---------- stage 1 : build ----------
FROM node:22-bookworm-slim AS build
# bookworm-slim (glibc) — alpine (musl) breaks better-sqlite3 prebuilt bindings.
# Rebuilding from source on alpine works but adds ~30s and a python toolchain.

WORKDIR /workspace

# System deps for native modules (better-sqlite3 prebuild headers, argon2).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Install dependencies with a deterministic lock.
COPY package.json package-lock.json nx.json tsconfig.base.json ./
COPY apps ./apps
COPY libs ./libs
COPY tools ./tools

RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# Build SPA first, then export OpenAPI, then build backend so the SPA dist and
# generated client are present in the workspace before the backend ts compile.
RUN npx nx run api-client:generate
RUN npx nx build frontend --configuration=production
RUN npx nx build backend  --configuration=production

# Place the SPA assets inside backend dist where ServeStaticModule expects them.
RUN mkdir -p apps/backend/dist/spa \
 && cp -R apps/frontend/dist/. apps/backend/dist/spa/

# Trim dev dependencies for the runtime stage.
RUN --mount=type=cache,target=/root/.npm \
    npm prune --omit=dev


# ---------- stage 2 : runtime ----------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    DATA_DIR=/data \
    UV_THREADPOOL_SIZE=16 \
    NODE_OPTIONS=--enable-source-maps

# Run as non-root; /data is owned at runtime by the entrypoint volume mount.
RUN useradd -r -u 10001 -d /home/openbucket -m openbucket \
 && mkdir -p /data \
 && chown openbucket:openbucket /data

WORKDIR /app

COPY --from=build --chown=openbucket:openbucket /workspace/apps/backend/dist ./dist
COPY --from=build --chown=openbucket:openbucket /workspace/node_modules ./node_modules
COPY --from=build --chown=openbucket:openbucket /workspace/package.json ./package.json

USER openbucket

EXPOSE 9000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:9000/api/admin/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "dist/main.js"]
```

**Why `bookworm-slim`, not `alpine`.** `better-sqlite3` ships prebuilt native bindings linked against glibc. On alpine (musl) those bindings are silently incompatible — npm falls back to building from source, which requires `python3`, `make`, and `g++` on both build *and* runtime stages, costs 30+ seconds, and produces an image only marginally smaller than `bookworm-slim`. `bookworm-slim` is ~85 MB; `alpine` with the toolchain ends up around 110 MB. The slim Debian base is the boring, correct choice. Do not change this without a benchmarked reason.

The healthcheck pings a tiny `GET /api/admin/health` endpoint (returns `{ status: 'ok' }`, public, no auth) — its implementation lives in a `HealthController` exported by `AdminModule` but marked `@Public()`.

---

## 5.18 `.dockerignore`

```
# Source control
.git
.gitignore
.gitattributes

# Editor / OS
.vscode
.idea
.DS_Store
Thumbs.db

# Nx / TS caches
.nx
.angular
dist
tmp
coverage
.cache

# Docs (not needed in the image)
docs
*.md
!README.md

# CI metadata
.github

# Node
node_modules
npm-debug.log*
yarn-debug.log*

# Tests
**/*.spec.ts
**/*.e2e-spec.ts
**/__tests__
**/__fixtures__

# Local env (never bake env files into images)
.env
.env.*
!.env.example

# Local data dirs accidentally created
data
local-data
```

Excluding `dist` is deliberate: the build stage produces its own `dist` from sources; a stale host-built `dist` must not leak in.

---

## 5.19 CI pipeline

```yaml
# .github/workflows/ci.yml
name: ci

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

env:
  NODE_VERSION: '22'

jobs:
  lint-and-test:
    name: lint + unit
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - run: npm ci --no-audit --no-fund

      - name: Derive nx affected base
        uses: nrwl/nx-set-shas@v4

      - name: Lint
        run: npx nx run-many --target=lint --all --parallel=4

      - name: Unit tests
        run: npx nx run-many --target=test --all --parallel=4 --ci --coverage

      - name: api-client freshness check
        run: npx nx run api-client:check

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage
          path: coverage/

  e2e:
    name: backend e2e (real sqlite)
    runs-on: ubuntu-22.04
    needs: lint-and-test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
      - run: npm ci --no-audit --no-fund
      - name: Prepare tmp data dir
        run: mkdir -p tmp/e2e-data
      - name: Run e2e
        env:
          DATA_DIR: ${{ github.workspace }}/tmp/e2e-data
          JWT_SECRET: test-secret-not-for-prod-not-for-prod
        run: npx nx run backend-e2e:e2e --ci

  build-image:
    name: build docker image
    runs-on: ubuntu-22.04
    needs: lint-and-test
    permissions:
      contents: read
      packages: write
    outputs:
      image-tag: ${{ steps.meta.outputs.tag }}
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3

      - id: meta
        name: Compute image tag
        run: |
          if [ "${{ github.event_name }}" = "pull_request" ]; then
            echo "tag=pr-${{ github.event.pull_request.number }}-${GITHUB_SHA::7}" >> "$GITHUB_OUTPUT"
          else
            echo "tag=main-${GITHUB_SHA::7}" >> "$GITHUB_OUTPUT"
          fi

      - name: Build
        uses: docker/build-push-action@v6
        with:
          context: .
          file: Dockerfile
          push: false
          load: true
          tags: openbucket:${{ steps.meta.outputs.tag }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Save image
        run: docker save openbucket:${{ steps.meta.outputs.tag }} -o /tmp/openbucket.tar

      - uses: actions/upload-artifact@v4
        with:
          name: docker-image
          path: /tmp/openbucket.tar
          retention-days: 7

  conformance:
    name: s3 conformance suite
    if: github.event_name == 'pull_request' || startsWith(github.ref, 'refs/tags/')
    runs-on: ubuntu-22.04
    needs: build-image
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - name: Install client matrix
        run: |
          sudo apt-get update
          sudo apt-get install -y --no-install-recommends awscli s3cmd
          curl -sSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc
          chmod +x /usr/local/bin/mc

      - uses: actions/download-artifact@v4
        with:
          name: docker-image
          path: /tmp

      - name: Load image
        run: docker load -i /tmp/openbucket.tar

      - run: npm ci --no-audit --no-fund

      - name: Run conformance suite
        env:
          OPENBUCKET_IMAGE: openbucket:${{ needs.build-image.outputs.image-tag }}
        run: npx nx run conformance:e2e --ci
```

The `conformance` job is gated to PRs targeting `main` and to tag pushes so day-to-day pushes pay the cheap `lint+test+e2e+build-image` chain only.

---

## 5.20 Testing patterns

### 5.20.1 Unit test — service with in-memory SQLite

The principle [see §7.1 of `BACKEND-DESIGN.md`]: do not mock the EntityManager. Boot MikroORM against `:memory:` per suite.

```ts
// apps/backend/src/domain/buckets/bucket.service.spec.ts
import { Test } from '@nestjs/testing';
import { MikroORM } from '@mikro-orm/core';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { BetterSqliteDriver } from '@mikro-orm/better-sqlite';

import { BucketService } from './bucket.service';
import { BucketEntity } from '../../persistence/entities/bucket.entity';

describe('BucketService', () => {
  let orm: MikroORM;
  let service: BucketService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MikroOrmModule.forRoot({
          driver: BetterSqliteDriver,
          dbName: ':memory:',
          entities: [BucketEntity],
          allowGlobalContext: true,
        }),
        MikroOrmModule.forFeature([BucketEntity]),
      ],
      providers: [BucketService],
    }).compile();

    orm = moduleRef.get(MikroORM);
    await orm.getSchemaGenerator().createSchema();
    service = moduleRef.get(BucketService);
  });

  afterEach(async () => {
    await orm.close(true);
  });

  it('creates a bucket with default versioning', async () => {
    const b = await service.create({ name: 'photos', region: 'us-east-1' });
    expect(b.name).toBe('photos');
    expect(b.versioning).toBe('disabled');
  });

  it('rejects duplicate bucket names', async () => {
    await service.create({ name: 'photos', region: 'us-east-1' });
    await expect(service.create({ name: 'photos', region: 'us-east-1' }))
      .rejects.toThrow(/already exists/i);
  });

  it('refuses to delete a non-empty bucket', async () => {
    await service.create({ name: 'photos', region: 'us-east-1' });
    // ...seed an object row via repository
    await expect(service.deleteByName('photos')).rejects.toThrow(/not empty/i);
  });
});
```

### 5.20.2 E2E test — supertest against a real Nest app

```ts
// apps/backend-e2e/src/admin-auth.e2e-spec.ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import * as argon2 from 'argon2';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AppModule } from '../../backend/src/app.module';
import { AdminUserRepository } from '../../backend/src/persistence/repositories/admin-user.repository';

describe('admin auth (e2e)', () => {
  let app: INestApplication;
  const dataDir = mkdtempSync(join(tmpdir(), 'ob-e2e-'));

  beforeAll(async () => {
    process.env.DATA_DIR = dataDir;
    process.env.JWT_SECRET = 'e2e-secret-e2e-secret-e2e-secret-e2e';
    process.env.ADMIN_PASSWORD_HASH = await argon2.hash('correct horse battery staple', {
      type: argon2.argon2id,
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => app.close());

  it('logs in, refreshes, and rejects reuse', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/admin/auth/login')
      .send({ username: 'admin', password: 'correct horse battery staple' })
      .expect(200);

    expect(login.body.accessToken).toBeTruthy();
    const setCookie = login.headers['set-cookie'][0];
    expect(setCookie).toMatch(/ob_refresh=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);

    const refresh1 = await request(app.getHttpServer())
      .post('/api/admin/auth/refresh')
      .set('Cookie', setCookie)
      .expect(200);

    // Reusing the original refresh cookie must now fail and revoke the chain.
    await request(app.getHttpServer())
      .post('/api/admin/auth/refresh')
      .set('Cookie', setCookie)
      .expect(401);

    // The fresh cookie from refresh1 is also invalidated by the reuse detection.
    const reusedFresh = refresh1.headers['set-cookie'][0];
    await request(app.getHttpServer())
      .post('/api/admin/auth/refresh')
      .set('Cookie', reusedFresh)
      .expect(401);
  });

  it('protects /me with bearer token', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/auth/me')
      .expect(401);
  });
});
```

### 5.20.3 Conformance test — `@aws-sdk/client-s3` against the running image

The conformance project boots the container via `testcontainers`, points the AWS SDK at it, and exercises a matrix. One sample test:

```ts
// apps/conformance/src/object-roundtrip.conformance.ts
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import {
  S3Client, CreateBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { randomBytes } from 'node:crypto';

describe('conformance: object roundtrip', () => {
  let container: StartedTestContainer;
  let s3: S3Client;

  beforeAll(async () => {
    container = await new GenericContainer(process.env.OPENBUCKET_IMAGE ?? 'openbucket:local')
      .withExposedPorts(9000)
      .withEnvironment({
        DATA_DIR: '/data',
        JWT_SECRET: 'conformance-secret-conformance-secret',
        ROOT_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
        ROOT_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      })
      .withWaitStrategy(Wait.forHttp('/api/admin/health', 9000).forStatusCode(200))
      .withStartupTimeout(60_000)
      .start();

    s3 = new S3Client({
      endpoint: `http://${container.getHost()}:${container.getMappedPort(9000)}`,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      },
    });
  }, 90_000);

  afterAll(async () => {
    await container?.stop();
  });

  it('puts, gets, and deletes a 4 MiB object with matching ETag', async () => {
    const bucket = 'roundtrip';
    const key = 'fixtures/blob.bin';
    const body = randomBytes(4 * 1024 * 1024);

    await s3.send(new CreateBucketCommand({ Bucket: bucket }));

    const put = await s3.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: body,
    }));
    expect(put.ETag).toMatch(/^"[0-9a-f]{32}"$/);

    const get = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const downloaded = Buffer.concat(await collect(get.Body as AsyncIterable<Uint8Array>));
    expect(downloaded.equals(body)).toBe(true);
    expect(get.ETag).toBe(put.ETag);

    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  });
});

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return chunks;
}
```

A sibling matrix runs the same flow under `aws-cli`, `mc`, and `s3cmd` shelling out to the binaries installed in CI — those tests live in `apps/conformance/src/cli-matrix/*.conformance.ts` and are mostly assertions over `execFile` output. The `OPENBUCKET_IMAGE` env var is set by the CI workflow (§5.19) so the same suite runs against the just-built PR image.
