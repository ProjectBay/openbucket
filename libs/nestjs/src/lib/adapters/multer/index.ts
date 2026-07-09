/**
 * The `@openbucket/nestjs/multer` subpath adapter (STORY-1200): a drop-in multer
 * `StorageEngine` that streams a `FileInterceptor` part straight into OpenBucket,
 * plus the param decorator and exception filter that make the one-line wiring
 * ergonomic.
 *
 * `multer` is an OPTIONAL peer dependency — importing from here pulls it in, so
 * headless / non-Express hosts that never touch this subpath are unaffected. The
 * main `.` entry deliberately does NOT re-export any of this.
 */
export {
  openBucketStorage,
  type OpenBucketStorageOptions,
  type OpenBucketMulterInfo,
  type PerRequestKeyFn,
} from './open-bucket-storage';

export { OpenBucketFileInterceptor } from './open-bucket-file.interceptor';

export {
  UploadedToBucket,
  type UploadedFileInfo,
} from './uploaded-to-bucket.decorator';

export {
  UploadValidationExceptionFilter,
  type UploadValidationErrorBody,
} from './upload-validation.filter';
