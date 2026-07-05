import type { Request } from 'express';

import { IntegrityAdminController } from './integrity-admin.controller';
import type { IntegrityStatusService } from '../../domain/integrity/integrity-status.service';
import type { IntegrityScrubRunner } from '../../common/background/integrity-scrub.runner';
import type { AuditService } from '../audit/audit.service';

/**
 * TEST-1204 — IntegrityAdminController: read-model passthrough, the limit cap on
 * the corrupt list, and the audited manual scrub trigger (no secret in the event).
 */
function build() {
  const status = { getStatus: jest.fn(), listCorrupt: jest.fn() };
  const scrub = { triggerManual: jest.fn() };
  const audit = { emit: jest.fn() };
  const ctrl = new IntegrityAdminController(
    status as unknown as IntegrityStatusService,
    scrub as unknown as IntegrityScrubRunner,
    audit as unknown as AuditService,
  );
  return { status, scrub, audit, ctrl };
}

const req = (): Request =>
  ({ user: { username: 'admin', sub: 'u1' }, openbucket: { requestId: 'req-1' } }) as unknown as Request;

describe('IntegrityAdminController (TEST-1204)', () => {
  it('case: getStatus returns the read model verbatim', async () => {
    const { status, ctrl } = build();
    const model = {
      enabled: true,
      scanned: 42,
      ok: 40,
      corrupt: 1,
      unchecked: 1,
      repaired: 0,
      lastRunAt: '2026-07-05T00:00:00.000Z',
      cursor: null,
    };
    status.getStatus.mockResolvedValue(model);
    expect(await ctrl.getStatus()).toBe(model);
  });

  it('case: listCorrupt forwards the (already-capped) limit/offset', async () => {
    const { status, ctrl } = build();
    const page = { rows: [{ bucket: 'b', key: 'k', checkedAt: null, detail: 'sha x != y' }], total: 1 };
    status.listCorrupt.mockResolvedValue(page);
    const out = await ctrl.listCorrupt({ limit: 50, offset: 0 });
    expect(status.listCorrupt).toHaveBeenCalledWith({ limit: 50, offset: 0 });
    expect(out).toBe(page);
    // No endpoint/credential field on the wire shape.
    expect(JSON.stringify(out)).not.toMatch(/endpoint|secret|accessKey|https?:\/\//i);
  });

  it('case: startScrub kicks the runner and audits, with no secret in the event', async () => {
    const { scrub, audit, ctrl } = build();
    const out = await ctrl.startScrub(req());
    expect(scrub.triggerManual).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ triggered: true });
    expect(audit.emit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'integrity.scrub.started', subject: 'admin', requestId: 'req-1' }),
    );
    const event = audit.emit.mock.calls[0][0];
    expect(JSON.stringify(event)).not.toMatch(/endpoint|secret|accessKey/i);
  });
});
