import { Body, Controller, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import * as argon2 from 'argon2';

import { AdminUserRepository } from '../../persistence/index';

import { ChangePasswordDto } from './dto/change-password.dto';
import { AuditService } from '../audit/audit.service';

/** The decoded admin JWT the guard attaches to `req.user` (§5.3). */
interface AdminPrincipal {
  sub: string;
  username: string;
  mustChangePassword: boolean;
}

/**
 * Admin settings endpoints (§5.8). `change-password` is guarded (no `@Public()`),
 * so the global JwtAuthGuard has already attached the principal to `req.user`.
 */
@Controller('api/admin/settings')
export class SettingsAdminController {
  constructor(
    private readonly users: AdminUserRepository,
    private readonly audit: AuditService,
  ) {}

  @Post('change-password')
  @HttpCode(204)
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: Request): Promise<void> {
    // The AdminUser primary key is the username, which is the JWT `sub`.
    const principal = (req as Request & { user?: AdminPrincipal }).user;
    const user = principal ? await this.users.findByUsername(principal.username) : null;
    if (!user) throw new UnauthorizedException();

    const ok = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!ok) throw new UnauthorizedException('current password incorrect');

    const newHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });
    await this.users.update(user.username, { passwordHash: newHash, mustChangePassword: false });

    this.audit.emit({
      event: 'admin.password.changed',
      subject: user.username,
      requestId: req.openbucket.requestId,
    });
  }
}
