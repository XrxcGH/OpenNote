// Sequence alignment: global, local, or semi-global alignment of two DNA or protein sequences with linear or affine
// gaps, the score matrix with arrows for short sequences, and a dot plot.
import { fail, fmt, need, ok, pct, whole } from '../shared';
import type { KitOk, KitStep, KitTable, MolKey, Values } from '../shared';
import { choices } from '../spec';
import type { Field, ToolSpec } from '../spec';
import { readFasta } from '../sequence/dna';
import { dotFigure, matrixFigure } from './draw';
import { DIAG, LEFT, UP, alignAffine, alignLinear, dnaScorer, dotPlot, matchLine, stats } from './engine';
import type { AlignMode, Alignment, Scorer } from './engine';
import { BLOSUM62, readMatrix } from './matrices';
import type { Matrix } from './matrices';

const MODES = ['global', 'local', 'semi', 'dots'] as const;
type Mode = (typeof MODES)[number];
const SCORING = ['dna', 'transition', 'blosum62', 'custom'] as const;
const TEACHING = 25;
const aligning = (v: Values) => v.mode !== 'dots';
const scoring =
  (...kinds: string[]) =>
  (v: Values) =>
    aligning(v) && kinds.includes(v.scoring ?? '');

const fields: Field[] = [
  { id: 'mode', label: 'align.f.mode', kind: 'select', initial: 'global', options: choices('align.m.', MODES) },
  { id: 'a', label: 'align.f.a', kind: 'area', initial: 'GATTACA', hint: 'align.f.seqHint' },
  { id: 'b', label: 'align.f.b', kind: 'area', initial: 'GCATGCU' },
  {
    id: 'scoring',
    label: 'align.f.scoring',
    kind: 'select',
    initial: 'dna',
    options: choices('align.scoring.', SCORING),
    when: aligning,
  },
  { id: 'match', label: 'align.f.match', kind: 'number', initial: '1', when: scoring('dna', 'transition') },
  { id: 'mismatch', label: 'align.f.mismatch', kind: 'number', initial: '-1', when: scoring('dna', 'transition') },
  { id: 'transversion', label: 'align.f.transversion', kind: 'number', initial: '-2', when: scoring('transition') },
  {
    id: 'matrix',
    label: 'align.f.matrix',
    kind: 'area',
    initial: '   A  C  G  T\nA  2 -1 -1 -1\nC -1  2 -1 -1\nG -1 -1  2 -1\nT -1 -1 -1  2',
    hint: 'align.f.matrixHint',
    when: scoring('custom'),
  },
  {
    id: 'gaps',
    label: 'align.f.gaps',
    kind: 'select',
    initial: 'linear',
    options: choices('align.gaps.', ['linear', 'affine']),
    when: aligning,
  },
  { id: 'gap', label: 'align.f.gap', kind: 'number', initial: '-1', when: (v) => aligning(v) && v.gaps !== 'affine' },
  {
    id: 'open',
    label: 'align.f.open',
    kind: 'number',
    initial: '-3',
    hint: 'align.f.openHint',
    when: (v) => aligning(v) && v.gaps === 'affine',
  },
  {
    id: 'extend',
    label: 'align.f.extend',
    kind: 'number',
    initial: '-1',
    when: (v) => aligning(v) && v.gaps === 'affine',
  },
  { id: 'window', label: 'align.f.window', kind: 'number', initial: '3', when: (v) => v.mode === 'dots' },
  { id: 'threshold', label: 'align.f.threshold', kind: 'number', initial: '3', when: (v) => v.mode === 'dots' },
];

/** The letters of a sequence box: the first FASTA record, capitals, no spaces, or digits. */
function letters(text: string, label: MolKey): string {
  const seq = (readFasta(text)[0]?.seq ?? '').replace(/[\s\d]/g, '').toUpperCase();
  if (seq === '') return fail('align.e.noSeq', { field: label });
  const bad = [...seq].findIndex((ch) => !/[A-Z*-]/.test(ch));
  return bad === -1 ? seq.replace(/-/g, '') : fail('align.e.badLetter', { field: label, char: seq[bad]! });
}

