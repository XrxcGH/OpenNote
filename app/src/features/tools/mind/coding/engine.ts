// Qualitative coding. A codebook lists codes under parent codes. Coded segments of text give code frequencies by
// segment and by case, a code-by-case matrix, co-occurrence with Jaccard similarity, and the passages for one code.
// Two coders' codes on the same segments give percent agreement and kappa. Content-analysis tallies count units by
// category. A segment keeps its quoted text, so an edit to the source does not lose the excerpt.
import { presenceKappa } from '../agreement/kappa';
import { lines } from '../kit/parse';
import { fail } from '../kit/types';

/** Splits a line into cells at each bar or tab. A quoted passage may hold commas. */
const parts = (text: string): string[] => text.split(/\t|\|/).map((part) => part.trim());

/** Codes in a cell, split on commas or semicolons. */
export const codeList = (cell: string): string[] => [
  ...new Set(
    cell
      .split(/[,;]/)
      .map((code) => code.trim())
      .filter((code) => code !== ''),
  ),
];

export interface Segment {
  readonly id: string;
  readonly case: string;
  readonly codes: readonly string[];
  readonly text: string;
}

/** Segments, one a line: segment | case | codes | quoted text (the text may be left out). */
export function readSegments(text: string): Segment[] {
  const found = lines(text);
  if (found.length === 0) fail('empty', {}, 'segments');
  const ids = new Set<string>();
  return found.map(({ line, text: one }) => {
    const [id, kase, codes, ...quote] = parts(one);
    if (!id || kase === undefined || codes === undefined) fail('segmentLine', { line }, 'segments');
    if (ids.has(id)) fail('sameSegment', { id }, 'segments');
    ids.add(id);
    return { id, case: kase || '-', codes: codeList(codes), text: quote.join(' | ') };
  });
}

export interface Coding {
  readonly codes: readonly string[];
  readonly cases: readonly string[];
  /** Segments with each code. */
  readonly frequency: readonly number[];
  /** Cases with each code at least once. */
  readonly caseCount: readonly number[];
  /** Rows are codes, columns cases: segments with that code in that case. */
  readonly byCase: readonly (readonly number[])[];
  /** Segments with both codes; the diagonal is the frequency. */
  readonly together: readonly (readonly number[])[];
  /** |S_i ∩ S_j| / |S_i ∪ S_j|; NaN when neither code is used. */
  readonly jaccard: readonly (readonly number[])[];
}

/** The tables of a coded set. Codes follow `order` (a codebook) first, then the order they first appear in. */
export function analyse(segments: readonly Segment[], order: readonly string[] = []): Coding {
  const codes = [...new Set([...order, ...segments.flatMap((s) => s.codes)])];
  const cases = [...new Set(segments.map((s) => s.case))];
  const has = codes.map((code) => segments.map((s) => s.codes.includes(code)));
  const frequency = has.map((row) => row.filter(Boolean).length);
  const byCase = codes.map((code) =>
    cases.map((c) => segments.filter((s) => s.case === c && s.codes.includes(code)).length),
  );
  const together = has.map((a) => has.map((b) => a.filter((v, k) => v && b[k]).length));
  const jaccard = together.map((row, i) =>
    row.map((both, j) => {
      const either = frequency[i] + frequency[j] - both;
      return either === 0 ? NaN : both / either;
    }),
  );
  const caseCount = byCase.map((row) => row.filter((n) => n > 0).length);
  return { codes, cases, frequency, caseCount, byCase, together, jaccard };
}

/** The segments that carry a code. */
export const retrieve = (segments: readonly Segment[], code: string): Segment[] =>
  segments.filter((s) => s.codes.includes(code));

export interface CodeEntry {
  readonly code: string;
  readonly parent: string;
  readonly definition: string;
  readonly include: string;
  readonly exclude: string;
  readonly example: string;
  /** 0 for a top-level code. */
  readonly depth: number;
}

/** A codebook, one code a line: code | parent | definition | include when | exclude when | example. */
export function readCodebook(text: string): CodeEntry[] {
  const found = lines(text);
  if (found.length === 0) fail('empty', {}, 'codebook');
  const raw = found.map(({ line, text: one }) => {
    const [code, parent = '', definition = '', include = '', exclude = '', example = ''] = parts(one);
    if (!code) fail('codeLine', { line }, 'codebook');
    return { code, parent, definition, include, exclude, example };
  });
  const byCode = new Map<string, (typeof raw)[number]>();
  for (const entry of raw) {
    if (byCode.has(entry.code)) fail('sameCode', { code: entry.code }, 'codebook');
    byCode.set(entry.code, entry);
  }
  const depthOf = (code: string, seen: readonly string[]): number => {
    const parent = byCode.get(code)!.parent;
    if (parent === '') return 0;
    if (!byCode.has(parent)) fail('noParent', { code, parent }, 'codebook');
    if (seen.includes(parent)) fail('cycle', { code }, 'codebook');
    return 1 + depthOf(parent, [...seen, parent]);
  };
  const entries = raw.map((entry) => ({ ...entry, depth: depthOf(entry.code, [entry.code]) }));
  // Children follow their parent, in the order they were typed.
  const out: CodeEntry[] = [];
  const place = (parent: string) => {
    for (const entry of entries.filter((e) => e.parent === parent)) {
      out.push(entry);
      place(entry.code);
    }
  };
  place('');
  return out;
}

