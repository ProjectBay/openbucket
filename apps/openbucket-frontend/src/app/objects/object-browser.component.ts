import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnInit,
  computed,
  inject,
  input,
  DestroyRef,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl, SafeUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowLeft,
  lucideArrowRight,
  lucideChevronLeft,
  lucideChevronRight,
  lucideCopy,
  lucideDownload,
  lucideEllipsisVertical,
  lucideFile,
  lucideFileArchive,
  lucideFileAudio,
  lucideFileCode,
  lucideFileText,
  lucideFileVideo,
  lucideFolder,
  lucideImage,
  lucideInfo,
  lucideLink,
  lucideFolderPlus,
  lucideSearch,
  lucideShare2,
  lucideTrash2,
} from '@ng-icons/lucide';
import {
  BucketSummaryDto,
  BucketsAdminService,
  DeleteMarkerDto,
  LegalHoldDtoStatusEnum,
  ObjectListItem,
  ObjectMetaDto,
  ObjectVersionDto,
  ObjectsAdminService,
  RetentionDto,
  RetentionDtoModeEnum,
} from '@openbucket/api-client';
import { firstValueFrom } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import { resolveMountPrefix } from '../shared/api/mount-prefix';
import { HlmTableImports } from '@openbucket/spartan-ui/table';
import { HlmBadge } from '@openbucket/spartan-ui/badge';
import { HlmButton } from '@openbucket/spartan-ui/button';
import { HlmInput } from '@openbucket/spartan-ui/input';
import { HlmSelectImports } from '@openbucket/spartan-ui/select';
import { BrnSelectImports } from '@spartan-ng/brain/select';
import { HlmPaginationImports } from '@openbucket/spartan-ui/pagination';
import { HlmCheckbox } from '@openbucket/spartan-ui/checkbox';
import { HlmDropdownMenuImports } from '@openbucket/spartan-ui/dropdown-menu';
import { HlmSheet, HlmSheetImports } from '@openbucket/spartan-ui/sheet';
import { BrnSheetImports } from '@spartan-ng/brain/sheet';
import { HlmDialog, HlmDialogImports } from '@openbucket/spartan-ui/dialog';
import { BrnDialogImports } from '@spartan-ng/brain/dialog';
import { HlmTabsImports } from '@openbucket/spartan-ui/tabs';
import { HlmSwitch } from '@openbucket/spartan-ui/switch';

import { ByteSizePipe } from '../shared/ui/byte-size.pipe';
import { RelativeTimePipe } from '../shared/ui/relative-time.pipe';
import { notify } from '../shared/ui/notify';
import { ConfirmDialogComponent } from '../shared/ui/confirm-dialog.component';
import { ObjectBreadcrumbComponent } from './object-breadcrumb.component';
import { ObjectUploadComponent } from './object-upload.component';

/**
 * Object browser (§5.14, rebuilt STORY-0604). Lists a bucket with delimiter `/`
 * so common prefixes surface as folders. Rows are keyboard-operable (the name is
 * a real `<button>`, not a host-`(click)` `<tr>`). Navigation keeps an in-memory
 * `(prefix, marker)` stack. List/HEAD/download errors surface via an error signal
 * + toasts. (Selection, bulk ops, row menu and the detail sheet land in the
 * follow-up slices of STORY-0604.)
 */
