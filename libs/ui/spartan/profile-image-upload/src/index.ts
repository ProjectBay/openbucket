import { HlmProfileImageUpload } from './lib/hlm-profile-image-upload';
import { HlmProfilePhotoEdit } from './lib/hlm-profile-photo-edit';

export * from './lib/hlm-profile-image-upload';
export * from './lib/hlm-profile-photo-edit';

export const HlmProfileImageUploadImports = [
  HlmProfileImageUpload,
  HlmProfilePhotoEdit,
] as const;
