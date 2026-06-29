import { CreateBucketSchema } from './buckets/dto/create-bucket.dto';
import { BucketSummarySchema } from './buckets/dto/bucket-summary.dto';
import { ListObjectsQuerySchema } from './objects/dto/list-objects-query.dto';
import { LoginSchema } from './auth/dto/login.dto';
import { ChangePasswordSchema } from './settings/dto/change-password.dto';
import { UpdateKeySchema } from './keys/dto/update-key.dto';

/**
 * TEST-0409 — representative nestjs-zod schemas (§5.4 + the auth/settings DTOs).
 * Exercises defaults, regex/length rules, `.strict()` rejection, query coercion,
 * and the response-only enum value.
 *
 * Case 8 (UpdateKeySchema) is deferred: that DTO is authored by the keys-admin
 * story (TASK-1224); it will join this spec then.
 */
describe('Admin DTO schemas (TEST-0409)', () => {
  it('case 1: CreateBucketSchema applies defaults', () => {
    expect(CreateBucketSchema.parse({ name: 'valid-bucket' })).toEqual({
      name: 'valid-bucket',
      versioning: 'disabled',
      objectLock: false,
      region: 'us-east-1',
    });
  });

  it('case 2: CreateBucketSchema rejects uppercase + too short', () => {
    expect(CreateBucketSchema.safeParse({ name: 'A' }).success).toBe(false);
  });

  it('case 3: CreateBucketSchema is strict — unknown keys rejected', () => {
    // Valid name so the only failure is the unknown key (isolates .strict()).
    expect(CreateBucketSchema.safeParse({ name: 'valid-bucket', extra: true }).success).toBe(false);
  });

  it('case 4: CreateBucketSchema rejects a leading hyphen (regex)', () => {
    expect(CreateBucketSchema.safeParse({ name: '-bad' }).success).toBe(false);
  });

  it("case 5: BucketSummarySchema accepts the response-only 'suspended' state", () => {
    const valid = {
      name: 'b1',
      createdAt: '2026-01-01T00:00:00Z',
      versioning: 'suspended' as const,
      objectLock: false,
      objectCount: 0,
      sizeBytes: 0,
    };
    expect(BucketSummarySchema.safeParse(valid).success).toBe(true);
  });

  it('case 6: ListObjectsQuerySchema coerces a string limit to a number', () => {
    expect(ListObjectsQuerySchema.parse({ limit: '50' }).limit).toBe(50);
  });

  it('case 7: ListObjectsQuerySchema rejects limit > 1000', () => {
    expect(ListObjectsQuerySchema.safeParse({ limit: 1500 }).success).toBe(false);
  });

  it('case 8: UpdateKeySchema requires at least one field', () => {
    const result = UpdateKeySchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === 'at least one field required')).toBe(true);
    }
  });

  it('case 9: LoginSchema rejects empty username/password', () => {
    expect(LoginSchema.safeParse({ username: '', password: '' }).success).toBe(false);
  });

  it('case 10: ChangePasswordSchema rejects a newPassword shorter than 12', () => {
    expect(
      ChangePasswordSchema.safeParse({ currentPassword: 'old', newPassword: 'short' }).success,
    ).toBe(false);
  });
});
