// DNA and RNA sequences: clean and count, complement, translate, find ORFs, GC windows, motifs, k-mers, mutation
// effects and CRISPR guides. Each mode turns the cleaned sequence into rows, tables, pictures, and steps.
import { linePlot } from '../plot';
import { fail, fmt, ok, pct, whole } from '../shared';
import type { KitOk, KitStep, MolKey, Values } from '../shared';
import { choices } from '../spec';
import type { Field, ToolSpec } from '../spec';
import { GENETIC_CODES, codeById } from './codes';
import type { GeneticCode } from './codes';
import { cleanDna, complement, numbered, reverse, revComp, toRna } from './dna';
import type { Cleaned } from './dna';
import { orfMap } from './draw';
import { composition, crisprGuides, findOrfs, frames, gcWindows, kmers, motifHits } from './engine';
import { CLASS_WORD, mutationEffect } from './mutation';

const MODES = ['basics', 'translate', 'orfs', 'gc', 'motif', 'kmers', 'mutation', 'crispr'] as const;
type Mode = (typeof MODES)[number];
const is =
  (...modes: Mode[]) =>
  (values: Values) =>
    modes.includes(values.mode as Mode);

const fields: Field[] = [
  { id: 'mode', label: 'sequence.f.mode', kind: 'select', initial: 'basics', options: choices('sequence.m.', MODES) },
  {
    id: 'seq',
    label: 'sequence.f.seq',
    kind: 'area',
    initial: '>example\nATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG',
    hint: 'sequence.f.seqHint',
  },
  {
    id: 'code',
    label: 'sequence.f.code',
    kind: 'select',
    initial: '1',
    options: choices(
      'sequence.code.',
      GENETIC_CODES.map((code) => String(code.id)),
    ),
    when: is('translate', 'orfs', 'mutation'),
  },
  {
    id: 'frames',
    label: 'sequence.f.frames',
    kind: 'select',
    initial: '6',
    options: choices('sequence.frames.', ['1', '3', '6']),
    when: is('translate'),
  },
  {
    id: 'minCodons',
    label: 'sequence.f.minCodons',
    kind: 'number',
    initial: '3',
    hint: 'sequence.f.minCodonsHint',
    when: is('orfs'),
  },
  {
    id: 'starts',
    label: 'sequence.f.starts',
    kind: 'select',
    initial: 'atg',
    options: choices('sequence.starts.', ['atg', 'alt']),
    when: is('orfs'),
  },
  {
    id: 'nested',
    label: 'sequence.f.nested',
    kind: 'select',
    initial: 'yes',
    options: choices('w.', ['yes', 'no']),
    when: is('orfs'),
  },
  {
    id: 'strands',
    label: 'sequence.f.strands',
    kind: 'select',
    initial: 'both',
    options: choices('sequence.strands.', ['both', 'plus']),
    when: is('orfs', 'motif'),
  },
  { id: 'window', label: 'sequence.f.window', kind: 'number', initial: '10', when: is('gc') },
  { id: 'step', label: 'sequence.f.step', kind: 'number', initial: '1', when: is('gc') },
  {
    id: 'motif',
    label: 'sequence.f.motif',
    kind: 'text',
    initial: 'RRYY',
    hint: 'sequence.f.motifHint',
    when: is('motif'),
  },
  { id: 'k', label: 'sequence.f.k', kind: 'number', initial: '3', when: is('kmers') },
  {
    id: 'change',
    label: 'sequence.f.change',
    kind: 'text',
    initial: 'c.4G>T',
    hint: 'sequence.f.changeHint',
    when: is('mutation'),
  },
  { id: 'pam', label: 'sequence.f.pam', kind: 'text', initial: 'NGG', when: is('crispr') },
  { id: 'spacer', label: 'sequence.f.spacer', kind: 'number', initial: '20', when: is('crispr') },
  {
    id: 'side',
    label: 'sequence.f.side',
    kind: 'select',
    initial: '3',
    options: choices('sequence.side.', ['3', '5']),
    when: is('crispr'),
  },
];

const strandWord = (strand: string): { word: MolKey } => ({
  word: strand === '+' ? 'sequence.w.plus' : strand === '-' ? 'sequence.w.minus' : 'sequence.w.both',
});

function readCode(values: Values): GeneticCode {
  return codeById(Number(values.code)) ?? fail('e.choice', { field: 'sequence.f.code' });
}

