import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { FieldType, FieldTypeConfig, FormlyModule } from '@ngx-formly/core';
import {
  HlmInputOtp,
  HlmInputOtpGroup,
  HlmInputOtpSeparator,
  HlmInputOtpSlot,
} from '@openbucket/spartan-ui/input-otp';
import { BrnInputOtp } from '@spartan-ng/brain/input-otp';

/**
 * Formly field type for Spartan Input OTP component
 */
@Component({
  selector: 'lib-spartan-formly-field-input-otp',
  imports: [
    ReactiveFormsModule,
    FormlyModule,
    HlmInputOtp,
    HlmInputOtpGroup,
    HlmInputOtpSeparator,
    HlmInputOtpSlot,
    BrnInputOtp,
  ],
  template: `
    <brn-input-otp
      hlmInputOtp
      [id]="id"
      [formControl]="formControl"
      [maxLength]="props['length'] || 6"
      [disabled]="props['disabled'] || false"
      inputClass="disabled:cursor-not-allowed"
    >
      <div hlmInputOtpGroup>
        @for (i of getFirstGroupIndices(); track i) {
          <hlm-input-otp-slot [index]="i" />
        }
      </div>
      <hlm-input-otp-separator />
      <div hlmInputOtpGroup>
        @for (i of getSecondGroupIndices(); track i) {
          <hlm-input-otp-slot [index]="i" />
        }
      </div>
    </brn-input-otp>
  `,
})
export class SpartanFormlyFieldInputOtp extends FieldType<FieldTypeConfig> {
  getFirstGroupIndices(): number[] {
    const length = this.props['length'] || 6;
    const half = Math.floor(length / 2);
    return Array.from({ length: half }, (_, i) => i);
  }

  getSecondGroupIndices(): number[] {
    const length = this.props['length'] || 6;
    const half = Math.floor(length / 2);
    return Array.from({ length: length - half }, (_, i) => i + half);
  }
}