export interface CodeAgreement {
  readonly code: string;
  readonly agree: number;
  readonly kappa: number;
  readonly first: number;
  readonly second: number;
}

export interface TwoCoders {
  readonly segments: readonly string[];
  readonly codes: readonly string[];
  /** For each code: the share of segments both coders treated alike, kappa (NaN when undefined), and uses. */
  readonly perCode: readonly CodeAgreement[];
  /** Over every segment-and-code decision. */
  readonly agree: number;
  readonly kappa: number;
  readonly disagreements: readonly { readonly segment: string; readonly code: string; readonly by: 1 | 2 }[];
}

/** Two coders, one segment a line: segment | coder 1's codes | coder 2's codes. */
export function readTwoCoders(text: string): { segments: string[]; first: string[][]; second: string[][] } {
  const found = lines(text);
  if (found.length === 0) fail('empty', {}, 'pairs');
  const segments: string[] = [];
  const first: string[][] = [];
  const second: string[][] = [];
  for (const { line, text: one } of found) {
    const cellsOf = parts(one);
    if (cellsOf.length < 3 || !cellsOf[0]) fail('coderLine', { line }, 'pairs');
    if (segments.includes(cellsOf[0])) fail('sameSegment', { id: cellsOf[0] }, 'pairs');
    segments.push(cellsOf[0]);
    first.push(codeList(cellsOf[1]));
    second.push(codeList(cellsOf[2]));
  }
  return { segments, first, second };
}

/** Each code is applied or not applied to each segment; kappa treats those as 2 categories. */
export function twoCoders(
  segments: readonly string[],
  first: readonly (readonly string[])[],
  second: readonly (readonly string[])[],
): TwoCoders {
  if (segments.length < 2) fail('fewSegments', {}, 'pairs');
  const codes = [...new Set([...first.flat(), ...second.flat()])];
  if (codes.length === 0) fail('noCodes', {}, 'pairs');
  const a: boolean[] = [];
  const b: boolean[] = [];
  const disagreements: { segment: string; code: string; by: 1 | 2 }[] = [];
  const perCode = codes.map((code) => {
    const x = first.map((list) => list.includes(code));
    const y = second.map((list) => list.includes(code));
    a.push(...x);
    b.push(...y);
    x.forEach((v, k) => {
      if (v !== y[k]) disagreements.push({ segment: segments[k], code, by: v ? 1 : 2 });
    });
    const r = presenceKappa(x, y);
    return { code, agree: r.agree, kappa: r.kappa, first: x.filter(Boolean).length, second: y.filter(Boolean).length };
  });
  const pooled = presenceKappa(a, b);
  return { segments, codes, perCode, agree: pooled.agree, kappa: pooled.kappa, disagreements };
}

export interface Tally {
  readonly categories: readonly string[];
  /** Distinct units in each category. */
  readonly units: readonly number[];
  readonly counts: readonly number[];
  readonly total: number;
  readonly unitCount: number;
}

/** Content-analysis tallies, one a line: unit | category | count (1 when left out). */
export function tally(text: string): Tally {
  const found = lines(text);
  if (found.length === 0) fail('empty', {}, 'tallies');
  const categories: string[] = [];
  const unitsOf: Set<string>[] = [];
  const counts: number[] = [];
  const allUnits = new Set<string>();
  for (const { line, text: one } of found) {
    const [unit, category, countText] = parts(one);
    if (!unit || !category) fail('tallyLine', { line }, 'tallies');
    const count = countText === undefined || countText === '' ? 1 : Number(countText.replace(/−/g, '-'));
    if (!Number.isInteger(count) || count < 0) fail('tallyCount', { line }, 'tallies');
    let at = categories.indexOf(category);
    if (at < 0) {
      at = categories.push(category) - 1;
      unitsOf.push(new Set());
      counts.push(0);
    }
    unitsOf[at].add(unit);
    counts[at] += count;
    allUnits.add(unit);
  }
  const total = counts.reduce((s, n) => s + n, 0);
  if (total === 0) fail('noTally', {}, 'tallies');
  return { categories, units: unitsOf.map((s) => s.size), counts, total, unitCount: allUnits.size };
}