function checked(matrix: Matrix, a: string, b: string): Scorer {
  for (const ch of a + b) if (!matrix.letters.includes(ch)) fail('align.e.notInMatrix', { char: ch });
  return (x, y) => matrix.score(x, y) ?? 0;
}

function scorer(values: Values, a: string, b: string): Scorer {
  switch (values.scoring) {
    case 'transition':
      return dnaScorer(
        need(values, 'match', 'align.f.match'),
        need(values, 'mismatch', 'align.f.mismatch'),
        need(values, 'transversion', 'align.f.transversion'),
      );
    case 'blosum62':
      return checked(BLOSUM62, a, b);
    case 'custom':
      return checked(readMatrix(values.matrix ?? ''), a, b);
    default:
      return dnaScorer(need(values, 'match', 'align.f.match'), need(values, 'mismatch', 'align.f.mismatch'));
  }
}

/** The alignment in rows of 60 columns with the first and last position of each row; local ones start mid-sequence. */
function block(result: Alignment, s: Scorer, local: boolean): string {
  const line = matchLine(result.top, result.bottom, s);
  const out: string[] = [];
  let ia = local ? result.span.a[0] : 1;
  let ib = local ? result.span.b[0] : 1;
  for (let k = 0; k < result.top.length; k += 60) {
    const top = result.top.slice(k, k + 60);
    const bottom = result.bottom.slice(k, k + 60);
    const ta = top.replace(/-/g, '').length;
    const tb = bottom.replace(/-/g, '').length;
    out.push(`${String(ia).padStart(5)} ${top} ${ia + ta - 1}`, `      ${line.slice(k, k + 60)}`);
    out.push(`${String(ib).padStart(5)} ${bottom} ${ib + tb - 1}`, '');
    ia += ta;
    ib += tb;
  }
  return out.join('\n').trimEnd();
}

function cellSteps(a: string, b: string, s: Scorer, g: number, result: Alignment): KitStep[] {
  const steps: KitStep[] = [];
  const f = result.matrix;
  for (const [i, j] of [
    [1, 1],
    [1, 2],
    [2, 1],
  ] as const) {
    if (i > a.length || j > b.length) continue;
    const d = f[i - 1]![j - 1]! + s(a[i - 1]!, b[j - 1]!);
    steps.push({
      key: 'align.s.cell',
      vars: {
        i: String(i),
        j: String(j),
        x: a[i - 1]!,
        y: b[j - 1]!,
        d: fmt(d),
        u: fmt(f[i - 1]![j]! + g),
        l: fmt(f[i]![j - 1]! + g),
        v: fmt(f[i]![j]!),
      },
    });
  }
  return steps;
}

function steps(
  mode: AlignMode,
  affine: boolean,
  a: string,
  b: string,
  s: Scorer,
  values: Values,
  result: Alignment,
): KitStep[] {
  const out: KitStep[] = [{ key: `align.s.init.${mode}` }];
  if (affine) {
    out.push({
      key: 'align.s.gotoh',
      math:
        'M_{i,j} = s(a_i,b_j) + \\max(M, X, Y)_{i-1,j-1},\\;' +
        ' X_{i,j} = \\max(M_{i-1,j} + o,\\, X_{i-1,j} + e,\\, Y_{i-1,j} + o)',
    });
  } else {
    const g = need(values, 'gap', 'align.f.gap');
    out.push({
      key: 'align.s.recurrence',
      math:
        `F_{i,j} = \\max\\left(F_{i-1,j-1} + s(a_i, b_j),\\; F_{i-1,j} + (${fmt(g)}),` +
        `\\; F_{i,j-1} + (${fmt(g)})${mode === 'local' ? ',\\; 0' : ''}\\right)`,
    });
    out.push(...cellSteps(a, b, s, g, result));
  }
  out.push({ key: `align.s.end.${mode}`, vars: { score: fmt(result.score) } });
  out.push({ key: 'align.s.traceback' });
  return out;
}

