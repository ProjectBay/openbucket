import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';

import { AdminUsersService } from '../../domain/admin-users/admin-users.service';
import type { AdminUser } from '../../persistence/index';
import type { AdminJwtPayload } from '../auth/jwt-auth.guard';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';
import { AdminUserSummaryDto } from './dto/admin-user-summary.dto';

/**
 * Admin-user management (EPIC-11, STORY-1002) at `/api/admin/users`. Every route
 * is authenticated by the global `JwtAuthGuard`; the mutating routes
 * (POST/PATCH/DELETE) are full-admin-only via the global `RolesGuard` — no
 * per-handler role decorator is needed (default-deny by method). `passwordHash`
 * is never serialized: only the secret-free summary is returned.
 */
@Controller('api/admin/users')
export class AdminUsersController {
  constructor(private readonly adminUsers: AdminUsersService) {}

  @Get()
  @ApiOperation({ operationId: 'listAdminUsers' })
  @ApiOkResponse({ type: AdminUserSummaryDto, isArray: true })
  async list(): Promise<AdminUserSummaryDto[]> {
    const rows = await this.adminUsers.list();
    return rows.map((u) => this.toSummary(u));
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ operationId: 'createAdminUser' })
  @ApiCreatedResponse({ type: AdminUserSummaryDto })
  async create(
    @Body() dto: CreateAdminUserDto,
    @Req() req: Request,
  ): Promise<AdminUserSummaryDto> {
    const created = await this.adminUsers.create(
      { username: dto.username, password: dto.password, role: dto.role },
      this.actor(req),
    );
    return this.toSummary(created);
  }

  @Patch(':username')
  @HttpCode(204)
  @ApiOperation({ operationId: 'updateAdminUser' })
  async update(
    @Param('username') username: string,
    @Body() dto: UpdateAdminUserDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.adminUsers.update(
      username,
      { role: dto.role, newPassword: dto.newPassword },
      this.actor(req),
    );
  }

  @Delete(':username')
  @HttpCode(204)
  @ApiOperation({ operationId: 'deleteAdminUser' })
  async remove(@Param('username') username: string, @Req() req: Request): Promise<void> {
    await this.adminUsers.remove(username, this.actor(req));
  }

  /** The acting admin's username, from the guard-attached request principal. */
  private actor(req: Request): string {
    return (req as Request & { user: AdminJwtPayload }).user.username;
  }

  /** Project a stored row into the secret-free summary DTO (never `passwordHash`). */
  private toSummary(u: AdminUser): AdminUserSummaryDto {
    return {
      username: u.username,
      role: u.role,
      mustChangePassword: u.mustChangePassword,
      createdAt: u.createdAt.toISOString(),
    };
  }
}