function basics(input: Cleaned): KitOk {
  const { seq } = input;
  const c = composition(seq);
  const shown = (s: string) => (input.rna ? toRna(s) : s);
  const t = input.rna ? 'U' : 'T';
  return ok({
    answer: { key: 'sequence.a.revComp', vars: { seq: shown(revComp(seq)) } },
    rows: [
      { key: 'sequence.r.length', value: String(c.length) },
      { key: 'sequence.r.kind', value: '', word: input.rna ? 'sequence.w.rna' : 'sequence.w.dna' },
      { key: 'sequence.r.count', vars: { base: 'A' }, value: String(c.counts.A) },
      { key: 'sequence.r.count', vars: { base: 'C' }, value: String(c.counts.C) },
      { key: 'sequence.r.count', vars: { base: 'G' }, value: String(c.counts.G) },
      { key: 'sequence.r.count', vars: { base: t }, value: String(c.counts.T) },
      { key: 'sequence.r.other', value: String(c.counts.other) },
      { key: 'sequence.r.gc', value: pct(c.gc) },
    ],
    blocks: [
      { title: 'sequence.b.cleaned', text: numbered(shown(seq)) },
      { title: 'sequence.b.reverse', text: numbered(shown(reverse(seq))) },
      { title: 'sequence.b.complement', text: numbered(shown(complement(seq))) },
      { title: 'sequence.b.revComp', text: numbered(shown(revComp(seq))) },
      input.rna
        ? { title: 'sequence.b.dna', text: numbered(seq) }
        : { title: 'sequence.b.rna', text: numbered(toRna(seq)) },
    ],
    steps: [
      { key: 'sequence.s.read', vars: { length: String(c.length), removed: String(input.removed) } },
      { key: 'sequence.s.complement' },
      {
        key: 'sequence.s.gc',
        math:
          `\\mathrm{GC} = \\frac{G + C}{A + C + G + T} = \\frac{${c.counts.G} + ${c.counts.C}}` +
          `{${c.counts.A + c.counts.C + c.counts.G + c.counts.T}} = ${fmt(c.gc * 100, 5)}\\%`,
      },
      { key: input.rna ? 'sequence.s.reverseTranscribe' : 'sequence.s.transcribe' },
    ],
    notes: c.counts.other > 0 ? ['sequence.n.ambiguous'] : [],
    source: 'sequence.src.iupac',
  });
}

function translation(input: Cleaned, values: Values): KitOk {
  const code = readCode(values);
  const count = Number(values.frames) as 1 | 3 | 6;
  const list = frames(input.seq, code, count === 1 || count === 3 ? count : 6);
  const label = (f: number) => (f > 0 ? `+${f}` : `−${-f}`);
  const first = list[0]!;
  const codons = input.seq.slice(0, 15).match(/.{3}/g) ?? [];
  const steps: KitStep[] = [
    { key: 'sequence.s.frames' },
    {
      key: 'sequence.s.frame',
      vars: {
        frame: '+1',
        from: '1',
        codons: codons.join(' '),
        aas: [...first.protein.slice(0, codons.length)].join(' '),
      },
    },
    { key: 'sequence.s.stops', vars: { code: String(code.id) } },
  ];
  return ok({
    answer: { key: 'sequence.a.protein', vars: { frame: '+1', protein: first.protein } },
    rows: list.map((f) => ({
      key: 'sequence.r.frame',
      vars: { frame: label(f.frame), from: String(f.from) },
      value: f.protein,
    })),
    blocks: [
      { title: 'sequence.b.frames', text: list.map((f) => `${label(f.frame).padStart(2)}  ${f.protein}`).join('\n') },
    ],
    steps,
    notes: ['sequence.n.stopStar'],
    source: 'sequence.src.ncbi',
  });
}

function orfs(input: Cleaned, values: Values): KitOk {
  const code = readCode(values);
  const minCodons = whole(values, 'minCodons', 'sequence.f.minCodons', [1, 100000]);
  const found = findOrfs(input.seq, code, {
    minCodons,
    starts: values.starts === 'alt' ? 'alt' : 'atg',
    nested: values.nested === 'yes',
    strands: values.strands === 'plus' ? 'plus' : 'both',
  });
  const best = found[0];
  const starts = values.starts === 'alt' ? code.starts.join(', ') : 'ATG';
  return ok({
    answer: best
      ? {
          key: 'sequence.a.orf',
          vars: {
            count: String(found.length),
            start: String(best.start),
            end: String(best.end),
            codons: String(best.codons),
          },
        }
      : { key: 'sequence.a.noOrf', vars: { min: String(minCodons) } },
    rows: [
      { key: 'sequence.r.orfCount', value: String(found.length) },
      ...(best
        ? [{ key: 'sequence.r.longest' as MolKey, value: `${best.start}–${best.end} (${best.strand}${best.frame})` }]
        : []),
    ],
    tables: [
      {
        title: 'sequence.h.orfs',
        head: [
          'sequence.h.strand',
          'sequence.h.frame',
          'sequence.h.start',
          'sequence.h.end',
          'sequence.h.codons',
          'sequence.h.nested',
          'sequence.h.partial',
          'sequence.h.protein',
        ],
        rows: found.map((o) => [
          strandWord(o.strand),
          String(o.frame),
          String(o.start),
          String(o.end),
          String(o.codons),
          { word: o.nested ? 'w.yes' : 'w.no' },
          { word: o.partial ? 'w.yes' : 'w.no' },
          o.protein,
        ]),
      },
    ],
    figures: [{ title: 'sequence.h.orfMap', figure: orfMap(input.seq.length, found) }],
    steps: [
      { key: 'sequence.s.orfRule', vars: { starts, min: String(minCodons) } },
      { key: 'sequence.s.orfMinus' },
      ...(best
        ? [
            {
              key: 'sequence.s.orfLongest' as MolKey,
              vars: {
                strand: best.strand,
                frame: String(best.frame),
                start: String(best.start),
                end: String(best.end),
                codons: String(best.codons),
              },
            },
          ]
        : []),
    ],
    notes: ['sequence.n.orfPartial'],
    source: 'sequence.src.ncbi',
  });
}

