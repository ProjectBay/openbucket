import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { BucketsAdminService, ObjectSearchResponseDto, ObjectsAdminService } from '@openbucket/api-client';
import { of } from 'rxjs';

import { ObjectSearchComponent } from './object-search.component';

/**
 * TEST-1101 (case 10) — ObjectSearchComponent with mocked services. Covers the
 * keyset cursor stack (Next pushes / Prev pops with no repeats), the fetched
 * result mapping, and the `contains` < 2-char client guard.
 *
 * Aligned with the parked frontend jest harness convention (see
 * object-preview.component.spec.ts); the component is also build-verified.
 */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r));

function page(partial: Partial<ObjectSearchResponseDto>): ObjectSearchResponseDto {
  return { results: [], isTruncated: false, ...partial };
}

describe('ObjectSearchComponent (TEST-1101)', () => {
  let fixture: ComponentFixture<ObjectSearchComponent>;
  let cmp: ObjectSearchComponent;
  let search: jest.Mock;

  beforeEach(() => {
    search = jest.fn().mockReturnValue(of(page({})));
    const objects = { searchObjects: search };
    const buckets = { listBuckets: jest.fn().mockReturnValue(of({ buckets: [], total: 0 })) };

    TestBed.configureTestingModule({
      imports: [ObjectSearchComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: ObjectsAdminService, useValue: objects },
        { provide: BucketsAdminService, useValue: buckets },
      ],
    });
    fixture = TestBed.createComponent(ObjectSearchComponent);
    cmp = fixture.componentInstance;
    fixture.detectChanges(); // ngOnInit
  });

  it('prefixOf returns the parent folder (or root)', () => {
    expect(cmp.prefixOf('a/b/c.txt')).toBe('a/b/');
    expect(cmp.prefixOf('top.txt')).toBe('');
  });

  it('submit fetches page 1 (cursor undefined) and stores results + nextCursor', async () => {
    search.mockReturnValue(
      of(page({ results: [{ bucket: 'b', key: 'k', size: 1, etag: 'e', lastModified: 'x', storageClass: 'STANDARD' }], isTruncated: true, nextCursor: 'C1' })),
    );
    cmp.q.set('log');
    cmp.submit();
    await tick();

    expect(search).toHaveBeenLastCalledWith('log', 'prefix', undefined, undefined, undefined, undefined, 50);
    expect(cmp.results().length).toBe(1);
    expect(cmp.nextCursor()).toBe('C1');
    expect(cmp.canPrev()).toBe(false);
  });

  it('Next pushes the keyset cursor and Prev pops it — no repeats', async () => {
    cmp.q.set('log');
    search.mockReturnValue(of(page({ isTruncated: true, nextCursor: 'C1' })));
    cmp.submit();
    await tick();

    // Next → fetch with C1.
    search.mockReturnValue(of(page({ isTruncated: true, nextCursor: 'C2' })));
    cmp.next();
    await tick();
    expect(search).toHaveBeenLastCalledWith('log', 'prefix', undefined, undefined, undefined, 'C1', 50);
    expect(cmp.canPrev()).toBe(true);

    // Prev → back to page 1 (cursor undefined), not a repeat of C1.
    search.mockReturnValue(of(page({ isTruncated: true, nextCursor: 'C1' })));
    cmp.prev();
    await tick();
    expect(search).toHaveBeenLastCalledWith('log', 'prefix', undefined, undefined, undefined, undefined, 50);
    expect(cmp.canPrev()).toBe(false);
  });

  it('contains with < 2 chars disables submit and issues no request', async () => {
    cmp.mode.set('contains');
    cmp.q.set('a');
    expect(cmp.submitDisabled()).toBe(true);
    search.mockClear();
    cmp.submit();
    await tick();
    expect(search).not.toHaveBeenCalled();
  });

  it('only sends a tag filter when BOTH key and value are present', async () => {
    cmp.q.set('log');
    cmp.tagKey.set('env'); // value still empty
    search.mockReturnValue(of(page({})));
    cmp.submit();
    await tick();
    expect(search).toHaveBeenLastCalledWith('log', 'prefix', undefined, undefined, undefined, undefined, 50);

    cmp.tagValue.set('prod');
    cmp.submit();
    await tick();
    expect(search).toHaveBeenLastCalledWith('log', 'prefix', undefined, 'env', 'prod', undefined, 50);
  });
});
