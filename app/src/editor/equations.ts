// Equation numbers and cross-references (flag doc.equationNumbers). A display equation is numbered when its source
// holds `\label{key}`; the number is its place among the labeled equations, so moving one renumbers the rest and every
// reference follows. A reference is the inline equation `$\eqref{key}$`. Pure text logic: the editor, the exports, and
// the commands all read it.

const KEY = '[A-Za-z0-9:_.-]{1,64}';
const LABEL = new RegExp(`\\\\label\\{(${KEY})\\}`);
const LABELS = new RegExp(`[ \\t]*\\\\label\\{${KEY}\\}`, 'g');
const REF_SOURCE = new RegExp(`^\\s*\\\\eqref\\{(${KEY})\\}\\s*$`);

/** The text shown for a reference that points at no equation, as LaTeX does. */
export const UNRESOLVED = '(??)';

export const labelOf = (source: string): string | null => LABEL.exec(source)?.[1] ?? null;

/** The key an inline equation refers to, or null when its source is not a reference. */
export const refKey = (source: string): string | null => REF_SOURCE.exec(source)?.[1] ?? null;

export const refSource = (key: string): string => `\\eqref{${key}}`;

/** The source without any label, so it can be drawn. */
export const stripLabels = (source: string): string => source.replace(LABELS, '').trimEnd();

export const withLabel = (source: string, key: string): string => `${stripLabels(source)} \\label{${key}}`.trimStart();

/** The first `eq-N` not in `taken`. */
export function freeLabel(taken: ReadonlySet<string>): string {
  let n = 1;
  while (taken.has(`eq-${n}`)) n += 1;
  return `eq-${n}`;
}

export interface Numbering {
  /** Per input equation: its number, or null when it has no label or repeats an earlier one. */
  readonly numbers: readonly (number | null)[];
  readonly byKey: ReadonlyMap<string, number>;
  /** Indexes of equations whose label was already used above them. */
  readonly duplicates: readonly number[];
}

/** Numbers the labeled equations, in the order given. */
export function numberEquations(sources: readonly string[]): Numbering {
  const byKey = new Map<string, number>();
  const duplicates: number[] = [];
  const numbers = sources.map((source, i) => {
    const key = labelOf(source);
    if (key === null) return null;
    if (byKey.has(key)) {
      duplicates.push(i);
      return null;
    }
    const n = byKey.size + 1;
    byKey.set(key, n);
    return n;
  });
  return { numbers, byKey, duplicates };
}

export const formatNumber = (n: number): string => `(${n})`;

export const formatRef = (key: string, byKey: ReadonlyMap<string, number>): string => {
  const n = byKey.get(key);
  return n === undefined ? UNRESOLVED : formatNumber(n);
};

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const INLINE = new RegExp(`\`[^\`\\n]*\`|\\$\\s*\\\\eqref\\{(${KEY})\\}\\s*\\$`, 'g');

type Segment = { math: false; text: string } | { math: true; open: string; lines: string[]; close: string | null };

function segments(markdown: string): Segment[] {
  const out: Segment[] = [];
  const text: string[] = [];
  const flush = () => {
    if (text.length > 0) out.push({ math: false, text: text.join('\n') });
    text.length = 0;
  };
  const lines = markdown.split('\n');
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const f = FENCE.exec(line)?.[1];
    if (fence !== null) {
      if (f && f[0] === fence[0] && f.length >= fence.length) fence = null;
      text.push(line);
    } else if (f) {
      fence = f;
      text.push(line);
    } else if (line.trim() === '$$') {
      flush();
      const body: string[] = [];
      let close: string | null = null;
      for (i += 1; i < lines.length; i += 1) {
        if (lines[i].trim() === '$$') {
          close = lines[i];
          break;
        }
        body.push(lines[i]);
      }
      out.push({ math: true, open: line, lines: body, close });
    } else text.push(line);
  }
  flush();
  return out;
}

/** The display equations of some Markdown, in order. */
export function equationSources(markdown: string): string[] {
  return segments(markdown).flatMap((s) => (s.math ? [s.lines.join('\n')] : []));
}

/**
 * Markdown texts (in reading order) ready to export: each labeled display equation loses its label and gains
 * `\tag{n}`, which KaTeX, MathJax, and Pandoc draw as the number, and each `$\eqref{key}$` becomes the text "(n)".
 * Texts without a label or a reference come back unchanged.
 */
export function numberMarkdown(texts: readonly string[]): string[] {
  const parts = texts.map(segments);
  const numbering = numberEquations(parts.flatMap((p) => p.flatMap((s) => (s.math ? [s.lines.join('\n')] : []))));
  let next = 0;
  return parts.map((list, t) => {
    const plain = !texts[t].includes('\\label') && !texts[t].includes('\\eqref');
    return list
      .map((s) => {
        if (!s.math) {
          return plain
            ? s.text
            : s.text.replace(INLINE, (all, key: string | undefined) =>
                key === undefined ? all : formatRef(key, numbering.byKey),
              );
        }
        const n = numbering.numbers[next++];
        if (plain) return [s.open, ...s.lines, ...(s.close === null ? [] : [s.close])].join('\n');
        const clean = stripLabels(s.lines.join('\n'));
        const source = n === null ? clean : `${clean} \\tag{${n}}`;
        return [s.open, source, ...(s.close === null ? [] : [s.close])].join('\n');
      })
      .join('\n');
  });
}
