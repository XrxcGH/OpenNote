// Categorical syllogisms. The 3 statements are typed in words: All S are P, No S are P, Some S are P, and Some S are
// not P. From them come the mood and figure, validity by the classical rules with or without existential import,
// the rule broken, and a three-circle Venn diagram drawn region by region.
import { el, label, svgRoot } from '../core/svg';
import type { SvgNode } from '../core/svg';
import { fail } from '../core/util';

export type Mood = 'A' | 'E' | 'I' | 'O';

export interface Statement {
  mood: Mood;
  subject: string;
  predicate: string;
}

export function parseStatement(text: string): Statement {
  const t = text.trim().replace(/[.!]$/, '').replace(/\s+/g, ' ');
  const pats: [RegExp, Mood][] = [
    [/^(?:all|every) (.+?) (?:are|is) (?!not )(.+)$/i, 'A'],
    [/^no (.+?) (?:are|is) (.+)$/i, 'E'],
    [/^some (.+?) (?:are|is) not (.+)$/i, 'O'],
    [/^some (.+?) (?:are|is) (.+)$/i, 'I'],
  ];
  for (const [re, mood] of pats) {
    const m = re.exec(t);
    if (m) return { mood, subject: m[1].toLowerCase(), predicate: m[2].toLowerCase() };
  }
  return fail('statement', { text });
}

const distributes = (s: Statement, term: string) =>
  (term === s.subject && (s.mood === 'A' || s.mood === 'E')) ||
  (term === s.predicate && (s.mood === 'E' || s.mood === 'O'));
const negative = (s: Statement) => s.mood === 'E' || s.mood === 'O';

export interface Verdict {
  form: string;
  valid: boolean;
  broken: string[];
  name?: string;
  terms: { S: string; P: string; M: string };
}

const NAMES: Record<string, string> = {
  'AAA-1': 'Barbara',
  'EAE-1': 'Celarent',
  'AII-1': 'Darii',
  'EIO-1': 'Ferio',
  'EAE-2': 'Cesare',
  'AEE-2': 'Camestres',
  'EIO-2': 'Festino',
  'AOO-2': 'Baroco',
  'IAI-3': 'Disamis',
  'AII-3': 'Datisi',
  'OAO-3': 'Bocardo',
  'EIO-3': 'Ferison',
  'AEE-4': 'Calemes',
  'IAI-4': 'Dimatis',
  'EIO-4': 'Fresison',
  'AAI-1': 'Barbari',
  'EAO-1': 'Celaront',
  'AEO-2': 'Camestros',
  'EAO-2': 'Cesaro',
  'AAI-3': 'Darapti',
  'EAO-3': 'Felapton',
  'AAI-4': 'Bramantip',
  'AEO-4': 'Calemos',
  'EAO-4': 'Fesapo',
};

export function judge(major: Statement, minor: Statement, conclusion: Statement, existential: boolean): Verdict {
  const S = conclusion.subject;
  const P = conclusion.predicate;
  if (S === P) fail('sameTerms');
  const termsOf = (s: Statement) => [s.subject, s.predicate];
  const majorTerms = termsOf(major);
  const minorTerms = termsOf(minor);
  if (!majorTerms.includes(P)) fail('majorTerm', { term: P });
  if (!minorTerms.includes(S)) fail('minorTerm', { term: S });
  const M = majorTerms.find((t) => t !== P)!;
  if (!minorTerms.includes(M) || minorTerms.every((t) => t === M) || majorTerms.every((t) => t === M))
    fail('middleTerm');
  const figure = major.subject === M ? (minor.predicate === M ? 1 : 3) : minor.predicate === M ? 2 : 4;
  const form = `${major.mood}${minor.mood}${conclusion.mood}-${figure}`;
  const broken: string[] = [];
  if (!distributes(major, M) && !distributes(minor, M)) broken.push('undistributedMiddle');
  if (distributes(conclusion, P) && !distributes(major, P)) broken.push('illicitMajor');
  if (distributes(conclusion, S) && !distributes(minor, S)) broken.push('illicitMinor');
  if (negative(major) && negative(minor)) broken.push('exclusivePremises');
  else if ((negative(major) || negative(minor)) !== negative(conclusion))
    broken.push(negative(conclusion) ? 'negativeFromAffirmative' : 'affirmativeFromNegative');
  const universal = (s: Statement) => s.mood === 'A' || s.mood === 'E';
  if (!existential && universal(major) && universal(minor) && !universal(conclusion)) broken.push('existentialFallacy');
  const valid = broken.length === 0;
  return { form, valid, broken, name: valid ? NAMES[form] : undefined, terms: { S, P, M } };
}

