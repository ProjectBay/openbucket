import { Injectable, inject } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';

/**
 * App-wide screen-reader announcer (STORY-0600 / TASK-1803). Wraps CDK's
 * `LiveAnnouncer` (which manages a visually-hidden `aria-live` region) so async
 * status — loading, success, failure, route changes, upload progress — is read
 * to assistive tech. WCAG 2.2 §4.1.3 Status Messages.
 */
@Injectable({ providedIn: 'root' })
export class StatusAnnouncer {
  private readonly live = inject(LiveAnnouncer);

  announce(message: string, politeness: 'polite' | 'assertive' = 'polite'): void {
    void this.live.announce(message, politeness);
  }
}
