// Reading caption files: WebVTT (Vimeo) and SubRip (YouTube) into timed lines. The text is plain text: tags and
// styling in a caption are dropped, and the same words that follow each other are joined into one line.
import type { TranscriptLine } from './model';

/** "00:01:02.500", "01:02.500", or "00:01:02,500" as milliseconds; null when it isn't a time. */
export function clockMs(text: string): number | null {
  const match = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(text.trim());
  if (!match) return null;
  const [, hours = '0', minutes = '0', seconds = '0', fraction = '0'] = match;
  return (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000 + Number(fraction.padEnd(3, '0'));
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** The text without tags. It repeats until nothing is left to remove, so pieces can't join into a new tag. */
const withoutTags = (text: string): string => {
  let current = text;
  for (let pass = 0; pass < 20; pass += 1) {
    const next = current.replace(/<[^>]*>/g, '');
    if (next === current) break;
    current = next;
  }
  return current;
};

const plain = (text: string): string =>
  withoutTags(text)
    .replace(/\{\[^}]*\}/g, '')
    .replace(/&(#\d+|[a-z]+);/gi, (whole, name: string) =>
      name.startsWith('#') ? String.fromCodePoint(Number(name.slice(1))) : (ENTITIES[name.toLowerCase()] ?? whole),
    )
    .replace(/\s+/g, ' ')
    .trim();

/** The most lines a transcript keeps, so a very long video can't fill the page's file. */
export const MAX_LINES = 20_000;

/** Timed lines from a WebVTT or SubRip file. Anything that isn't a cue is skipped. */
export function parseCaptions(source: string): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  const blocks = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/);
  for (const block of blocks) {
    const rows = block.split('\n');
    const at = rows.findIndex((row) => row.includes('-->'));
    if (at < 0) continue;
    const start = clockMs((rows[at] ?? '').split('-->')[0] ?? '');
    if (start === null) continue;
    const text = plain(rows.slice(at + 1).join(' '));
    if (text === '') continue;
    const last = lines[lines.length - 1];
    // Rolling captions repeat the line before; the repeat adds nothing.
    if (last && last.text === text) continue;
    lines.push({ startMs: start, text });
    if (lines.length >= MAX_LINES) break;
  }
  return lines;
}

/** The transcript as the words of a page: one paragraph for each minute, each starting with its time. */
export function transcriptMarkdown(lines: readonly TranscriptLine[]): string[] {
  const out: string[] = [];
  let minute = -1;
  for (const line of lines) {
    const at = Math.floor(line.startMs / 60_000);
    if (at !== minute) {
      minute = at;
      out.push(`[${clockText(line.startMs)}] ${line.text}`);
    } else out[out.length - 1] += ` ${line.text}`;
  }
  return out;
}

/** "1:05" or "1:02:03". */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}
