import { Migration } from '@mikro-orm/migrations';

/**
 * Adds `objects.content_sha256` + `object_versions.content_sha256` — a strong
 * whole-object plaintext digest used by getObject's read-time integrity gate
 * (F1) to detect corruption at rest for ANY object, including multipart (whose
 * `etag` is md5-of-md5s and cannot be recomputed on read). Nullable so existing
 * rows are valid (just not read-verified until rewritten). Forward-only in
 * production (§3.3.2); `down()` is for test-suite convenience only.
 */
export class Migration20260701000001_object_content_sha256 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "objects" add column "content_sha256" varchar(64) null;`);
    this.addSql(`alter table "object_versions" add column "content_sha256" varchar(64) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "objects" drop column "content_sha256";`);
    this.addSql(`alter table "object_versions" drop column "content_sha256";`);
  }
}
