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
import type { Request } from 'express';
import { ApiOperation, ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';

import { KeyService } from '../../domain/keys/key.service';
import { CreateKeyDto } from './dto/create-key.dto';
import { CreatedKeyDto } from './dto/created-key.dto';
import { KeySummaryDto } from './dto/key-summary.dto';
import { UpdateKeyDto } from './dto/update-key.dto';
import { AuditService } from '../audit/audit.service';

/** The decoded admin JWT the guard attaches to `req.user` (§5.3). */
interface AdminPrincipal {
  sub: string;
  username: string;
}

/**
 * Admin access-key management (§5.7) — list / create / update / delete. Guarded
 * by the global JwtAuthGuard. The secret is surfaced exactly once (on create).
 * `role` is hard-coded `root` in v1 but exposed so the SPA already renders it.
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
    return rows.map((k) => ({
      id: k.id,
      accessKeyId: k.accessKeyId,
      label: k.label,
      role: k.role,
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      disabled: k.disabled,
    }));
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ operationId: 'createKey' })
  @ApiCreatedResponse({ type: CreatedKeyDto })
  async create(@Body() dto: CreateKeyDto, @Req() req: Request): Promise<CreatedKeyDto> {
    const created = await this.keys.create({ label: dto.label, role: 'root' });
    this.audit.emit({
      event: 'key.created',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      keyId: created.id,
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
}
