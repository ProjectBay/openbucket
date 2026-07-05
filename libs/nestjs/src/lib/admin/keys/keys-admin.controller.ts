import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ApiOperation, ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';

import { KeyService } from '../../domain/keys/key.service';
import {
  summarizeScope,
  parseScopePolicy,
  type KeyScopeView,
} from '../../domain/keys/key-scope';
import { evaluatePolicy, type PolicyEvaluationContext } from '../../s3/authz/policy-evaluator';
import { operationToAction } from '../../s3/authz/operation-action';
import type { PolicyDocument } from '../../persistence/entities/types';
import type { AccessKey } from '../../persistence/index';
import { CreateKeyDto } from './dto/create-key.dto';
import { CreatedKeyDto } from './dto/created-key.dto';
import { RotatedKeyDto } from './dto/rotated-key.dto';
import { KeySummaryDto } from './dto/key-summary.dto';
import { UpdateKeyDto } from './dto/update-key.dto';
import { EffectivePermissionsDto } from './dto/effective-permissions.dto';
import { SimulateRequestDto, SimulateResponseDto } from './dto/simulate.dto';
import { AuditService } from '../audit/audit.service';

/** The decoded admin JWT the guard attaches to `req.user` (§5.3). */
interface AdminPrincipal {
  sub: string;
  username: string;
}

/**
 * Fixed IAM action catalogue for the effective-permissions matrix — the distinct
 * `s3:*` actions reachable via `operationToAction`. Bounded so the matrix can't
 * fan out (≤ actions × resources cells).
 */
const EFFECTIVE_ACTIONS = [
  's3:GetObject',
  's3:PutObject',
  's3:DeleteObject',
  's3:ListBucket',
  's3:ListBucketMultipartUploads',
  's3:AbortMultipartUpload',
  's3:GetBucketLocation',
] as const;

/**
 * Admin access-key management (§5.7) — list / create / update / delete, plus
 * rotate / revoke and read-only effective-permissions / simulate (EPIC-11).
 * Guarded by the global JwtAuthGuard. The secret is surfaced exactly once (on
 * create and on rotate). A `scope` on create mints a restricted `scoped` sub-key
 * enforced by `PolicyAuthorizationGuard`; an absent scope keeps the unscoped
 * `root`-equivalent behaviour.
 */
