/**
 * Shared file-type mapping (STORY-1100 / TASK-3302). Extracted verbatim from the
 * former `ObjectBrowserComponent.fileIcon` so the icon column and the preview
 * classifier ([preview-kind.ts]) can never disagree on what a file "is". Both the
 * lucide icon name and the coarse category derive from the same extension sets.
 */

/** Coarse file category derived from a key's extension. */
export type FileCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'code'
  | 'text'
  | 'pdf'
  | 'other';

const IMAGE = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico', 'tif', 'tiff',
]);
const VIDEO = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'flv', 'wmv']);
const AUDIO = new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus']);
const ARCHIVE = new Set(['zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2', 'xz', 'zst']);
const CODE = new Set([
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'html', 'htm', 'css', 'scss', 'py', 'go',
  'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'sh', 'bash', 'yml', 'yaml', 'xml', 'rb', 'php', 'sql', 'toml',
]);
const TEXT = new Set(['txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'doc', 'docx', 'rtf']);

/** Lower-cased extension of a key, or '' when the key has no dot. */
export function extOf(key: string): string {
  return key.includes('.') ? key.slice(key.lastIndexOf('.') + 1).toLowerCase() : '';
}

/** Map an extension to a coarse category (used by the icon column + classifier). */
export function categoryFor(ext: string): FileCategory {
  const e = ext.toLowerCase();
  if (IMAGE.has(e)) return 'image';
  if (VIDEO.has(e)) return 'video';
  if (AUDIO.has(e)) return 'audio';
  if (ARCHIVE.has(e)) return 'archive';
  if (e === 'pdf') return 'pdf';
  if (CODE.has(e)) return 'code';
  if (TEXT.has(e)) return 'text';
  return 'other';
}

const ICON: Record<FileCategory, string> = {
  image: 'lucideImage',
  video: 'lucideFileVideo',
  audio: 'lucideFileAudio',
  archive: 'lucideFileArchive',
  code: 'lucideFileCode',
  text: 'lucideFileText',
  pdf: 'lucideFileText',
  other: 'lucideFile',
};

/** Lucide icon name for an object, picked from its file extension. */
export function fileIcon(key: string): string {
  return ICON[categoryFor(extOf(key))];
}