function matrixTable(a: string, b: string, result: Alignment): KitTable {
  const onPath = new Set(result.path.map(([i, j]) => `${i},${j}`));
  const glyph = (bits: number) => `${bits & DIAG ? '↖' : ''}${bits & UP ? '↑' : ''}${bits & LEFT ? '←' : ''}`;
  return {
    title: 'align.h.matrix',
    head: [],
    headText: ['', '–', ...b],
    rows: result.matrix.map((row, i) => [
      i === 0 ? '–' : a[i - 1]!,
      ...row.map((v, j) => {
        const text = `${result.arrows ? glyph(result.arrows[i]![j]!) : ''}${Number.isFinite(v) ? fmt(v, 4) : '−∞'}`;
        return onPath.has(`${i},${j}`) ? `[${text}]` : text;
      }),
    ]),
  };
}

function aligned(a: string, b: string, values: Values, mode: AlignMode): KitOk {
  const s = scorer(values, a, b);
  const affine = values.gaps === 'affine';
  const result = affine
    ? alignAffine(
        a,
        b,
        s,
        { open: need(values, 'open', 'align.f.open'), extend: need(values, 'extend', 'align.f.extend') },
        mode,
      )
    : alignLinear(a, b, s, need(values, 'gap', 'align.f.gap'), mode);
  const st = stats(result.top, result.bottom, s);
  const small = a.length <= TEACHING && b.length <= TEACHING;
  return ok({
    answer: { key: 'align.a.score', vars: { score: fmt(result.score), top: result.top, bottom: result.bottom } },
    rows: [
      { key: 'align.r.score', value: fmt(result.score) },
      { key: 'align.r.length', value: String(st.length) },
      { key: 'align.r.identity', value: `${st.identical}/${st.length} (${pct(st.identical / st.length, 4)})` },
      { key: 'align.r.similarity', value: `${st.similar}/${st.length} (${pct(st.similar / st.length, 4)})` },
      { key: 'align.r.gaps', value: `${st.gaps}/${st.length} (${pct(st.gaps / st.length, 4)})` },
      { key: 'align.r.spanA', value: `${result.span.a[0]}–${result.span.a[1]}` },
      { key: 'align.r.spanB', value: `${result.span.b[0]}–${result.span.b[1]}` },
    ],
    blocks: [{ title: 'align.h.alignment', text: block(result, s, mode === 'local') }],
    figures: small ? [{ title: 'align.h.matrix', figure: matrixFigure(a, b, result) }] : [],
    tables: small ? [matrixTable(a, b, result)] : [],
    steps: steps(mode, affine, a, b, s, values, result),
    notes: [small ? 'align.n.ties' : 'align.n.long', ...(affine ? ['align.n.affine' as MolKey] : [])],
    source: values.scoring === 'blosum62' ? 'align.src.blosum' : undefined,
  });
}

function dots(a: string, b: string, values: Values): KitOk {
  const window = whole(values, 'window', 'align.f.window', [1, Math.min(a.length, b.length)]);
  const threshold = whole(values, 'threshold', 'align.f.threshold', [1, window]);
  const found = dotPlot(a, b, window, threshold);
  return ok({
    answer: { key: 'align.a.dots', vars: { count: String(found.length) } },
    rows: [{ key: 'align.r.dots', value: String(found.length) }],
    figures: [{ title: 'align.h.dots', figure: dotFigure(a, b, found) }],
    steps: [{ key: 'align.s.dots', vars: { window: String(window), threshold: String(threshold) } }],
    notes: ['align.n.dots'],
  });
}

export const spec: ToolSpec = {
  id: 'align',
  fields,
  run(values) {
    const mode = MODES.includes(values.mode as Mode) ? (values.mode as Mode) : 'global';
    const a = letters(values.a ?? '', 'align.f.a');
    const b = letters(values.b ?? '', 'align.f.b');
    return mode === 'dots' ? dots(a, b, values) : aligned(a, b, values, mode);
  },
};