function gc(input: Cleaned, values: Values): KitOk {
  const window = whole(values, 'window', 'sequence.f.window', [2, 1000000]);
  const step = whole(values, 'step', 'sequence.f.step', [1, 1000000]);
  const w = gcWindows(input.seq, window, step);
  const c = composition(input.seq);
  const x: MolKey = 'sequence.h.position';
  return ok({
    answer: { key: 'sequence.a.gc', vars: { gc: pct(c.gc), cpg: fmt(w.cpg, 4) } },
    rows: [
      { key: 'sequence.r.gc', value: pct(c.gc) },
      { key: 'sequence.r.windows', value: String(w.mids.length) },
      { key: 'sequence.r.gcRange', value: `${fmt(Math.min(...w.gc), 4)}–${fmt(Math.max(...w.gc), 4)}%` },
      { key: 'sequence.r.cpg', value: fmt(w.cpg, 4) },
    ],
    figures: [
      {
        title: 'sequence.h.gcPlot',
        figure: linePlot({
          xLabel: { word: x },
          yLabel: { word: 'sequence.h.gcPct' },
          series: [{ name: 'GC', x: w.mids, y: w.gc }],
        }),
      },
      {
        title: 'sequence.h.skewPlot',
        figure: linePlot({
          xLabel: { word: x },
          yLabel: { word: 'sequence.h.skew' },
          series: [{ name: 'skew', x: w.mids, y: w.skew }],
          marks: [0],
        }),
      },
    ],
    steps: [
      {
        key: 'sequence.s.windows',
        vars: { window: String(window), step: String(step) },
        math:
          '\\mathrm{GC}_i = \\frac{G_i + C_i}{n_i} \\times 100\\%,' +
          '\\quad \\mathrm{skew}_i = \\frac{G_i - C_i}{G_i + C_i}',
      },
      {
        key: 'sequence.s.cpg',
        math: `\\frac{O}{E}_{\\mathrm{CpG}} = \\frac{N_{\\mathrm{CpG}} \\cdot L}{N_C \\cdot N_G} = ${fmt(w.cpg, 4)}`,
      },
    ],
  });
}

function motif(input: Cleaned, values: Values): KitOk {
  const both = values.strands !== 'plus';
  const { hits, palindrome } = motifHits(input.seq, values.motif ?? '', both);
  const letters = (values.motif ?? '').replace(/\s/g, '').toUpperCase();
  return ok({
    answer: { key: 'sequence.a.motif', vars: { count: String(hits.length), motif: letters } },
    rows: [
      { key: 'sequence.r.sites', value: String(hits.length) },
      { key: 'sequence.r.palindrome', value: '', word: palindrome ? 'w.yes' : 'w.no' },
    ],
    tables: [
      {
        title: 'sequence.h.sites',
        head: ['sequence.h.strand', 'sequence.h.start', 'sequence.h.end', 'sequence.h.site'],
        rows: hits.map((h) => [strandWord(h.strand), String(h.start), String(h.end), h.text]),
      },
    ],
    steps: [
      { key: 'sequence.s.motifSets', vars: { motif: letters } },
      ...(both
        ? [
            {
              key: (palindrome ? 'sequence.s.motifPalindrome' : 'sequence.s.motifMinus') as MolKey,
              vars: { rc: revComp(letters.replace(/U/g, 'T')) },
            },
          ]
        : []),
    ],
    source: 'sequence.src.iupac',
  });
}

