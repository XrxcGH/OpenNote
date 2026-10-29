// The custom vocabulary as plain text (Phase 12): one term to a line, an optional `| mishearing, mishearing` after it,
// and `#` for a note. The Rust crate reads the same format (crates/intel/src/vocabulary), so what this file writes is
// what the transcriber prefers. The list stays on this device, one for each notebook.

/** The most terms a list holds, as in the crate. */
export const MAX_TERMS = 5000;
/** The most characters in a term or a mishearing, as in the crate. */
export const MAX_TERM_CHARS = 80;

export interface VocabularyEntry {
  term: string;
  heardAs: string[];
}

const collapse = (text: string): string => text.trim().split(/\s+/).join(' ');
const valid = (text: string): boolean => text !== '' && text.length <= MAX_TERM_CHARS && /[\p{L}\p{N}]/u.test(text);
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Reads the plain-text form. Empty lines and notes are skipped, and a repeated term joins the first. */
export function parseVocabulary(text: string): VocabularyEntry[] {
  const entries: VocabularyEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [termPart = '', heardPart = ''] = line.split('|', 2);
    const term = collapse(termPart);
    if (!valid(term)) continue;
    let entry = entries.find((one) => same(one.term, term));
    if (!entry) {
      if (entries.length >= MAX_TERMS) continue;
      entry = { term, heardAs: [] };
      entries.push(entry);
    }
    for (const alias of heardPart.split(',').map(collapse)) {
      const known = entry.heardAs.some((one) => same(one, alias));
      if (valid(alias) && !same(alias, term) && !known) entry.heardAs.push(alias);
    }
  }
  return entries;
}

/** The plain-text form of the entries, which `parseVocabulary` reads back. */
export function formatVocabulary(entries: readonly VocabularyEntry[]): string {
  return entries
    .map((entry) => (entry.heardAs.length > 0 ? `${entry.term} | ${entry.heardAs.join(', ')}\n` : `${entry.term}\n`))
    .join('');
}

/** How many terms the text lists. */
export function countTerms(text: string): number {
  return parseVocabulary(text).length;
}

/**
 * The text with a term added, and the mishearing recorded with it. Notes and the person's own layout stay where they
 * are: a term already listed gets the mishearing on its line, and a new term goes at the end.
 */
export function addTerm(text: string, term: string, heardAs?: string): string {
  const wanted = collapse(term);
  const heard = heardAs ? collapse(heardAs) : '';
  if (!valid(wanted) || (heard && (!valid(heard) || same(heard, wanted)))) return text;
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((line) => {
    const trimmed = line.trim();
    return trimmed !== '' && !trimmed.startsWith('#') && same(collapse(trimmed.split('|', 1)[0] ?? ''), wanted);
  });
  if (at < 0) {
    const body = text === '' || text.endsWith('\n') ? text : `${text}\n`;
    return `${body}${heard ? `${wanted} | ${heard}` : wanted}\n`;
  }
  if (!heard) return text;
  const entry = parseVocabulary(lines[at] ?? '')[0];
  if (!entry || entry.heardAs.some((one) => same(one, heard))) return text;
  lines[at] = `${entry.term} | ${[...entry.heardAs, heard].join(', ')}`;
  return lines.join('\n');
}

/** The text without a term. */
export function removeTerm(text: string, term: string): string {
  const wanted = collapse(term);
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.startsWith('#') || trimmed === '' || !same(collapse(trimmed.split('|', 1)[0] ?? ''), wanted);
    })
    .join('\n');
}

/** The file name a notebook's list is kept under in this device's store. */
export function vocabularyFile(notebookId: string | null): string {
  const safe = (notebookId ?? 'all').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60);
  return `vocabulary-${safe}.txt`;
}
