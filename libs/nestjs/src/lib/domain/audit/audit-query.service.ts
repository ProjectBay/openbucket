import { BadRequestException, Injectable } from '@nestjs/common';

import {
  AuditLog,
  AuditLogRepository,
  type AuditFilter,
} from '../../persistence/index';
import { AUDIT_EVENT_CATALOG } from '../../admin/audit/audit.service';
import type { AuditQueryDto } from '../../admin/audit/dto/audit-query.dto';
import type { AuditEventDto } from '../../admin/audit/dto/audit-event.dto';
import type { AuditPageDto } from '../../admin/audit/dto/audit-page.dto';
import type { AuditCatalogDto } from '../../admin/audit/dto/audit-catalog.dto';

/**
 * Read-only domain service behind the audit viewer API (§5.9, STORY-1103).
 * Translates a validated query DTO into an {@link AuditFilter}, drives the
 * repository's newest-first keyset query, and encodes/decodes the opaque paging
 * cursor. Admin-plane only — never touches the S3/authz/key-codec surface.
 */
@Injectable()
export class AuditQueryService {
  constructor(private readonly repo: AuditLogRepository) {}

  /** One page of events, newest-first, with an opaque `nextCursor` (or null). */
  async list(q: AuditQueryDto): Promise<AuditPageDto> {
    const filter: AuditFilter = {
      event: q.event,
      subject: q.subject,
      bucket: q.bucket,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      before: q.cursor ? this.decodeCursor(q.cursor) : undefined,
      limit: q.limit,
    };

    const rows = await this.repo.query(filter);

    // The repo fetched `limit + 1`: the extra row (if present) signals another
    // page and its predecessor becomes the cursor.
    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      rows.pop(); // drop the sentinel
      const last = rows[rows.length - 1];
      nextCursor = this.encodeCursor(last.ts, last.id);
    }

    return { items: rows.map((r) => this.toDto(r)), nextCursor };
  }

  /** The static v1 event-name catalogue for the filter dropdown. */
  catalog(): AuditCatalogDto {
    return { events: [...AUDIT_EVENT_CATALOG] };
  }

  /** `base64url(ISO_ts|id)` — opaque so clients can't craft an offset scan. */
  private encodeCursor(ts: Date, id: string): string {
    return Buffer.from(`${ts.toISOString()}|${id}`, 'utf8').toString('base64url');
  }

  /** Decode a client cursor; a malformed value is a 400 (never trusted). */
  private decodeCursor(cursor: string): { ts: Date; id: string } {
    let decoded: string;
    try {
      decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    } catch {
      throw new BadRequestException('Malformed audit cursor');
    }
    const sep = decoded.indexOf('|');
    if (sep <= 0) throw new BadRequestException('Malformed audit cursor');
    const ts = new Date(decoded.slice(0, sep));
    const id = decoded.slice(sep + 1);
    if (Number.isNaN(ts.getTime()) || id.length === 0) {
      throw new BadRequestException('Malformed audit cursor');
    }
    return { ts, id };
  }

  /** Map a persisted row to the API DTO, parsing `detail` JSON back to an object. */
  private toDto(row: AuditLog): AuditEventDto {
    return {
      id: row.id,
      ts: row.ts.toISOString(),
      event: row.event,
      subject: row.subject ?? null,
      requestId: row.requestId ?? null,
      bucket: row.bucket ?? null,
      objectKey: row.objectKey ?? null,
      keyId: row.keyId ?? null,
      ip: row.ip ?? null,
      detail: this.parseDetail(row.detail),
    };
  }

  /** Parse the stored `detail` JSON; a bad/legacy value degrades to null. */
  private parseDetail(detail?: string | null): Record<string, unknown> | null {
    if (!detail) return null;
    try {
      const parsed = JSON.parse(detail);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}
