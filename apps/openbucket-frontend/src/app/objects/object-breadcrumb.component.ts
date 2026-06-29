import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * Prefix breadcrumb (§5.14): `bucket > a > b > c`. Each segment emits the prefix
 * to navigate to (the bucket root emits '').
 */
@Component({
  standalone: true,
  selector: 'ob-object-breadcrumb',
  imports: [CommonModule],
  template: `
    <nav class="flex flex-wrap items-center gap-1 text-sm">
      <button class="text-primary hover:underline" (click)="navigate.emit('')">{{ bucket }}</button>
      @for (seg of segments; track seg.prefix) {
        <span class="text-muted-foreground">/</span>
        <button class="text-primary hover:underline" (click)="navigate.emit(seg.prefix)">
          {{ seg.label }}
        </button>
      }
    </nav>
  `,
})
export class ObjectBreadcrumbComponent {
  @Input({ required: true }) bucket!: string;
  @Input() prefix = '';
  @Output() navigate = new EventEmitter<string>();

  get segments(): { label: string; prefix: string }[] {
    const parts = this.prefix.split('/').filter((p) => p.length > 0);
    let acc = '';
    return parts.map((label) => {
      acc += `${label}/`;
      return { label, prefix: acc };
    });
  }
}
