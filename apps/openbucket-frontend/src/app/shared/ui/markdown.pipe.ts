import { Pipe, PipeTransform } from '@angular/core';

/** HTML-escape before any markup is added. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Inline spans: `code`, **bold**, and [text](url) links. */
function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code class="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-foreground font-semibold">$1</strong>')
    .replace(
      /\[([^\]]+)\]\(([^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener" class="text-primary underline">$1</a>',
    );
}

/**
 * Minimal, dependency-free Markdown → HTML for release notes (headings, bullet
 * lists, **bold**, `code`, links, paragraphs — the subset the CHANGELOG uses).
 * Output is bound via `[innerHTML]`, so Angular's sanitizer strips anything unsafe
 * while keeping the styling classes.
 */
function render(src: string): string {
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  for (const raw of src.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      out.push(
        `<h4 class="text-foreground mt-3 mb-1 text-sm font-semibold first:mt-0">${inline(heading[2])}</h4>`,
      );
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      if (!inList) {
        out.push('<ul class="my-1 ml-4 list-disc space-y-1">');
        inList = true;
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p class="my-1">${inline(line)}</p>`);
  }
  closeList();
  return out.join('');
}

@Pipe({ name: 'md', standalone: true })
export class MarkdownPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return value ? render(value) : '';
  }
}