@Controller('api/admin/keys')
export class KeysAdminController {
  constructor(
    private readonly keys: KeyService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'listKeys' })
  @ApiOkResponse({ type: KeySummaryDto, isArray: true })
  async list(): Promise<KeySummaryDto[]> {
    const rows = await this.keys.list();
    return rows.map((k) => this.toSummary(k));
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ operationId: 'createKey' })
  @ApiCreatedResponse({ type: CreatedKeyDto })
  async create(@Body() dto: CreateKeyDto, @Req() req: Request): Promise<CreatedKeyDto> {
    // A scope mints a restricted `scoped` sub-key; absent ⇒ unscoped `root`.
    const created = await this.keys.create({
      label: dto.label,
      role: dto.scope ? 'scoped' : 'root',
      scope: dto.scope,
    });
    this.audit.emit({
      event: 'key.created',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      keyId: created.id,
      // Boolean only — never the scope body / tenant ARNs — so mints stay auditable.
      scope: !!dto.scope,
      requestId: req.openbucket.requestId,
    });
    // SECURITY: secretAccessKey is returned ONCE here and never again.
    return {
      id: created.id,
      accessKeyId: created.accessKeyId,
      secretAccessKey: created.secretAccessKey,
      label: created.label,
      role: created.role,
      createdAt: created.createdAt.toISOString(),
      scope: summarizeScope(created.scopePolicy),
    };
  }

  @Patch(':id')
  @ApiOperation({ operationId: 'updateKey' })
  @ApiOkResponse({ type: KeySummaryDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateKeyDto,
    @Req() req: Request,
  ): Promise<KeySummaryDto> {
    const updated = await this.keys.update(id, { disabled: dto.disabled, label: dto.label });
    if (!updated) throw new NotFoundException(`key ${id} not found`);
    this.audit.emit({
      event: dto.disabled === true ? 'key.disabled' : 'key.updated',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      keyId: id,
      requestId: req.openbucket.requestId,
    });
    return this.toSummary(updated);
  }

  /**
   * Rotate a key's secret (EPIC-11, TASK-3010): mint a fresh secret shown ONCE,
   * keeping `id`/`accessKeyId`/`scope`. Throttled tighter than the 100/min admin
   * bucket because argon2id hashing is CPU-heavy (a rotate flood is a compute-DoS
   * vector); the app-wide ThrottlerGuard only narrows here. The domain service
   * invalidates the SigV4 cache so the old secret stops verifying at once.
   */
  @Post(':id/rotate')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ operationId: 'rotateKey' })
  @ApiOkResponse({ type: RotatedKeyDto })
  async rotate(@Param('id') id: string, @Req() req: Request): Promise<RotatedKeyDto> {
    const rotated = await this.keys.rotate(id);
    if (!rotated) throw new NotFoundException(`key ${id} not found`);
    this.audit.emit({
      event: 'key.rotated',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      keyId: rotated.id,
      requestId: req.openbucket.requestId,
    });
    // SECURITY: secretAccessKey is returned ONCE here and never again.
    return {
      id: rotated.id,
      accessKeyId: rotated.accessKeyId,
      secretAccessKey: rotated.secretAccessKey,
      label: rotated.label,
      role: rotated.role,
      createdAt: rotated.createdAt.toISOString(),
      scope: summarizeScope(rotated.scopePolicy),
    };
  }

  /**
   * Revoke a key (EPIC-11, TASK-3010): disable it (reversible, keeps the audit
   * trail) and invalidate the SigV4 cache. Distinct from delete (hard-remove).
   */
  @Post(':id/revoke')
  @HttpCode(200)
  @ApiOperation({ operationId: 'revokeKey' })
  @ApiOkResponse({ type: KeySummaryDto })
  async revoke(@Param('id') id: string, @Req() req: Request): Promise<KeySummaryDto> {
    const revoked = await this.keys.revoke(id);
    if (!revoked) throw new NotFoundException(`key ${id} not found`);
    this.audit.emit({
      event: 'key.revoked',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      keyId: id,
      requestId: req.openbucket.requestId,
    });
    return this.toSummary(revoked);
  }

  /**
   * Effective permissions (EPIC-11, TASK-3012) — read-only. Returns the compiled
   * scope and an allow/deny matrix over a fixed action catalogue crossed with the
   * key's scoped resources, using the SAME evaluator + `defaultAllow` rule the S3
   * path uses, so the console and the real request path never disagree.
   */
  @Get(':id/effective-permissions')
  @ApiOperation({ operationId: 'getKeyEffectivePermissions' })
  @ApiOkResponse({ type: EffectivePermissionsDto })
  async effectivePermissions(@Param('id') id: string): Promise<EffectivePermissionsDto> {
    const row = await this.keys.findById(id);
    if (!row) throw new NotFoundException(`key ${id} not found`);

    const scoped = row.scopePolicy != null; // guard semantics: unscoped ⇒ root-equivalent
    const scope = scoped ? parseScopePolicy(row.scopePolicy) : null;
    const view = summarizeScope(row.scopePolicy);
    const resources = this.matrixResources(scope, view);
    const prefix = view?.kind === 'prefix' ? (view.prefix ?? '') : '';

    const matrix: EffectivePermissionsDto['matrix'] = [];
    for (const resource of resources) {
      for (const action of EFFECTIVE_ACTIONS) {
        matrix.push({
          action,
          resource,
          decision: evaluatePolicy(
            scope,
            this.hypotheticalCtx(action, resource, row.accessKeyId, { prefix }),
            { defaultAllow: !scoped },
          ),
        });
      }
    }
    return { scoped, scope, matrix };
  }

  /**
   * Simulate a single `{ action, resource }` (EPIC-11, TASK-3012) — read-only.
   * `action` may be a bare op (`GetObject`) or an IAM action (`s3:GetObject`).
   * Optional `secureTransport`/`sourceIp` override the benign defaults so a raw
   * scope's network conditions can be probed. Decision is byte-identical to what
   * `PolicyAuthorizationGuard` would return for the same principal.
   */
  @Post(':id/simulate')
  @HttpCode(200)
  @ApiOperation({ operationId: 'simulateKeyAction' })
  @ApiOkResponse({ type: SimulateResponseDto })
  async simulate(
    @Param('id') id: string,
    @Body() dto: SimulateRequestDto,
  ): Promise<SimulateResponseDto> {
    const row = await this.keys.findById(id);
    if (!row) throw new NotFoundException(`key ${id} not found`);

    const scoped = row.scopePolicy != null;
    const scope = scoped ? parseScopePolicy(row.scopePolicy) : null;
    // Accept a bare op name or an s3:* action.
    const action = operationToAction(dto.action) ?? dto.action;
    const decision = evaluatePolicy(
      scope,
      this.hypotheticalCtx(action, dto.resource, row.accessKeyId, {
        secureTransport: dto.secureTransport,
        sourceIp: dto.sourceIp,
      }),
      { defaultAllow: !scoped },
    );
    return { decision };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ operationId: 'deleteKey' })
  async delete(@Param('id') id: string, @Req() req: Request): Promise<void> {
    await this.keys.delete(id);
    this.audit.emit({
      event: 'key.deleted',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      keyId: id,
      requestId: req.openbucket.requestId,
    });
  }

  /** Project a stored row into the secret-free summary DTO. */
  private toSummary(k: AccessKey): KeySummaryDto {
    return {
      id: k.id,
      accessKeyId: k.accessKeyId,
      label: k.label,
      role: k.role,
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      disabled: k.disabled,
      scope: summarizeScope(k.scopePolicy),
    };
  }

  /**
   * Build a hypothetical evaluation context. Since these are what-if checks,
   * default `secureTransport: true` and a benign `sourceIp` so a raw scope's
   * `aws:SecureTransport`/`aws:SourceIp` conditions don't falsely deny (the
   * matrix reflects action/resource reachability, not real network conditions).
   */
  private hypotheticalCtx(
    action: string,
    resource: string,
    principal: string,
    over: { secureTransport?: boolean; sourceIp?: string; prefix?: string } = {},
  ): PolicyEvaluationContext {
    return {
      action,
      resource,
      principal,
      secureTransport: over.secureTransport ?? true,
      sourceIp: over.sourceIp ?? '0.0.0.0',
      prefix: over.prefix,
    };
  }

  /**
   * Representative resources for the effective-permissions matrix: for a scoped
   * key, each bucket the scope names contributes its bucket ARN and an object ARN
   * (`arn:aws:s3:::<bucket>/<prefix>*`); for an unscoped/root key a single wildcard
   * resource row (reported allow). Bounded by the scope's bucket cap ([TASK-3011]).
   */
  private matrixResources(scope: PolicyDocument | null, view: KeyScopeView | null): string[] {
    if (!scope) return ['arn:aws:s3:::*'];
    const set = new Set<string>();
    for (const stmt of scope.Statement) {
      const arns = Array.isArray(stmt.Resource) ? stmt.Resource : [stmt.Resource];
      for (const arn of arns) {
        if (typeof arn !== 'string' || !arn.startsWith('arn:aws:s3:::')) continue;
        set.add(arn);
        // Ensure the bucket ARN is present alongside any object ARN.
        const slash = arn.indexOf('/', 'arn:aws:s3:::'.length);
        if (slash !== -1) set.add(arn.slice(0, slash));
      }
    }
    // Prefer the authored bucket/prefix representation when it is a plain prefix scope.
    if (view?.kind === 'prefix' && view.bucket) {
      set.add(`arn:aws:s3:::${view.bucket}`);
      set.add(`arn:aws:s3:::${view.bucket}/${view.prefix ?? ''}*`);
    }
    return set.size > 0 ? [...set] : ['arn:aws:s3:::*'];
  }
}
