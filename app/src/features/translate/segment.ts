// Translating text without breaking its formatting (A3-25). A line of Markdown is split into its lead (the heading
// marks, list bullets, check boxes, and quote marks), and its words. The parts of the words that are not language
// (code, links, pictures, math, and the marks of bold and italic) are swapped for numbered placeholders that the
// engine must give back, and are put back after. A line whose placeholders did not all come back is left in its
// original words, so formatting is never lost to a bad translation.
//
// Plain functions on plain strings, so every rule is tested without an engine.

/** A placeholder: a number between brackets that no language translates. */
const OPEN = '⟦';
const CLOSE = '⟧';
const PLACEHOLDER = new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g');

const LEAD = /^(\s*(?:#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+))*/;

/** What is protected inside the words: code spans, math, pictures, links' addresses, and the marks of bold and italic. */
const PROTECTED: readonly RegExp[] = [
  /`[^`]*`/g,
  /\$\$[^$]+\$\$|\$[^$\n]+\$/g,
  /!\[[^\]]*\]\([^)]*\)/g,
  /\]\([^)]*\)/g,
  /<[^>\n]+>/g,
  /https?:\/\/[^\s)]+/g,
  /\*\*|__|~~|==|\*|_(?=\S)|(?<=\S)_/g,
];

export interface Line {
  /** The lead of the line, kept as it is. */
  lead: string;
  /** The words with placeholders in them. Empty when there is nothing to translate. */
  text: string;
  /** What each placeholder stands for. */
  held: string[];
}

/** Splits one line of Markdown. */
export function splitLine(line: string): Line {
  const lead = LEAD.exec(line)?.[0] ?? '';
  const rest = line.slice(lead.length);
  const held: string[] = [];
  let text = rest;
  for (const pattern of PROTECTED) {
    text = text.replace(pattern, (found) => {
      held.push(found);
      return `${OPEN}${held.length - 1}${CLOSE}`;
    });
  }
  return { lead, text, held };
}

/** Whether a line has any words to translate: letters outside the placeholders. */
export function hasWords(line: Line): boolean {
  return /\p{L}/u.test(line.text.replace(PLACEHOLDER, ''));
}

/** Puts the held parts back. Null when the translation lost or invented a placeholder. */
export function restore(line: Line, translated: string): string | null {
  const seen: number[] = [];
  const text = translated.replace(PLACEHOLDER, (_, n: string) => {
    seen.push(Number(n));
    return line.held[Number(n)] ?? '';
  });
  const wanted = line.held.map((_, i) => i).sort((a, b) => a - b);
  if (seen.length !== wanted.length || [...seen].sort((a, b) => a - b).some((n, i) => n !== wanted[i])) return null;
  return `${line.lead}${text.trim()}`;
}

export interface Plan {
  /** The lines of the document. */
  lines: Line[];
  /** The lines that have words, and so go to the engine, in order. */
  send: number[];
}

/** Plans the translation of a Markdown document, line by line. Fenced code is left alone. */
export function plan(markdown: string): Plan {
  let fenced = false;
  const lines = markdown.split('\n').map((raw): Line => {
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced;
      return { lead: raw, text: '', held: [] };
    }
    if (fenced) return { lead: raw, text: '', held: [] };
    return splitLine(raw);
  });
  return { lines, send: lines.flatMap((line, i) => (hasWords(line) ? [i] : [])) };
}

/** The translated document, given the engine's answer for each line that was sent. Lines it spoiled stay as they were. */
export function assemble(
  markdown: string,
  planned: Plan,
  translated: readonly string[],
): { text: string; kept: number } {
  const original = markdown.split('\n');
  let kept = 0;
  const out = planned.lines.map((line, i) => {
    const at = planned.send.indexOf(i);
    if (at === -1) return original[i] ?? '';
    const restored = restore(line, translated[at] ?? '');
    if (restored === null || restored.trim() === '') {
      kept += 1;
      return original[i] ?? '';
    }
    return restored;
  });
  return { text: out.join('\n'), kept };
}
