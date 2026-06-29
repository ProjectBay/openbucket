# hlm-profile-image-upload

Beautiful profile image upload component with avatar preview, designed
specifically for user profile pictures.

## Features

- Circular avatar preview
- Drag & drop support
- File validation
- Beautiful hover effects
- Remove button
- User initials fallback
- Multiple size variants

## Usage

```typescript
import { HlmProfileImageUploadImports } from '@openbucket/spartan-ui/profile-image-upload';

@Component({
  imports: [HlmProfileImageUploadImports],
  template: `
    <hlm-profile-image-upload
      [(ngModel)]="profileImage"
      [userName]="'John Doe'"
      size="lg"
      [maxSize]="5 * 1024 * 1024"
    />
  `
})
```
