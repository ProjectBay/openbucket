import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { Public } from '../../common/auth/public.decorator';
import { AuthService } from './auth.service';
import { AuditService } from '../audit/audit.service';
import type { AdminJwtPayload } from './jwt-auth.guard';
import { readCookie } from './cookies';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { MeResponseDto } from './dto/me-response.dto';

/** Name of the HttpOnly refresh cookie, scoped to the auth route subtree. */
const REFRESH_COOKIE = 'ob_refresh';

/**
 * Admin authentication endpoints under `/api/admin/auth` (§5.2.4).
 *
 * `login` (STORY-0403) is the first to land; `refresh` (STORY-0404),
 * `logout` (STORY-0405) and `me` (STORY-0406) follow and reuse
 * {@link setRefreshCookie} / the `ob_refresh` cookie below.
 */
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
  @ApiOkResponse({ type: LoginResponseDto })
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
  @ApiOkResponse({ type: LoginResponseDto })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const raw = readCookie(req, REFRESH_COOKIE);
    if (!raw) throw new UnauthorizedException('missing refresh');
    // AuthService.refresh delegates to RefreshTokenService.rotate, which rejects
    // revoked/expired/reused tokens and mints a rotated replacement. No audit
    // event — refresh is implicit on every authenticated session (§5.9).
    const tokens = await this.auth.refresh(raw);
    this.setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  // Not @Public: the global JwtAuthGuard requires a bearer so we know which
  // subject is logging out. Idempotent — revoking a missing/absent token is a
  // no-op, so a double logout still returns 204.
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const raw = readCookie(req, REFRESH_COOKIE);
    await this.auth.logout(raw);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/admin/auth' });
    const username = (req as Request & { user?: { username?: string } }).user?.username ?? 'unknown';
    this.audit.emit({ event: 'admin.logout', subject: username });
  }

  // Guarded (no @Public): the JwtAuthGuard verifies the bearer and attaches the
  // payload, which we echo straight back — identity comes from the token claims,
  // never a DB read.
  @Get('me')
  @ApiOkResponse({ type: MeResponseDto })
  me(@Req() req: Request): MeResponseDto {
    const user = (req as Request & { user: AdminJwtPayload }).user;
    return {
      id: user.sub,
      username: user.username,
      mustChangePassword: user.mustChangePassword,
    };
  }

  /**
   * Set the rotating refresh token as an HttpOnly cookie scoped to
   * `/api/admin/auth` (§5.2.4). `Secure` + `SameSite=Strict` keep it off
   * cross-site and plaintext requests; `expires` matches the token TTL.
   */
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
