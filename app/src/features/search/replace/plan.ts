// Replace across a notebook, the part that decides: where a word appears in a page, and what the page would hold
// after each match is replaced or left alone. Text blocks, table cells, and the descriptions of pictures and
// drawings are changed. Nothing here writes; apply.ts does that from the matches the person kept.
import type { BlockJson, PageJson } from '../../../services/pages/types';

export interface ReplaceOptions {
  matchCase: boolean;
  wholeWord: boolean;
}

/** Where a piece of text sits in a block. */
export type Field =
  | { kind: 'text' }
  | { kind: 'cell'; row: string; column: string }
  | { kind: 'alt' };

export interface Match {
  /** Unique within a plan. */
  id: string;
  page: string;
  pageTitle: string;
  block: string;
  blockType: string;
  field: Field;
  /** UTF-16 offsets in the field's text. */
  start: number;
  end: number;
  /** The words around the match, with the match inside. */
  before: string;
  found: string;
  after: string;
}

const CONTEXT = 40;
const WORD = /[\p{L}\p{N}_]/u;

/** The places a word starts in the text. */
export function findMatches(text: string, find: string, options: ReplaceOptions): { start: number; end: number }[] {
  if (find === '') return [];
  const haystack = options.matchCase ? text : text.toLowerCase();
  const needle = options.matchCase ? find : find.toLowerCase();
  const found: { start: number; end: number }[] = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
    const end = at + needle.length;
    if (options.wholeWord) {
      const left = text[at - 1];
      const right = text[end];
      if ((left !== undefined && WORD.test(left)) || (right !== undefined && WORD.test(right))) continue;
    }
    found.push({ start: at, end });
  }
  return found;
}

/** The text with the chosen matches replaced. `chosen` holds the matches' start offsets. */
export function replaceAt(text: string, matches: readonly { start: number; end: number }[], replacement: string): string {
  let out = text;
  for (const { start, end } of [...matches].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, start) + replacement + out.slice(end);
  }
  return out;
}

function fieldTexts(block: BlockJson): { field: Field; text: string }[] {
  const data = block.data;
  if (block.type === 'text' && typeof data.markdown === 'string') return [{ field: { kind: 'text' }, text: data.markdown }];
  if (block.type === 'table' && Array.isArray(data.rows)) {
    const cells: { field: Field; text: string }[] = [];
    for (const row of data.rows as { id: string; cells?: Record<string, { markdown?: string }> }[]) {
      for (const [column, cell] of Object.entries(row.cells ?? {})) {
        if (typeof cell?.markdown === 'string') cells.push({ field: { kind: 'cell', row: row.id, column }, text: cell.markdown });
      }
    }
    return cells;
  }
  if (typeof data.alt === 'string' && data.alt !== '') return [{ field: { kind: 'alt' }, text: data.alt }];
  return [];
}

/** Every match of `find` in a page, in reading order. */
export function planPage(page: PageJson, find: string, options: ReplaceOptions): Match[] {
  const matches: Match[] = [];
  for (const block of page.blocks) {
    for (const { field, text } of fieldTexts(block)) {
      for (const { start, end } of findMatches(text, find, options)) {
        matches.push({
          id: `${block.id}:${field.kind === 'cell' ? `${field.row}.${field.column}` : field.kind}:${start}`,
          page: page.id,
          pageTitle: page.title,
          block: block.id,
          blockType: block.type,
          field,
          start,
          end,
          before: text.slice(Math.max(0, start - CONTEXT), start),
          found: text.slice(start, end),
          after: text.slice(end, end + CONTEXT),
        });
      }
    }
  }
  return matches;
}

/** Whether the block still holds the text the plan read, so a change made in the meantime is not overwritten. */
export function fieldText(block: BlockJson, field: Field): string | null {
  return fieldTexts(block).find((candidate) => sameField(candidate.field, field))?.text ?? null;
}

export function sameField(a: Field, b: Field): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== 'cell' || (b.kind === 'cell' && a.row === b.row && a.column === b.column);
}