@Component({
  standalone: true,
  selector: 'ob-object-browser',
  imports: [
    NgIcon,
    TranslateModule,
    HlmTableImports,
    HlmBadge,
    HlmButton,
    HlmCheckbox,
    HlmDropdownMenuImports,
    HlmSheetImports,
    BrnSheetImports,
    HlmDialogImports,
    BrnDialogImports,
    HlmTabsImports,
    HlmSwitch,
    HlmInput,
    HlmSelectImports,
    BrnSelectImports,
    HlmPaginationImports,
    FormsModule,
    ByteSizePipe,
    RelativeTimePipe,
    ConfirmDialogComponent,
    ObjectBreadcrumbComponent,
    ObjectUploadComponent,
  ],
  providers: [
    provideIcons({
      lucideArrowLeft,
      lucideArrowRight,
      lucideChevronLeft,
      lucideChevronRight,
      lucideCopy,
      lucideDownload,
      lucideEllipsisVertical,
      lucideFile,
      lucideFileArchive,
      lucideFileAudio,
      lucideFileCode,
      lucideFileText,
      lucideFileVideo,
      lucideFolder,
      lucideFolderPlus,
      lucideImage,
      lucideInfo,
      lucideLink,
      lucideSearch,
      lucideShare2,
      lucideTrash2,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-4" [class.p-6]="padded()">
      <ob-object-breadcrumb
        [bucket]="bucket()"
        [prefix]="prefix()"
        (navigate)="navigateTo($event)"
      />

      <ob-object-upload
        [bucket]="bucket()"
        [prefix]="prefix()"
        (uploaded)="onUploaded()"
      />

      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="text-muted-foreground flex items-center gap-2 text-sm">
          @if (bucketSummary(); as s) {
            <span
              hlmBadge
              variant="secondary"
              >{{ s.objectCount }} {{ 'objects.objectsLabel' | translate }}</span
            >
            <span
              hlmBadge
              variant="secondary"
              >{{ s.sizeBytes | byteSize }}</span
            >
          }
          <span>{{ 'objects.showing' | translate }} {{ filteredObjects().length }}</span>
          @if (nextMarker()) {
            <span
              hlmBadge
              variant="outline"
              >{{ 'objects.morePages' | translate }}</span
            >
          }
        </div>
        <div class="flex items-center gap-2">
          <button
            hlmBtn
            variant="outline"
            size="sm"
            (click)="folderDialog().open()"
          >
            <ng-icon
              name="lucideFolderPlus"
              class="text-base"
            />
            {{ 'objects.newFolder' | translate }}
          </button>
          <div class="relative">
            <ng-icon
              name="lucideSearch"
              class="text-muted-foreground pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-base"
            />
            <input
              #searchBox
              hlmInput
              class="w-64 pl-8"
              [placeholder]="'objects.searchPlaceholder' | translate"
              [ngModel]="searchTerm()"
              (ngModelChange)="searchTerm.set($event)"
              (keyup.enter)="onSearchEnter()"
            />
          </div>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2 px-1 py-1">
        <div class="text-muted-foreground flex items-center gap-1 text-nowrap text-sm">
          @if (loading()) {
            {{ 'objects.loading' | translate }}
          } @else {
            <b class="text-foreground">{{ itemCount() }}</b>
            {{ 'objects.itemsOnPage' | translate }}
            <span class="px-1 opacity-50">|</span>
            {{ 'objects.page' | translate }} <b class="text-foreground">{{ stack.length }}</b>
          }
        </div>

        <nav hlmPagination>
          <ul hlmPaginationContent>
            <li hlmPaginationItem>
              <button
                hlmBtn
                variant="ghost"
                size="sm"
                class="gap-1 pl-2.5"
                [disabled]="stack.length <= 1"
                (click)="back()"
              >
                <ng-icon
                  name="lucideChevronLeft"
                  class="text-base"
                />
                <span class="hidden sm:block">{{ 'objects.previous' | translate }}</span>
              </button>
            </li>
            <li hlmPaginationItem>
              <button
                hlmBtn
                variant="ghost"
                size="sm"
                class="gap-1 pr-2.5"
                [disabled]="!nextMarker()"
                (click)="nextPage()"
              >
                <span class="hidden sm:block">{{ 'objects.next' | translate }}</span>
                <ng-icon
                  name="lucideChevronRight"
                  class="text-base"
                />
              </button>
            </li>
          </ul>
        </nav>

        <brn-select
          hlm
          class="ml-auto"
          [ngModel]="pageSize()"
          (ngModelChange)="onPageSize($event)"
        >
          <hlm-select-trigger class="w-fit">
            <hlm-select-value />
          </hlm-select-trigger>
          <hlm-select-content>
            @for (n of pageSizes; track n) {
              <hlm-option [value]="n">{{ n }} {{ 'objects.perPage' | translate }}</hlm-option>
            }
          </hlm-select-content>
        </brn-select>
      </div>

      @if (error()) {
        <p class="text-sm font-medium text-destructive">{{ error() }}</p>
      }

      @if (selection().size > 0) {
        <div class="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span class="font-medium">{{ selection().size }} {{ 'objects.selected' | translate }}</span>
          <button
            hlmBtn
            variant="destructive"
            size="sm"
            (click)="bulkDelete()"
          >
            {{ 'objects.deleteSelected' | translate }}
          </button>
          <button
            hlmBtn
            variant="outline"
            size="sm"
            (click)="downloadSelected()"
          >
            {{ 'objects.downloadSelected' | translate }}
          </button>
          <button
            hlmBtn
            variant="ghost"
            size="sm"
            (click)="clearSelection()"
          >
            {{ 'objects.clear' | translate }}
          </button>
        </div>
      }

      <div hlmTableContainer>
        <table
          hlmTable
          class="w-full"
        >
          <thead hlmTHead>
            <tr hlmTr>
              <th
                hlmTh
                class="w-10"
              >
                <hlm-checkbox
                  [checked]="allSelected()"
                  [indeterminate]="someSelected()"
                  (checkedChange)="toggleAll($event)"
                  [attr.aria-label]="'objects.selectAll' | translate"
                />
              </th>
              <th hlmTh>{{ 'objects.name' | translate }}</th>
              <th hlmTh>{{ 'objects.storage' | translate }}</th>
              <th
                hlmTh
                class="text-right"
              >
                {{ 'objects.size' | translate }}
              </th>
              <th hlmTh>{{ 'objects.modified' | translate }}</th>
              <th hlmTh>{{ 'objects.etag' | translate }}</th>
              <th
                hlmTh
                class="w-12 text-right"
              >
                {{ 'objects.actions' | translate }}
              </th>
            </tr>
          </thead>
          <tbody hlmTBody>
            @for (f of filteredFolders(); track f) {
              <tr hlmTr>
                <td hlmTd></td>
                <td hlmTd>
                  <button
                    type="button"
                    class="flex items-center gap-2 font-medium text-primary hover:underline"
                    (click)="openFolder(f)"
                  >
                    <ng-icon
                      name="lucideFolder"
                      class="text-base"
                    />
                    <span class="sr-only">{{ 'objects.folderPrefix' | translate }} </span>{{ folderLabel(f) }}
                  </button>
                </td>
                <td hlmTd></td>
                <td hlmTd></td>
                <td hlmTd></td>
                <td hlmTd></td>
                <td hlmTd></td>
              </tr>
            }
            @for (o of filteredObjects(); track o.key) {
              <tr hlmTr>
                <td hlmTd>
                  <hlm-checkbox
                    [checked]="isSelected(o.key)"
                    (checkedChange)="toggleOne(o.key, $event)"
                    [attr.aria-label]="'Select ' + objectLabel(o)"
                  />
                </td>
                <td hlmTd>
                  <div class="flex items-center gap-2">
                    <ng-icon
                      [name]="fileIcon(o.key)"
                      class="text-muted-foreground shrink-0 text-base"
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      class="break-all text-left font-medium text-primary hover:underline"
                      (click)="openObject(o)"
                    >
                      {{ objectLabel(o) }}
                    </button>
                  </div>
                </td>
                <td hlmTd>
                  @if (o.storageClass) {
                    <span
                      hlmBadge
                      variant="secondary"
                      >{{ o.storageClass }}</span
                    >
                  }
                  @if (o.location && o.location !== 'local') {
                    <span
                      hlmBadge
                      variant="outline"
                      class="ml-1"
                      >{{ 'objects.tiered' | translate }}</span
                    >
                  }
                </td>
                <td
                  hlmTd
                  class="text-right tabular-nums"
                >
                  {{ o.size | byteSize }}
                </td>
                <td hlmTd>{{ o.lastModified | relativeTime }}</td>
                <td
                  hlmTd
                  class="font-mono text-xs"
                >
                  {{ o.etag }}
                </td>
                <td
                  hlmTd
                  class="text-right"
                >
                  <button
                    hlmBtn
                    variant="ghost"
                    size="icon-sm"
                    align="end"
                    [hlmDropdownMenuTrigger]="rowMenu"
                    [attr.aria-label]="'Actions for ' + objectLabel(o)"
                  >
                    <ng-icon
                      name="lucideEllipsisVertical"
                      class="text-base"
                    />
                  </button>
                  <ng-template #rowMenu>
                    <hlm-dropdown-menu class="w-44">
                      <button
                        hlmDropdownMenuItem
                        (click)="openObject(o)"
                      >
                        <ng-icon name="lucideInfo" />
                        {{ 'objects.viewDetails' | translate }}
                      </button>
                      <button
                        hlmDropdownMenuItem
                        (click)="copyKey(o)"
                      >
                        <ng-icon name="lucideCopy" />
                        {{ 'objects.copyKey' | translate }}
                      </button>
                      <button
                        hlmDropdownMenuItem
                        (click)="copyUrl(o)"
                      >
                        <ng-icon name="lucideLink" />
                        {{ 'objects.copyUrl' | translate }}
                      </button>
                      <button
                        hlmDropdownMenuItem
                        (click)="download(o.key)"
                      >
                        <ng-icon name="lucideDownload" />
                        {{ 'objects.download' | translate }}
                      </button>
                      <hlm-dropdown-menu-separator />
                      <button
                        hlmDropdownMenuItem
                        (click)="shareLink(o, 3600)"
                      >
                        <ng-icon name="lucideShare2" />
                        {{ 'share.link1h' | translate }}
                      </button>
                      <button
                        hlmDropdownMenuItem
                        (click)="shareLink(o, 86400)"
                      >
                        <ng-icon name="lucideShare2" />
                        {{ 'share.link24h' | translate }}
                      </button>
                      <button
                        hlmDropdownMenuItem
                        (click)="shareLink(o, 604800)"
                      >
                        <ng-icon name="lucideShare2" />
                        {{ 'share.link7d' | translate }}
                      </button>
                      <hlm-dropdown-menu-separator />
                      <button
                        hlmDropdownMenuItem
                        class="text-destructive"
                        (click)="deleteOne(o)"
                      >
                        <ng-icon name="lucideTrash2" />
                        {{ 'objects.delete' | translate }}
                      </button>
                    </hlm-dropdown-menu>
                  </ng-template>
                </td>
              </tr>
            }
            @if (!loading() && filteredFolders().length === 0 && filteredObjects().length === 0) {
              <tr hlmTr>
                <td
                  hlmTd
                  colspan="7"
                  class="text-muted-foreground"
                >
                  {{ 'objects.empty' | translate }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <hlm-sheet
        side="right"
        (closed)="closeMeta()"
      >
        <hlm-sheet-content
          *brnSheetContent="let ctx"
          class="w-full sm:max-w-md"
        >
          @if (selected(); as meta) {
            <hlm-sheet-header>
              <h3
                hlmSheetTitle
                class="break-words pr-8"
              >
                {{ meta.key }}
              </h3>
            </hlm-sheet-header>

            <hlm-tabs
              tab="details"
              class="flex min-h-0 flex-1 flex-col px-4 pb-4"
              (tabActivated)="onSheetTab($event)"
            >
              <hlm-tabs-list class="w-full">
                <button hlmTabsTrigger="details">{{ 'objects.tabDetails' | translate }}</button>
                <button hlmTabsTrigger="versions">{{ 'objects.tabVersions' | translate }}</button>
                <button hlmTabsTrigger="tags">{{ 'objects.tabTags' | translate }}</button>
                <button hlmTabsTrigger="retention">{{ 'objects.tabRetention' | translate }}</button>
              </hlm-tabs-list>

              <div
                hlmTabsContent="details"
                class="min-h-0 flex-1 space-y-3 overflow-y-auto pt-3 text-sm"
              >
                @if (previewLoading()) {
                  <p class="text-muted-foreground">{{ 'objects.previewLoading' | translate }}</p>
                } @else if (previewTooLarge()) {
                  <p class="text-muted-foreground">{{ 'objects.previewTooLarge' | translate }}</p>
                } @else {
                  @switch (previewKind()) {
                    @case ('image') {
                      <img
                        [src]="previewUrl()"
                        [alt]="meta.key"
                        class="mx-auto max-h-80 max-w-full rounded border bg-muted/30 object-contain"
                      />
                    }
                    @case ('pdf') {
                      <iframe
                        [src]="previewPdf()"
                        class="h-96 w-full rounded border"
                        title="PDF preview"
                      ></iframe>
                    }
                    @case ('video') {
                      <video
                        [src]="previewUrl()"
                        controls
                        class="max-h-80 w-full rounded border bg-black"
                      ></video>
                    }
                    @case ('audio') {
                      <audio
                        [src]="previewUrl()"
                        controls
                        class="w-full"
                      ></audio>
                    }
                  }
                }

                <dl class="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5">
                  <dt class="text-muted-foreground">{{ 'objects.size' | translate }}</dt>
                  <dd>{{ meta.size | byteSize }}</dd>
                  <dt class="text-muted-foreground">{{ 'objects.contentType' | translate }}</dt>
                  <dd class="break-words">{{ meta.contentType }}</dd>
                  <dt class="text-muted-foreground">{{ 'objects.etag' | translate }}</dt>
                  <dd class="font-mono text-xs break-all">{{ meta.etag }}</dd>
                  <dt class="text-muted-foreground">{{ 'objects.modified' | translate }}</dt>
                  <dd>{{ meta.lastModified | relativeTime }}</dd>
                  @if (meta.versionId) {
                    <dt class="text-muted-foreground">{{ 'objects.version' | translate }}</dt>
                    <dd class="font-mono text-xs break-all">{{ meta.versionId }}</dd>
                  }
                </dl>
              </div>

              <div
                hlmTabsContent="versions"
                class="min-h-0 flex-1 space-y-3 overflow-y-auto pt-3 text-sm"
              >
                @if (versions().length === 0 && deleteMarkers().length === 0) {
                  <p class="text-muted-foreground">{{ 'objects.noVersions' | translate }}</p>
                } @else {
                  @for (v of versions(); track v.versionId) {
                    <div class="flex items-center justify-between gap-2 border-b py-1.5 last:border-b-0">
                      <div class="min-w-0">
                        <p class="truncate font-mono text-xs">
                          {{ v.versionId }}
                          @if (v.isLatest) {
                            <span hlmBadge variant="secondary">{{ 'objects.latest' | translate }}</span>
                          }
                        </p>
                        <p class="text-muted-foreground text-xs">
                          {{ v.size | byteSize }} · {{ v.lastModified | relativeTime }}
                        </p>
                      </div>
                      <div class="flex gap-1">
                        <button
                          hlmBtn
                          variant="ghost"
                          size="icon-sm"
                          [attr.aria-label]="'objects.downloadVersion' | translate"
                          (click)="downloadVersion(meta.key, v.versionId)"
                        >
                          <ng-icon name="lucideDownload" class="text-base" />
                        </button>
                        <button
                          hlmBtn
                          variant="ghost"
                          size="icon-sm"
                          class="text-destructive"
                          [attr.aria-label]="'objects.deleteVersion' | translate"
                          (click)="deleteVersion(meta.key, v.versionId)"
                        >
                          <ng-icon name="lucideTrash2" class="text-base" />
                        </button>
                      </div>
                    </div>
                  }
                  @for (m of deleteMarkers(); track m.versionId) {
                    <div class="flex items-center justify-between gap-2 border-b py-1.5 last:border-b-0">
                      <div class="min-w-0">
                        <p class="truncate font-mono text-xs">
                          {{ m.versionId }}
                          <span hlmBadge variant="outline">{{ 'objects.deleteMarker' | translate }}</span>
                        </p>
                        <p class="text-muted-foreground text-xs">{{ m.lastModified | relativeTime }}</p>
                      </div>
                      <button
                        hlmBtn
                        variant="ghost"
                        size="icon-sm"
                        class="text-destructive"
                        [attr.aria-label]="'objects.removeDeleteMarker' | translate"
                        (click)="deleteVersion(meta.key, m.versionId)"
                      >
                        <ng-icon name="lucideTrash2" class="text-base" />
                      </button>
                    </div>
                  }
                }
              </div>

              <div
                hlmTabsContent="tags"
                class="min-h-0 flex-1 space-y-3 overflow-y-auto pt-3 text-sm"
              >
                @for (t of tagRows(); track $index) {
                  <div class="flex items-center gap-2">
                    <input
                      hlmInput
                      class="flex-1"
                      placeholder="key"
                      [ngModel]="t.key"
                      (ngModelChange)="setTag($index, 'key', $event)"
                    />
                    <input
                      hlmInput
                      class="flex-1"
                      placeholder="value"
                      [ngModel]="t.value"
                      (ngModelChange)="setTag($index, 'value', $event)"
                    />
                    <button
                      hlmBtn
                      variant="ghost"
                      size="icon-sm"
                      [attr.aria-label]="'objects.removeTag' | translate"
                      (click)="removeTag($index)"
                    >
                      <ng-icon name="lucideTrash2" class="text-base" />
                    </button>
                  </div>
                } @empty {
                  <p class="text-muted-foreground">{{ 'objects.noTags' | translate }}</p>
                }
                <div class="flex gap-2 pt-1">
                  <button hlmBtn variant="outline" size="sm" (click)="addTag()">{{ 'objects.addTag' | translate }}</button>
                  <button hlmBtn size="sm" (click)="saveTags()">{{ 'objects.saveTags' | translate }}</button>
                </div>

                @if (userMeta().length) {
                  <div class="pt-3">
                    <p class="text-muted-foreground mb-1 text-xs font-medium">{{ 'objects.userMetadata' | translate }}</p>
                    <dl class="grid grid-cols-[8rem_1fr] gap-1">
                      @for (m of userMeta(); track m.key) {
                        <dt class="text-muted-foreground truncate">{{ m.key }}</dt>
                        <dd class="break-all">{{ m.value }}</dd>
                      }
                    </dl>
                  </div>
                }
              </div>

              <div
                hlmTabsContent="retention"
                class="min-h-0 flex-1 space-y-3 overflow-y-auto pt-3 text-sm"
              >
                @if (!lockSupported()) {
                  <p class="text-muted-foreground">{{ 'objects.noObjectLock' | translate }}</p>
                } @else {
                  <div class="space-y-1">
                    <p class="font-medium">{{ 'objects.retention' | translate }}</p>
                    @if (retention(); as r) {
                      <p class="text-muted-foreground text-xs">
                        {{ 'objects.mode' | translate }}:
                        <span hlmBadge variant="secondary">{{ r.mode }}</span>
                      </p>
                    }
                    @if (isCompliance()) {
                      <p class="text-muted-foreground text-xs">
                        {{ 'objects.complianceUntil' | translate: { date: retention()?.retainUntil } }}
                      </p>
                    } @else {
                      <div class="flex items-center gap-2">
                        <input
                          hlmInput
                          type="date"
                          [ngModel]="retainUntilEdit()"
                          (ngModelChange)="retainUntilEdit.set($event)"
                        />
                        <button hlmBtn size="sm" (click)="saveRetention()">{{ 'objects.save' | translate }}</button>
                      </div>
                    }
                  </div>

                  <div class="flex items-center justify-between gap-4 pt-2">
                    <div>
                      <p class="font-medium">{{ 'objects.legalHold' | translate }}</p>
                      <p class="text-muted-foreground text-xs">{{ 'objects.legalHoldHint' | translate }}</p>
                    </div>
                    <hlm-switch
                      [attr.aria-label]="'objects.legalHold' | translate"
                      [checked]="legalHoldOn()"
                      (checkedChange)="toggleLegalHold($event)"
                    />
                  </div>
                }
              </div>
            </hlm-tabs>

            <hlm-sheet-footer>
              <button
                hlmBtn
                variant="outline"
                size="sm"
                (click)="download(meta.key)"
              >
                {{ 'objects.download' | translate }}
              </button>
            </hlm-sheet-footer>
          }
        </hlm-sheet-content>
      </hlm-sheet>

      <ob-confirm-dialog
        [title]="confirmTitle()"
        [description]="confirmDescription()"
        confirmLabel="Delete"
        [destructive]="true"
      />

      <hlm-dialog>
        <hlm-dialog-content
          *brnDialogContent="let ctx"
          class="sm:max-w-sm"
        >
          <hlm-dialog-header>
            <h3 hlmDialogTitle>{{ 'objects.newFolderTitle' | translate }}</h3>
            <p hlmDialogDescription>{{ 'objects.newFolderHint' | translate }}</p>
          </hlm-dialog-header>
          <div class="py-2">
            <input
              hlmInput
              class="w-full"
              autocomplete="off"
              [placeholder]="'objects.newFolderPlaceholder' | translate"
              [ngModel]="newFolderName()"
              (ngModelChange)="newFolderName.set($event)"
              (keyup.enter)="createFolder()"
            />
          </div>
          <hlm-dialog-footer>
            <button
              hlmBtn
              variant="outline"
              (click)="folderDialog().close()"
            >
              {{ 'objects.cancel' | translate }}
            </button>
            <button
              hlmBtn
              (click)="createFolder()"
              [disabled]="!newFolderName().trim()"
            >
              {{ 'objects.createFolder' | translate }}
            </button>
          </hlm-dialog-footer>
        </hlm-dialog-content>
      </hlm-dialog>
    </section>
  `,
})
export class ObjectBrowserComponent implements OnInit {
  private readonly objects$ = inject(ObjectsAdminService);
  private readonly buckets$ = inject(BucketsAdminService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly http = inject(HttpClient);
  private readonly sanitizer = inject(DomSanitizer);

  /** When false (embedded in a tab), drop the outer p-6 so the host can pad. */
  readonly padded = input(true);

  readonly bucket = signal('');
  readonly prefix = signal('');
  readonly folders = signal<string[]>([]); // commonPrefixes
  readonly objects = signal<ObjectListItem[]>([]); // contents
  readonly nextMarker = signal<string | undefined>(undefined);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly selected = signal<ObjectMetaDto | null>(null);
  readonly versions = signal<ObjectVersionDto[]>([]);
  readonly deleteMarkers = signal<DeleteMarkerDto[]>([]);
  readonly tagRows = signal<{ key: string; value: string }[]>([]);
  readonly userMeta = signal<{ key: string; value: string }[]>([]);
  readonly retention = signal<RetentionDto | null>(null);
  readonly retainUntilEdit = signal('');
  readonly legalHoldOn = signal(false);
  readonly lockSupported = signal(false);
  readonly isCompliance = computed(
    () => this.retention()?.mode === RetentionDtoModeEnum.Compliance,
  );
  readonly previewUrl = signal<SafeUrl | null>(null);
  readonly previewPdf = signal<SafeResourceUrl | null>(null);
  readonly previewKind = signal<'image' | 'pdf' | 'video' | 'audio' | null>(null);
  readonly previewTooLarge = signal(false);
  readonly previewLoading = signal(false);
  readonly newFolderName = signal('');
  private readonly maxPreviewBytes = 50 * 1024 * 1024; // 50 MiB — skip inline preview above this

  readonly selection = signal<Set<string>>(new Set());
  readonly allSelected = computed(() => {
    const objs = this.objects();
    return objs.length > 0 && objs.every((o) => this.selection().has(o.key));
  });
  readonly someSelected = computed(() => this.selection().size > 0 && !this.allSelected());

  readonly searchTerm = signal('');
  readonly bucketSummary = signal<BucketSummaryDto | null>(null);
  readonly filteredFolders = computed(() => {
    const t = this.searchTerm().toLowerCase();
    return t
      ? this.folders().filter((f) => this.folderLabel(f).toLowerCase().includes(t))
      : this.folders();
  });
  readonly filteredObjects = computed(() => {
    const t = this.searchTerm().toLowerCase();
    return t
      ? this.objects().filter((o) => this.objectLabel(o).toLowerCase().includes(t))
      : this.objects();
  });
  /** Rows visible on the current page (folders + objects, after search filter). */
  readonly itemCount = computed(() => this.filteredFolders().length + this.filteredObjects().length);
  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('searchBox');
  readonly pageSize = signal(100);
  readonly pageSizes = [25, 50, 100, 250, 1000];
  readonly confirmTitle = signal('');
  readonly confirmDescription = signal('');
  private readonly confirmDialog = viewChild.required(ConfirmDialogComponent);
  private readonly detailSheet = viewChild.required(HlmSheet);
  protected readonly folderDialog = viewChild.required(HlmDialog);

  /** Raw object URL backing previewUrl, kept so it can be revoked. */
  private previewRaw: string | null = null;

  /** (prefix, marker) breadcrumb for back-navigation; the head is the current page. */
  readonly stack: { prefix: string; marker?: string }[] = [];

  ngOnInit(): void {
    this.bucket.set(this.route.snapshot.paramMap.get('name') ?? '');
    // The folder lives in the URL (?prefix=): bookmark/refresh/back restore it.
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((q) => this.applyPrefix(q.get('prefix') ?? ''));
    void this.loadSummary();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent): void {
    if (
      e.key === '/' &&
      !(e.target instanceof HTMLInputElement) &&
      !(e.target instanceof HTMLTextAreaElement)
    ) {
      e.preventDefault();
      this.searchBox()?.nativeElement.focus();
    }
  }

  onSearchEnter(): void {
    const term = this.searchTerm().trim();
    if (!term) return;
    this.navigateTo(this.prefix() + term);
    this.searchTerm.set('');
  }

  onPageSize(size: number): void {
    this.pageSize.set(size);
    this.stack.length = 0;
    this.stack.push({ prefix: this.prefix() });
    void this.load();
  }

  private async loadSummary(): Promise<void> {
    try {
      const summary = await firstValueFrom(this.buckets$.getBucket(this.bucket()));
      this.bucketSummary.set(summary ?? null);
    } catch {
      /* counts are best-effort */
    }
  }

  folderLabel(folder: string): string {
    return folder.slice(this.prefix().length).replace(/\/$/, '');
  }

  objectLabel(o: ObjectListItem): string {
    return o.key.slice(this.prefix().length);
  }

  /** Lucide icon name for an object, picked from its file extension. */
  fileIcon(key: string): string {
    const ext = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1).toLowerCase() : '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico', 'tif', 'tiff'].includes(ext))
      return 'lucideImage';
    if (['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'flv', 'wmv'].includes(ext)) return 'lucideFileVideo';
    if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus'].includes(ext)) return 'lucideFileAudio';
    if (['zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2', 'xz', 'zst'].includes(ext)) return 'lucideFileArchive';
    if (
      [
        'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'html', 'htm', 'css', 'scss', 'py', 'go',
        'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'sh', 'bash', 'yml', 'yaml', 'xml', 'rb', 'php', 'sql', 'toml',
      ].includes(ext)
    )
      return 'lucideFileCode';
    if (['txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'pdf', 'doc', 'docx', 'rtf'].includes(ext))
      return 'lucideFileText';
    return 'lucideFile';
  }

  isSelected(key: string): boolean {
    return this.selection().has(key);
  }

  toggleOne(key: string, checked: boolean): void {
    const next = new Set(this.selection());
    if (checked) next.add(key);
    else next.delete(key);
    this.selection.set(next);
  }

  toggleAll(checked: boolean): void {
    this.selection.set(checked ? new Set(this.objects().map((o) => o.key)) : new Set());
  }

  clearSelection(): void {
    this.selection.set(new Set());
  }

  async bulkDelete(): Promise<void> {
    const keys = [...this.selection()];
    if (keys.length === 0) return;
    this.confirmTitle.set('Delete selected objects?');
    this.confirmDescription.set(
      `Permanently delete ${keys.length} selected object(s)? This cannot be undone.`,
    );
    const ok = await this.confirmDialog().confirm();
    if (!ok) return;
    try {
      const res = await firstValueFrom(
        this.objects$.batchDeleteObjects(this.bucket(), { keys: keys.map((key) => ({ key })) }),
      );
      const deleted = res?.deleted?.length ?? 0;
      const failed = res?.errors?.length ?? 0;
      if (failed > 0) notify.error(`Deleted ${deleted}, ${failed} failed`);
      else notify.success(`Deleted ${deleted} object${deleted === 1 ? '' : 's'}`);
      this.clearSelection();
      await this.load();
      void this.loadSummary();
    } catch {
      notify.error('Bulk delete failed');
    }
  }

  async downloadSelected(): Promise<void> {
    for (const key of [...this.selection()]) {
      await this.download(key);
    }
  }

  async copyKey(o: ObjectListItem): Promise<void> {
    try {
      await navigator.clipboard.writeText(o.key);
      notify.success('Key copied');
    } catch {
      notify.error('Copy failed');
    }
  }

  async copyUrl(o: ObjectListItem): Promise<void> {
    // Path-style S3 URL. The store is mounted under `<mountPath>` too, so the
    // shareable URL must carry the same prefix (e.g. `<origin>/storage/<bucket>/<key>`).
    const url = `${window.location.origin}${resolveMountPrefix()}/${this.bucket()}/${o.key}`;
    try {
      await navigator.clipboard.writeText(url);
      notify.success('URL copied');
    } catch {
      notify.error('Copy failed');
    }
  }

  /** Presign a time-limited share URL (STORY-0615) and copy it to the clipboard. */
  async shareLink(o: ObjectListItem, expiresIn: number): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.objects$.presignObject(this.bucket(), o.key, { expiresIn }),
      );
      await navigator.clipboard.writeText(res.url);
      notify.success(`Share link copied (expires in ${this.expiryLabel(expiresIn)})`);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 400) notify.error('Expiry too long or invalid');
      else if (status === 404) notify.error('Object not found');
      else notify.error('Failed to create share link');
    }
  }

  private expiryLabel(seconds: number): string {
    return seconds >= 604800 ? '7 days' : seconds >= 86400 ? '24 hours' : '1 hour';
  }

  async deleteOne(o: ObjectListItem): Promise<void> {
    this.confirmTitle.set('Delete object?');
    this.confirmDescription.set(
      `Permanently delete "${this.objectLabel(o)}"? This cannot be undone.`,
    );
    const ok = await this.confirmDialog().confirm();
    if (!ok) return;
    try {
      await firstValueFrom(this.objects$.deleteObject(this.bucket(), o.key));
      notify.success('Object deleted');
      await this.load();
      void this.loadSummary();
    } catch {
      notify.error('Failed to delete object');
    }
  }

  /** Jump to a prefix (resets the marker stack to a single root page). */
  /** Change the listing prefix via the URL (`?prefix=`) so folders deep-link. */
  navigateTo(prefix: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { prefix: prefix || null },
      queryParamsHandling: 'merge',
    });
  }

  /** Apply a prefix coming from the URL: reset paging and reload. */
  private applyPrefix(prefix: string): void {
    this.prefix.set(prefix);
    this.stack.length = 0;
    this.stack.push({ prefix });
    void this.load();
  }

  openFolder(commonPrefix: string): void {
    this.navigateTo(commonPrefix);
  }

  /** Descend into the next page, remembering the current marker on the stack. */
  async nextPage(): Promise<void> {
    const marker = this.nextMarker();
    if (!marker) return;
    this.stack.push({ prefix: this.prefix(), marker });
    await this.load();
  }

  /** Pop the current page and reload the previous one. */
  async back(): Promise<void> {
    if (this.stack.length <= 1) return;
    this.stack.pop();
    await this.load();
  }

  async openObject(o: ObjectListItem): Promise<void> {
    this.clearPreview();
    try {
      const meta = await firstValueFrom(this.objects$.getObject(this.bucket(), o.key));
      this.selected.set(meta ?? null);
      // Tags + user-metadata come from the object HEAD already loaded; Versions and
      // Retention/Legal-hold load lazily when their sheet tab is opened (onSheetTab).
      this.sheetLoaded.clear();
      this.versions.set([]);
      this.deleteMarkers.set([]);
      this.tagRows.set(Object.entries(meta?.tagging ?? {}).map(([key, value]) => ({ key, value })));
      this.userMeta.set(
        Object.entries(meta?.userMetadata ?? {}).map(([key, value]) => ({ key, value })),
      );
      if (meta) {
        this.detailSheet().open();
        await this.loadPreview(o.key, meta);
      }
    } catch {
      notify.error('Failed to load object details');
    }
  }

  /** Inline preview for image / pdf / video / audio (fetched with auth as a blob). */
  private async loadPreview(key: string, meta: ObjectMetaDto): Promise<void> {
    const kind = this.previewKindFor(meta.contentType);
    this.previewKind.set(kind);
    this.previewTooLarge.set(false);
    if (!kind) return;
    if ((meta.size ?? 0) > this.maxPreviewBytes) {
      this.previewTooLarge.set(true);
      return;
    }
    this.previewLoading.set(true);
    try {
      const blob = await firstValueFrom(
        this.http.get(this.contentUrl(key), { responseType: 'blob' }),
      );
      this.previewRaw = URL.createObjectURL(blob);
      if (kind === 'pdf') {
        this.previewPdf.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.previewRaw));
      } else {
        this.previewUrl.set(this.sanitizer.bypassSecurityTrustUrl(this.previewRaw));
      }
    } catch {
      /* preview is best-effort; the metadata panel still shows */
    } finally {
      this.previewLoading.set(false);
    }
  }

  private previewKindFor(ct: string | undefined): 'image' | 'pdf' | 'video' | 'audio' | null {
    if (!ct) return null;
    if (ct.startsWith('image/')) return 'image';
    if (ct === 'application/pdf') return 'pdf';
    if (ct.startsWith('video/')) return 'video';
    if (ct.startsWith('audio/')) return 'audio';
    return null;
  }

  /** Create a zero-byte folder marker (key ending in `/`) under the current prefix. */
  async createFolder(): Promise<void> {
    const name = this.newFolderName().trim().replace(/^\/+|\/+$/g, '');
    if (!name || name.includes('/')) {
      notify.error('Enter a single folder name (no slashes)');
      return;
    }
    const key = this.prefix() + name + '/';
    try {
      await firstValueFrom(
        this.http.put(
          `/api/admin/buckets/${this.bucket()}/objects/${encodeURIComponent(key)}`,
          '',
          { headers: { 'Content-Type': 'application/x-directory' } },
        ),
      );
      notify.success('Folder created');
      this.newFolderName.set('');
      this.folderDialog().close();
      await this.load();
    } catch {
      notify.error('Failed to create folder');
    }
  }

  /** Fetch the bytes (authenticated) and trigger a browser download. */
  async download(key: string): Promise<void> {
    try {
      const blob = await firstValueFrom(
        this.http.get(this.contentUrl(key, true), { responseType: 'blob' }),
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = key.split('/').pop() ?? 'download';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      notify.error('Download failed');
    }
  }

  /** Sheet tabs whose data has been fetched for the current object (reset per open). */
  private readonly sheetLoaded = new Set<string>();

  /** Lazy-load a sheet tab's data the first time it's opened for this object. */
  onSheetTab(tab: string): void {
    const key = this.selected()?.key;
    if (!key || this.sheetLoaded.has(tab)) return;
    this.sheetLoaded.add(tab);
    if (tab === 'versions') {
      void this.loadVersions(key);
    } else if (tab === 'retention') {
      void this.loadRetention(key);
      void this.loadLegalHold(key);
    }
  }

  /** Load the version history + delete markers for the open object (versioned buckets). */
  private async loadVersions(key: string): Promise<void> {
    this.versions.set([]);
    this.deleteMarkers.set([]);
    try {
      const res = await firstValueFrom(this.objects$.listObjectVersions(this.bucket(), key));
      this.versions.set((res?.versions ?? []).filter((v) => v.key === key));
      this.deleteMarkers.set((res?.deleteMarkers ?? []).filter((m) => m.key === key));
    } catch {
      /* versioning may be disabled; leave empty */
    }
  }

  async downloadVersion(key: string, versionId: string): Promise<void> {
    try {
      const blob = await firstValueFrom(
        this.http.get(this.contentUrl(key, true, versionId), { responseType: 'blob' }),
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = key.split('/').pop() ?? 'download';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      notify.error('Download failed');
    }
  }

  async deleteVersion(key: string, versionId: string): Promise<void> {
    this.confirmTitle.set('Delete version?');
    this.confirmDescription.set(`Permanently delete this version of "${key}"? This cannot be undone.`);
    const ok = await this.confirmDialog().confirm();
    if (!ok) return;
    const encoded = encodeURIComponent(key);
    try {
      await firstValueFrom(
        this.http.delete(
          `/api/admin/buckets/${this.bucket()}/objects/${encoded}?versionId=${encodeURIComponent(versionId)}`,
        ),
      );
      notify.success('Version deleted');
      await this.loadVersions(key);
      await this.load();
      void this.loadSummary();
    } catch {
      notify.error('Failed to delete version');
    }
  }

  addTag(): void {
    this.tagRows.update((r) => [...r, { key: '', value: '' }]);
  }

  removeTag(index: number): void {
    this.tagRows.update((r) => r.filter((_, i) => i !== index));
  }

  setTag(index: number, field: 'key' | 'value', value: string): void {
    this.tagRows.update((r) => r.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  async saveTags(): Promise<void> {
    const key = this.selected()?.key;
    if (!key) return;
    const tags: Record<string, string> = {};
    for (const r of this.tagRows()) {
      const k = r.key.trim();
      if (k) tags[k] = r.value;
    }
    try {
      if (Object.keys(tags).length === 0) {
        await firstValueFrom(this.objects$.deleteObjectTagging(this.bucket(), key));
      } else {
        await firstValueFrom(this.objects$.putObjectTagging(this.bucket(), key, { tags }));
      }
      notify.success('Tags saved');
    } catch {
      notify.error('Failed to save tags');
    }
  }

  private async loadRetention(key: string): Promise<void> {
    try {
      const r = await firstValueFrom(this.objects$.getObjectRetention(this.bucket(), key));
      this.retention.set(r);
      this.retainUntilEdit.set((r.retainUntil ?? '').slice(0, 10));
    } catch {
      this.retention.set(null);
      this.retainUntilEdit.set('');
    }
  }

  private async loadLegalHold(key: string): Promise<void> {
    try {
      const h = await firstValueFrom(this.objects$.getObjectLegalHold(this.bucket(), key));
      this.legalHoldOn.set(h.status === LegalHoldDtoStatusEnum.On);
      this.lockSupported.set(true);
    } catch {
      this.lockSupported.set(false);
      this.legalHoldOn.set(false);
    }
  }

  async toggleLegalHold(on: boolean): Promise<void> {
    const key = this.selected()?.key;
    if (!key) return;
    try {
      await firstValueFrom(
        this.objects$.putObjectLegalHold(this.bucket(), key, {
          status: on ? LegalHoldDtoStatusEnum.On : LegalHoldDtoStatusEnum.Off,
        }),
      );
      this.legalHoldOn.set(on);
      notify.success('Legal hold updated');
    } catch {
      notify.error('Failed to update legal hold');
    }
  }

  async saveRetention(): Promise<void> {
    const key = this.selected()?.key;
    if (!key) return;
    const date = this.retainUntilEdit();
    if (!date) {
      notify.error('Choose a retention date');
      return;
    }
    try {
      await firstValueFrom(
        this.objects$.putObjectRetention(this.bucket(), key, {
          mode: RetentionDtoModeEnum.Governance,
          retainUntil: `${date}T00:00:00.000Z`,
        }),
      );
      notify.success('Retention updated');
      await this.loadRetention(key);
    } catch {
      notify.error('Failed to update retention');
    }
  }

  closeMeta(): void {
    this.clearPreview();
    this.selected.set(null);
  }

  /** Re-list the current prefix (e.g. after an upload). */
  onUploaded(): void {
    void this.load();
    void this.loadSummary();
  }

  private contentUrl(key: string, download = false, versionId?: string): string {
    const encoded = encodeURIComponent(key); // exactly once; backend decodes once
    const v = versionId ? `&versionId=${encodeURIComponent(versionId)}` : '';
    return `/api/admin/buckets/${this.bucket()}/objects/${encoded}?${download ? 'download' : 'content'}${v}`;
  }

  private clearPreview(): void {
    if (this.previewRaw) {
      URL.revokeObjectURL(this.previewRaw);
      this.previewRaw = null;
    }
    this.previewUrl.set(null);
    this.previewPdf.set(null);
    this.previewKind.set(null);
    this.previewTooLarge.set(false);
    this.previewLoading.set(false);
  }

  /** List using the page at the top of the stack. */
  private async load(): Promise<void> {
    const top = this.stack[this.stack.length - 1];
    this.loading.set(true);
    this.error.set(null);
    this.clearPreview();
    this.selected.set(null);
    this.selection.set(new Set());
    try {
      const res = await firstValueFrom(
        // Generated client takes positional query params: (name, prefix, delimiter, marker, limit).
        this.objects$.listObjects(this.bucket(), top.prefix, '/', top.marker, this.pageSize()),
      );
      this.folders.set(res?.commonPrefixes ?? []);
      // Hide the zero-byte folder marker for the current prefix (its key === prefix).
      this.objects.set((res?.contents ?? []).filter((o) => o.key !== top.prefix));
      this.nextMarker.set(res?.isTruncated ? res?.nextMarker : undefined);
    } catch {
      this.error.set('Failed to list objects.');
      notify.error('Failed to list objects');
    } finally {
      this.loading.set(false);
    }
  }
}