/** The statements of a mood and figure in terms S, P, M, for listing every form. */
export function formStatements(form: string): [Statement, Statement, Statement] {
  const m = /^([AEIO])([AEIO])([AEIO])-([1-4])$/.exec(form.toUpperCase());
  if (!m) return fail('form');
  const st = (mood: string, a: string, b: string): Statement => ({ mood: mood as Mood, subject: a, predicate: b });
  const fig = Number(m[4]);
  const major = fig === 1 || fig === 3 ? st(m[1], 'm', 'p') : st(m[1], 'p', 'm');
  const minor = fig === 1 || fig === 2 ? st(m[2], 's', 'm') : st(m[2], 'm', 's');
  return [major, minor, st(m[3], 's', 'p')];
}

export const statementText = (s: Statement, names: Record<string, string> = {}): string => {
  const a = names[s.subject] ?? s.subject;
  const b = names[s.predicate] ?? s.predicate;
  return s.mood === 'A'
    ? `All ${a} are ${b}`
    : s.mood === 'E'
      ? `No ${a} are ${b}`
      : s.mood === 'I'
        ? `Some ${a} are ${b}`
        : `Some ${a} are not ${b}`;
};

/* ---------- Venn diagram ---------- */

const CIRCLES = [
  { x: 110, y: 100 },
  { x: 180, y: 100 },
  { x: 145, y: 160 },
] as const;
const R = 62;

/** Region of a point: bit 0 for S, 1 for P, 2 for M. */
const regionAt = (x: number, y: number) =>
  CIRCLES.reduce((m, c, i) => m | ((x - c.x) ** 2 + (y - c.y) ** 2 <= R * R ? 1 << i : 0), 0);

/** The regions each premise empties (universal) or marks (particular). */
function marks(statements: readonly Statement[], terms: { S: string; P: string; M: string }) {
  const bit = (t: string) => (t === terms.S ? 1 : t === terms.P ? 2 : 4);
  const shaded = new Set<number>();
  const xs: number[][] = [];
  for (const s of statements) {
    const a = bit(s.subject);
    const b = bit(s.predicate);
    const regions = Array.from({ length: 8 }, (_, r) => r).filter(
      (r) => r & a && (s.mood === 'A' || s.mood === 'O' ? !(r & b) : r & b),
    );
    if (s.mood === 'A' || s.mood === 'E') regions.forEach((r) => shaded.add(r));
    else xs.push(regions);
  }
  return { shaded, xs: xs.map((list) => list.filter((r) => !shaded.has(r))) };
}

const CENTERS: Record<number, [number, number]> = {
  1: [82, 82],
  2: [208, 82],
  3: [145, 72],
  4: [145, 200],
  5: [108, 145],
  6: [182, 145],
  7: [145, 118],
};

export function vennFigure(
  major: Statement,
  minor: Statement,
  terms: { S: string; P: string; M: string },
): { svg: SvgNode; shaded: number[]; xs: number[][] } {
  const { shaded, xs } = marks([major, minor], terms);
  const parts: SvgNode[] = [];
  const step = 3;
  for (let y = 30; y < 230; y += step) {
    let runStart = -1;
    for (let x = 40; x <= 252; x += step) {
      const inside = x < 252 && shaded.has(regionAt(x + step / 2, y + step / 2));
      if (inside && runStart < 0) runStart = x;
      if (!inside && runStart >= 0) {
        parts.push(el('rect', { x: runStart, y, width: x - runStart, height: step, fill: '@warnSoft' }));
        runStart = -1;
      }
    }
  }
  const names = [terms.S, terms.P, terms.M];
  CIRCLES.forEach((c) =>
    parts.push(el('circle', { cx: c.x, cy: c.y, r: R, fill: 'none', stroke: '@ink', strokeWidth: 1.5 })),
  );
  parts.push(label(70, 26, names[0]), label(220, 26, names[1]), label(145, 238, names[2]));
  for (const list of xs) {
    if (!list.length) continue;
    const pts = list.map((r) => CENTERS[r]);
    const x = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const y = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    parts.push(label(x, y, '✕', { fontSize: 16, fill: '@accent' }));
  }
  return { svg: svgRoot(290, 250, ...parts), shaded: [...shaded].sort(), xs };
}