function kmerCounts(input: Cleaned, values: Values): KitOk {
  const k = whole(values, 'k', 'sequence.f.k', [1, Math.min(12, input.seq.length)]);
  const counts = kmers(input.seq, k);
  const total = counts.reduce((sum, [, n]) => sum + n, 0);
  return ok({
    answer: {
      key: 'sequence.a.kmers',
      vars: { k: String(k), distinct: String(counts.length), top: counts[0]?.[0] ?? '' },
    },
    rows: [
      { key: 'sequence.r.kmerTotal', value: String(total) },
      { key: 'sequence.r.kmerDistinct', vars: { possible: String(4 ** k) }, value: String(counts.length) },
    ],
    tables: [
      {
        title: 'sequence.h.kmers',
        head: ['sequence.h.word', 'sequence.h.count', 'sequence.h.share'],
        rows: counts.slice(0, 50).map(([word, n]) => [word, String(n), pct(n / total, 4)]),
      },
    ],
    steps: [{ key: 'sequence.s.kmers', vars: { k: String(k), total: String(total) } }],
  });
}

function mutation(input: Cleaned, values: Values): KitOk {
  const code = readCode(values);
  const r = mutationEffect(input.seq, values.change ?? '', code);
  const steps: KitStep[] = [
    {
      key: `sequence.s.change.${r.change.kind}`,
      vars: { from: String(r.change.from), to: String(r.change.to), alt: r.change.alt },
    },
  ];
  if (r.codon) {
    const aa = (cod: string) => protein1(cod, code);
    steps.push({
      key: 'sequence.s.codon',
      vars: {
        n: String(r.codon.number),
        before: r.codon.before,
        after: r.codon.after,
        x: aa(r.codon.before),
        y: aa(r.codon.after),
      },
    });
  } else {
    const delta = r.mutated.length - input.seq.length;
    steps.push({
      key: delta % 3 === 0 ? 'sequence.s.inFrame' : 'sequence.s.shift',
      vars: { delta: String(Math.abs(delta)) },
    });
  }
  steps.push({ key: 'sequence.s.effect', vars: { protein: r.protein } });
  return ok({
    answer: { key: 'sequence.a.mutation', vars: { protein: r.protein } },
    rows: [
      { key: 'sequence.r.effect', value: '', word: CLASS_WORD[r.cls] },
      { key: 'sequence.r.pNotation', value: r.protein },
      { key: 'sequence.r.refProtein', value: r.refProtein },
      { key: 'sequence.r.mutProtein', value: r.mutProtein },
    ],
    blocks: [{ title: 'sequence.b.mutated', text: numbered(input.rna ? toRna(r.mutated) : r.mutated) }],
    steps,
    notes: ['sequence.n.cdna'],
    source: 'sequence.src.hgvs',
  });
}

const protein1 = (codon: string, code: GeneticCode): string => {
  const aa = frames(codon, code, 1)[0]?.protein ?? '';
  return aa === '*' ? 'Ter' : aa;
};

function crispr(input: Cleaned, values: Values): KitOk {
  const length = whole(values, 'spacer', 'sequence.f.spacer', [10, 40]);
  const pam = (values.pam ?? '').replace(/\s/g, '').toUpperCase();
  const side = values.side === '5' ? '5' : '3';
  const guides = crisprGuides(input.seq, { pam, length, side });
  return ok({
    answer: { key: 'sequence.a.guides', vars: { count: String(guides.length), pam } },
    rows: [{ key: 'sequence.r.guides', value: String(guides.length) }],
    tables: [
      {
        title: 'sequence.h.guides',
        head: [
          'sequence.h.strand',
          'sequence.h.start',
          'sequence.h.end',
          'sequence.h.spacerSeq',
          'sequence.h.pam',
          'sequence.h.gcPct',
          'sequence.h.cut',
          'sequence.h.polyT',
        ],
        rows: guides.map((g) => [
          strandWord(g.strand),
          String(g.start),
          String(g.end),
          g.spacer,
          g.pam,
          fmt(g.gc * 100, 4),
          g.cut === null ? '—' : String(g.cut),
          { word: g.polyT ? 'w.yes' : 'w.no' },
        ]),
      },
    ],
    steps: [
      { key: side === '3' ? 'sequence.s.pam3' : 'sequence.s.pam5', vars: { pam, length: String(length) } },
      { key: 'sequence.s.guideMinus' },
      ...(side === '3' ? [{ key: 'sequence.s.cut' as MolKey }] : []),
    ],
    notes: ['sequence.n.offTarget', 'sequence.n.polyT'],
  });
}

const RUN: Record<Mode, (input: Cleaned, values: Values) => KitOk> = {
  basics,
  translate: translation,
  orfs,
  gc,
  motif,
  kmers: kmerCounts,
  mutation,
  crispr,
};

export const spec: ToolSpec = {
  id: 'sequence',
  fields,
  run(values) {
    const mode = MODES.includes(values.mode as Mode) ? (values.mode as Mode) : 'basics';
    return RUN[mode](cleanDna(values.seq ?? ''), values);
  },
};
