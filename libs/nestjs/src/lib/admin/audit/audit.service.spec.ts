import { Logger } from '@nestjs/common';

import { AuditService, AuditEvent } from './audit.service';

/**
 * TEST-0418 — AuditService (§5.9). Spies on the Nest `Logger.log` to verify the
 * emitted record carries every caller field plus `audit: true`, under the
 * `admin.audit` context.
 */
describe('AuditService (TEST-0418)', () => {
  let svc: AuditService;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    svc = new AuditService();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => logSpy.mockRestore());

  it('case 1: emit merges all fields and stamps audit: true', () => {
    svc.emit({ event: 'bucket.created', subject: 'admin', bucket: 'b1', requestId: 'r1' });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith({
      event: 'bucket.created',
      subject: 'admin',
      bucket: 'b1',
      requestId: 'r1',
      audit: true,
    });
  });

  it('case 2: login event carries ip and audit: true', () => {
    svc.emit({ event: 'admin.login', subject: 'admin', ip: '127.0.0.1' });

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'admin.login', ip: '127.0.0.1', audit: true }),
    );
  });

  it('case 3: AuditEvent requires event and subject (compile-time)', () => {
    // @ts-expect-error — `event` is required
    const missingEvent: AuditEvent = { subject: 'admin' };
    // @ts-expect-error — `subject` is required
    const missingSubject: AuditEvent = { event: 'admin.login' };
    void missingEvent;
    void missingSubject;
    expect(true).toBe(true);
  });

  it("case 4: logger context is 'admin.audit'", () => {
    svc.emit({ event: 'admin.logout', subject: 'admin' });

    const loggerInstance = logSpy.mock.instances[0] as unknown as { context?: string };
    expect(loggerInstance.context).toBe('admin.audit');
  });
});
