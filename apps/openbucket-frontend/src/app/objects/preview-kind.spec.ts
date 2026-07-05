import { classifyPreview, PREVIEW_CAPS } from './preview-kind';
import { fileIcon } from './object-icon';

/**
 * TEST-1100 — preview-kind classifier truth table + caps (TASK-3302). Locks the
 * SVG-never-inline rule (mirrors the server neutralization), the generic
 * content-type extension fallback, and the per-kind cap logic.
 */
describe('classifyPreview (TEST-1100)', () => {
  it('image/* → image with the image cap', () => {
    expect(classifyPreview('image/png', 'a.png', 10)).toEqual({
      kind: 'image',
      capBytes: PREVIEW_CAPS.image,
      overCap: false,
    });
  });

  it('image/svg+xml → null (never inline SVG)', () => {
    expect(classifyPreview('image/svg+xml', 'x.svg', 10)).toEqual({
      kind: null,
      capBytes: 0,
      overCap: false,
    });
  });

  it('strips charset params before matching', () => {
    expect(classifyPreview('text/plain; charset=utf-8', 'a.txt', 10).kind).toBe('text');
    expect(classifyPreview('IMAGE/PNG', 'a.png', 10).kind).toBe('image');
  });

  it('application/pdf → pdf', () => {
    expect(classifyPreview('application/pdf', 'a.pdf', 10).kind).toBe('pdf');
  });

  it('json / xml / structured-suffix application types → text', () => {
    expect(classifyPreview('application/json', 'a.json', 10).kind).toBe('text');
    expect(classifyPreview('application/xml', 'a.xml', 10).kind).toBe('text');
    expect(classifyPreview('application/vnd.api+json', 'a', 10).kind).toBe('text');
    expect(classifyPreview('application/atom+xml', 'a', 10).kind).toBe('text');
  });

  it('video/* and audio/* map to their kinds', () => {
    expect(classifyPreview('video/mp4', 'a.mp4', 10).kind).toBe('video');
    expect(classifyPreview('audio/mpeg', 'a.mp3', 10).kind).toBe('audio');
  });

  it('generic octet-stream falls back to the extension (a.ts → text)', () => {
    expect(classifyPreview('application/octet-stream', 'a.ts', 100).kind).toBe('text');
  });

  it('generic octet-stream with an image extension → image; svg still null', () => {
    expect(classifyPreview('application/octet-stream', 'p.png', 100).kind).toBe('image');
    expect(classifyPreview('', 'p.svg', 100).kind).toBe(null);
  });

  it('generic octet-stream with a pdf extension → pdf', () => {
    expect(classifyPreview('application/octet-stream', 'doc.pdf', 100).kind).toBe('pdf');
  });

  it('unknown / extensionless generic → null', () => {
    expect(classifyPreview('application/octet-stream', 'noext', 100).kind).toBe(null);
    expect(classifyPreview('application/zip', 'a.zip', 100).kind).toBe(null);
  });

  it('overCap is true for a non-text kind above its cap', () => {
    expect(classifyPreview('image/png', 'a.png', 30 * 1024 * 1024).overCap).toBe(true);
    expect(classifyPreview('application/pdf', 'a.pdf', 60 * 1024 * 1024).overCap).toBe(true);
  });

  it('text is never overCap (fetched via Range)', () => {
    expect(classifyPreview('text/plain', 'huge.log', 5 * 1024 * 1024 * 1024).overCap).toBe(false);
  });
});

describe('fileIcon (shared map, TEST-1100)', () => {
  it('maps extensions to the same lucide icons as before', () => {
    expect(fileIcon('a.png')).toBe('lucideImage');
    expect(fileIcon('a.mp4')).toBe('lucideFileVideo');
    expect(fileIcon('a.mp3')).toBe('lucideFileAudio');
    expect(fileIcon('a.zip')).toBe('lucideFileArchive');
    expect(fileIcon('a.ts')).toBe('lucideFileCode');
    expect(fileIcon('a.txt')).toBe('lucideFileText');
    expect(fileIcon('a.pdf')).toBe('lucideFileText');
    expect(fileIcon('noext')).toBe('lucideFile');
  });
});
