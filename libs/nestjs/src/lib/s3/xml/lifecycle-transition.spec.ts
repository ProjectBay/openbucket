import { parseLifecycleConfig, lifecycleConfigDoc } from './s3-config-docs';

/**
 * TEST-0901 — the lifecycle XML parser round-trips a `<Transition>` (Days +
 * StorageClass) alongside expiration without dropping either action (TASK-2710).
 */
describe('lifecycle transition parsing (STORY-0901)', () => {
  it('parses <Transition> Days + StorageClass into transitionDays/transitionStorageClass', () => {
    const parsed = parseLifecycleConfig({
      LifecycleConfiguration: {
        Rule: [
          {
            ID: 'tier-cold',
            Status: 'Enabled',
            Prefix: 'logs/',
            Transition: [{ Days: 30, StorageClass: 'GLACIER' }],
            Expiration: { Days: 365 },
          },
        ],
      },
    });
    expect(parsed[0].transitionDays).toBe(30);
    expect(parsed[0].transitionStorageClass).toBe('GLACIER');
    // Expiration is NOT dropped by the transition parsing.
    expect(parsed[0].expirationDays).toBe(365);
  });

  it('ignores an unsupported transition storage class but keeps expiration', () => {
    const parsed = parseLifecycleConfig({
      LifecycleConfiguration: {
        Rule: [
          { ID: 'r', Status: 'Enabled', Transition: [{ Days: 10, StorageClass: 'ONEZONE_IA' }], Expiration: { Days: 90 } },
        ],
      },
    });
    expect(parsed[0].transitionStorageClass).toBeUndefined();
    expect(parsed[0].transitionDays).toBe(10);
    expect(parsed[0].expirationDays).toBe(90);
  });

  it('round-trips a transition rule back out through lifecycleConfigDoc', () => {
    const doc = lifecycleConfigDoc([
      {
        id: 'tier-cold',
        status: 'Enabled',
        prefix: 'logs/',
        transitionDays: 30,
        transitionStorageClass: 'DEEP_ARCHIVE',
        expirationDays: 365,
      },
    ]) as { Rule: Array<Record<string, unknown>> };
    const rule = doc.Rule[0];
    expect(rule.Transition).toEqual({ Days: 30, StorageClass: 'DEEP_ARCHIVE' });
    expect(rule.Expiration).toEqual({ Days: 365 });
  });
});
