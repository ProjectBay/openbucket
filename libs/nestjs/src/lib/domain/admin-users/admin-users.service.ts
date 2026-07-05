import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';

import { AdminUser, AdminUserRepository } from '../../persistence/index';
import type { AdminRole } from '../../persistence/entities/types';
import { AuditService } from '../../admin/audit/audit.service';
import { RefreshTokenService } from '../../admin/auth/refresh-token.service';

/** Input for creating an admin user (EPIC-11, STORY-1002). */
export interface CreateAdminUserInput {
  username: string;
  password: string;
  role: AdminRole;
}

/** Input for updating an admin user — role reassignment and/or password reset. */
export interface UpdateAdminUserInput {
  role?: AdminRole;
  newPassword?: string;
}

/**
 * Multi-admin management (EPIC-11, STORY-1002). Holds the lockout invariants —
 * never remove the last full admin, never self-delete — and reuses the argon2id
 * hashing and `revokeAllForSubject` session-eviction patterns the
 * change-password flow already uses. Every mutation emits an audit event; the
 * `RolesGuard` (full-admin-only for mutations) sits in front of the controller.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly users: AdminUserRepository,
    private readonly audit: AuditService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  /** All admin users (both roles), ordered by username. */
  async list(): Promise<AdminUser[]> {
    return this.users.list();
  }

  async create(input: CreateAdminUserInput, actor: string): Promise<AdminUser> {
    const existing = await this.users.findByUsername(input.username);
    if (existing) throw new ConflictException(`admin user "${input.username}" already exists`);

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    // mustChangePassword: true — a newly-created admin must rotate the
    // operator-set password on first login (same posture as bootstrap branch 2).
    const created = await this.users.insert({
      username: input.username,
      passwordHash,
      role: input.role,
      mustChangePassword: true,
    });

    this.audit.emit({ event: 'admin.user.created', subject: actor, target: input.username, role: input.role });
    return created;
  }

  async update(username: string, input: UpdateAdminUserInput, actor: string): Promise<void> {
    const target = await this.users.findByUsername(username);
    if (!target) throw new NotFoundException(`admin user "${username}" not found`);

    // Demotion of the last full admin is blocked (anti-lockout). The RolesGuard
    // already ensures the actor is a full admin, so this covers self-demotion too.
    if (input.role === 'readonly' && target.role === 'admin') {
      await this.assertNotLastAdmin(target);
    }

    const changes: Partial<Pick<AdminUser, 'passwordHash' | 'mustChangePassword' | 'role'>> = {};
    if (input.role !== undefined) changes.role = input.role;
    if (input.newPassword !== undefined) {
      changes.passwordHash = await argon2.hash(input.newPassword, { type: argon2.argon2id });
      changes.mustChangePassword = true;
    }
    await this.users.update(username, changes);

    if (input.role !== undefined && input.role !== target.role) {
      this.audit.emit({
        event: 'admin.user.role.changed',
        subject: actor,
        target: username,
        from: target.role,
        to: input.role,
      });
    }
    if (input.newPassword !== undefined) {
      // CWE-613 — a peer-initiated reset must kill the target's live sessions,
      // exactly like change-password evicts on rotation.
      await this.refreshTokens.revokeAllForSubject(username);
      this.audit.emit({ event: 'admin.user.password.reset', subject: actor, target: username });
    }
  }

  async remove(username: string, actor: string): Promise<void> {
    // No self-delete — avoids the confusing lock-yourself-out path.
    if (username === actor) {
      throw new ForbiddenException('cannot delete your own admin account');
    }
    const target = await this.users.findByUsername(username);
    if (!target) throw new NotFoundException(`admin user "${username}" not found`);

    await this.assertNotLastAdmin(target);
    await this.users.delete(username);
    await this.refreshTokens.revokeAllForSubject(username);
    this.audit.emit({ event: 'admin.user.deleted', subject: actor, target: username });
  }

  /**
   * The anti-lockout invariant: refuse to remove/demote the final full admin so
   * the instance always retains at least one operator who can manage it.
   */
  private async assertNotLastAdmin(target: AdminUser): Promise<void> {
    if (target.role === 'admin' && (await this.users.countByRole('admin')) <= 1) {
      throw new ConflictException('cannot remove the last full admin');
    }
  }
}
