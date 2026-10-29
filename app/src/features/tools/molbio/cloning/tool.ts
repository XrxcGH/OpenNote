// Cloning, PCR, and gels: restriction digests with a virtual gel and a plasmid map, band sizing from a ladder, primer
// reports with three melting temperatures, PCR products, oligo mass and concentration, and ligation amounts.
import { fail, fmt, lines, numberList, ok, pct, positive } from '../shared';
import type { KitOk, KitStep, MolKey, Values } from '../shared';
import { choices } from '../spec';
import type { Field, ToolSpec } from '../spec';
import { cleanDna, gcFraction, numbered } from '../sequence/dna';
import { circularMap, gelFigure, linearMap } from './draw';
import type { GelLane, MapFeature } from './draw';
import {
  BP_MASS,
  annealing,
  copies,
  dimer,
  extinction,
  findSites,
  fitLadder,
  fragments,
  gcClamp,
  hairpin,
  insertMass,
  moles,
  nearestNeighbor,
  oligoMass,
  overhang,
  pcrProduct,
  plain,
  readEnzymes,
  saltAdjusted,
  wallace,
} from './engine';

const MODES = ['digest', 'gel', 'primer', 'pcr', 'oligo', 'ligation', 'copies'] as const;
type Mode = (typeof MODES)[number];
const is =
  (...modes: Mode[]) =>
  (v: Values) =>
    modes.includes((v.mode ?? 'digest') as Mode);

const PCR_TEMPLATE =
  'ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGGTGAAGGTGATGC';

const fields: Field[] = [
  { id: 'mode', label: 'cloning.f.mode', kind: 'select', initial: 'digest', options: choices('cloning.m.', MODES) },
  {
    id: 'seq',
    label: 'cloning.f.seq',
    kind: 'area',
    initial: 'AAGAATTCTTGGATCCAA',
    hint: 'cloning.f.seqHint',
    when: is('digest'),
  },
  {
    id: 'template',
    label: 'cloning.f.template',
    kind: 'area',
    initial: PCR_TEMPLATE,
    hint: 'cloning.f.seqHint',
    when: is('pcr'),
  },
  {
    id: 'topology',
    label: 'cloning.f.topology',
    kind: 'select',
    initial: 'linear',
    options: choices('cloning.topology.', ['linear', 'circular']),
    when: is('digest', 'pcr'),
  },
  {
    id: 'enzymes',
    label: 'cloning.f.enzymes',
    kind: 'area',
    initial: 'EcoRI, BamHI',
    hint: 'cloning.f.enzymesHint',
    when: is('digest'),
  },
  {
    id: 'features',
    label: 'cloning.f.features',
    kind: 'area',
    initial: '',
    hint: 'cloning.f.featuresHint',
    when: is('digest'),
  },
  {
    id: 'ladder',
    label: 'cloning.f.ladder',
    kind: 'text',
    initial: '10000, 5000, 3000, 2000, 1000, 500, 250, 100, 50, 10',
    hint: 'cloning.f.ladderHint',
    when: is('digest'),
  },
  {
    id: 'bands',
    label: 'cloning.f.bands',
    kind: 'area',
    initial: '10000 10\n1000 40\n100 70',
    hint: 'cloning.f.bandsHint',
    when: is('gel'),
  },
  { id: 'unknowns', label: 'cloning.f.unknowns', kind: 'text', initial: '55', when: is('gel') },
  {
    id: 'fit',
    label: 'cloning.f.fit',
    kind: 'select',
    initial: 'line',
    options: choices('cloning.fit.', ['line', 'cubic']),
    when: is('gel'),
  },
  { id: 'primer', label: 'cloning.f.primer', kind: 'text', initial: 'AGCGGATAACAATTTCACACAGGA', when: is('primer') },
  { id: 'forward', label: 'cloning.f.forward', kind: 'text', initial: 'ATGGCTAGCAAAGGAGAAG', when: is('pcr') },
  {
    id: 'reverse',
    label: 'cloning.f.reverse',
    kind: 'text',
    initial: 'GCATCACCTTCACCCTCTCCA',
    hint: 'cloning.f.reverseHint',
    when: is('pcr'),
  },
  { id: 'sodium', label: 'cloning.f.sodium', kind: 'number', initial: '50', when: is('primer', 'pcr') },
  {
    id: 'conc',
    label: 'cloning.f.conc',
    kind: 'number',
    initial: '0.25',
    hint: 'cloning.f.concHint',
    when: is('primer', 'pcr'),
  },
  { id: 'oligo', label: 'cloning.f.oligo', kind: 'text', initial: 'ATGCATGCAT', when: is('oligo') },
  { id: 'a260', label: 'cloning.f.a260', kind: 'number', initial: '0.5', when: is('oligo') },
  { id: 'path', label: 'cloning.f.path', kind: 'number', initial: '1', when: is('oligo') },
  { id: 'vectorNg', label: 'cloning.f.vectorNg', kind: 'number', initial: '50', when: is('ligation') },
  { id: 'vectorBp', label: 'cloning.f.vectorBp', kind: 'number', initial: '3000', when: is('ligation') },
  { id: 'insertBp', label: 'cloning.f.insertBp', kind: 'number', initial: '1000', when: is('ligation') },
  {
    id: 'ratio',
    label: 'cloning.f.ratio',
    kind: 'number',
    initial: '3',
    hint: 'cloning.f.ratioHint',
    when: is('ligation'),
  },
  { id: 'massNg', label: 'cloning.f.massNg', kind: 'number', initial: '1', when: is('copies') },
  { id: 'lengthBp', label: 'cloning.f.lengthBp', kind: 'number', initial: '3000', when: is('copies') },
  { id: 'volume', label: 'cloning.f.volume', kind: 'number', initial: '10', when: is('copies') },
];

const list = (values: readonly (string | number)[]): string => values.map(String).join(', ');

/** Bases of a primer box: capitals, no spaces, plain A, C, G, and T only. */
function primerText(text: string, label: MolKey): string {
  const seq = text.replace(/\s/g, '').toUpperCase().replace(/U/g, 'T');
  if (seq === '') return fail('cloning.e.noPrimer', { field: label });
  return plain(seq);
}

function readFeatures(text: string, length: number): MapFeature[] {
  return lines(text).map((line) => {
    const words = line.split(/\s+/);
    const to = Number(words.pop());
    const from = Number(words.pop());
    const name = words.join(' ');
    const fine = name !== '' && Number.isInteger(from) && Number.isInteger(to);
    if (!fine || from < 1 || to < 1 || from > length || to > length) return fail('cloning.e.feature', { line });
    return { name, from, to };
  });
}

/** Where a band of `size` sits on the drawn gel: log-linear between the largest and smallest ladder bands. */
function gelPosition(size: number, ladder: readonly number[]): number {
  const hi = Math.log10(Math.max(...ladder));
  const lo = Math.log10(Math.min(...ladder));
  const span = hi - lo || 1;
  return 0.05 + (0.9 * (hi - Math.log10(size))) / span;
}

function digest(values: Values): KitOk {
  const { seq } = cleanDna(values.seq ?? '');
  const circular = values.topology === 'circular';
  const enzymes = readEnzymes(values.enzymes ?? '');
  const sites = findSites(seq, enzymes, circular);
  const frags = fragments(
    seq.length,
    sites.map((s) => s.cutAfter),
    circular,
  );
  const ladder = numberList(values.ladder ?? '', 'cloning.f.ladder').filter((v) => v > 0);
  const sizes = frags.length > 0 ? frags.map((f) => f.length) : [seq.length];
  const steps: KitStep[] = enzymes.map((e) => {
    const end = overhang(e);
    const at = sites.filter((s) => s.enzyme === e.name);
    return {
      key: at.length === 0 ? 'cloning.s.noSite' : 'cloning.s.site',
      vars: {
        enzyme: e.name,
        site: `${e.site.slice(0, e.cut)}^${e.site.slice(e.cut)}`,
        cut: String(e.cut),
        starts: list(at.map((s) => s.start)),
        cuts: list(at.map((s) => s.cutAfter)),
        end: end.kind,
        overhang: String(end.length),
      },
    };
  });
  const sortedCuts = [...new Set(sites.map((s) => s.cutAfter))].sort((a, b) => a - b);
  steps.push({
    key: circular ? 'cloning.s.circleFragments' : 'cloning.s.lineFragments',
    vars: {
      length: String(seq.length),
      cuts: list(sortedCuts),
      sums: frags.map((f) => `${f.to} − ${f.from - 1} = ${f.length}`).join('; '),
    },
  });
  const lanes: GelLane[] = [
    {
      label: { word: 'cloning.h.ladderLane' },
      bands: ladder.map((s) => ({ at: gelPosition(s, ladder), label: String(s) })),
    },
    {
      label: { word: 'cloning.h.digestLane' },
      bands: sizes.map((s) => ({ at: gelPosition(s, ladder), label: String(s) })),
    },
  ];
  const features = readFeatures(values.features ?? '', seq.length);
  const marks = sites.map((s) => ({ label: `${s.enzyme} (${s.cutAfter})`, at: s.cutAfter }));
  const map = circular ? circularMap(seq.length, features, marks) : linearMap(seq.length, features, marks);
  return ok({
    answer: {
      key: frags.length === 0 ? 'cloning.a.uncut' : 'cloning.a.fragments',
      vars: { sizes: list(sizes), count: String(frags.length) },
    },
    rows: [
      { key: 'cloning.r.length', value: `${seq.length} bp` },
      { key: 'cloning.r.sites', value: String(sites.length) },
      { key: 'cloning.r.fragments', value: list(sizes) },
    ],
    tables: [
      {
        title: 'cloning.h.sites',
        head: ['cloning.h.enzyme', 'cloning.h.site', 'cloning.h.start', 'cloning.h.cutAfter', 'cloning.h.end'],
        rows: sites.map((s) => {
          const e = enzymes.find((x) => x.name === s.enzyme)!;
          const end = overhang(e);
          return [
            s.enzyme,
            `${e.site.slice(0, e.cut)}^${e.site.slice(e.cut)}`,
            String(s.start),
            String(s.cutAfter),
            { word: `cloning.w.${end.kind}` as MolKey, vars: { length: String(end.length) } },
          ];
        }),
      },
      {
        title: 'cloning.h.fragments',
        head: ['cloning.h.from', 'cloning.h.to', 'cloning.h.length'],
        rows: frags.map((f) => [String(f.from), String(f.to), String(f.length)]),
      },
    ],
    figures: [
      ...(ladder.length > 0 ? [{ title: 'cloning.h.gel' as MolKey, figure: gelFigure(lanes) }] : []),
      { title: circular ? 'cloning.h.circularMap' : 'cloning.h.linearMap', figure: map },
    ],
    steps,
    notes: ['cloning.n.topStrand', 'cloning.n.methylation'],
    source: 'cloning.src.enzymes',
  });
}

function readBands(text: string): { sizes: number[]; distances: number[] } {
  const sizes: number[] = [];
  const distances: number[] = [];
  for (const line of lines(text)) {
    const [size, distance, extra] = numberList(line, 'cloning.f.bands');
    if (size === undefined || distance === undefined || extra !== undefined) fail('cloning.e.bandLine', { line });
    sizes.push(size!);
    distances.push(distance!);
  }
  return { sizes, distances };
}

function gel(values: Values): KitOk {
  const { sizes, distances } = readBands(values.bands ?? '');
  const cubic = values.fit === 'cubic';
  const fit = fitLadder(sizes, distances, cubic);
  const unknowns = numberList(values.unknowns ?? '', 'cloning.f.unknowns');
  if (unknowns.length === 0) fail('cloning.e.noUnknown');
  const found = unknowns.map((d) => ({ d, size: fit.size(d) }));
  const lo = Math.min(...distances);
  const hi = Math.max(...distances);
  const far = Math.max(hi, ...unknowns) * 1.05 || 1;
  const c = fit.coefficients;
  const equation = cubic
    ? `\\log_{10} s = ${fmt(c[0]!)} ${sign(c[1]!)}\\,d ${sign(c[2]!)}\\,d^2 ${sign(c[3]!)}\\,d^3`
    : `\\log_{10} s = ${fmt(c[0]!)} ${sign(c[1]!)}\\,d`;
  const first = found[0]!;
  return ok({
    answer: { key: 'cloning.a.band', vars: { distance: fmt(first.d), size: fmt(first.size) } },
    rows: [
      ...(cubic
        ? []
        : [
            { key: 'cloning.r.slope' as MolKey, value: fmt(c[1]!) },
            { key: 'cloning.r.intercept' as MolKey, value: fmt(c[0]!) },
          ]),
      { key: 'cloning.r.r2', value: fmt(fit.r2) },
      ...found.map((f) => ({
        key: 'cloning.r.bandSize' as MolKey,
        value: `${fmt(f.size)} bp`,
        vars: { distance: fmt(f.d) },
      })),
    ],
    tables: [
      {
        title: 'cloning.h.sizes',
        head: ['cloning.h.distance', 'cloning.h.size', 'cloning.h.inRange'],
        rows: found.map((f) => [fmt(f.d), fmt(f.size), { word: f.d >= lo && f.d <= hi ? 'w.yes' : 'w.no' }]),
      },
    ],
    figures: [
      {
        title: 'cloning.h.gel',
        figure: gelFigure([
          {
            label: { word: 'cloning.h.ladderLane' },
            bands: sizes.map((s, k) => ({ at: distances[k]! / far, label: fmt(s) })),
          },
          {
            label: { word: 'cloning.h.sampleLane' },
            bands: found.map((f) => ({ at: f.d / far, label: fmt(f.size, 4) })),
          },
        ]),
      },
    ],
    latex: equation,
    steps: [
      {
        key: cubic ? 'cloning.s.fitCubic' : 'cloning.s.fitLine',
        vars: { count: String(sizes.length), r2: fmt(fit.r2) },
        math: equation,
      },
      {
        key: 'cloning.s.band',
        vars: { distance: fmt(first.d), log: fmt(Math.log10(first.size)), size: fmt(first.size) },
        math: `s = 10^{${fmt(Math.log10(first.size))}} = ${fmt(first.size)}\\ \\text{bp}`,
      },
    ],
    notes: [
      'cloning.n.gelFit',
      ...(found.some((f) => f.d < lo || f.d > hi) ? ['cloning.n.extrapolate' as MolKey] : []),
    ],
  });
}

const sign = (v: number): string => (v < 0 ? `- ${fmt(-v)}` : `+ ${fmt(v)}`);

function primer(values: Values): KitOk {
  const seq = primerText(values.primer ?? '', 'cloning.f.primer');
  const sodium = positive(values, 'sodium', 'cloning.f.sodium') / 1000;
  const total = positive(values, 'conc', 'cloning.f.conc') * 1e-6;
  const gc = gcFraction(seq);
  const nn = nearestNeighbor(seq, sodium, total);
  const self = dimer(seq, seq);
  const stem = hairpin(seq);
  const clamp = gcClamp(seq);
  const notes: MolKey[] = ['cloning.n.tmModels'];
  if (seq.length < 14 || seq.length > 40) notes.push('cloning.n.length');
  if (gc < 0.4 || gc > 0.6) notes.push('cloning.n.gc');
  if (clamp > 3) notes.push('cloning.n.clamp');
  if (self.threeEnd >= 4) notes.push('cloning.n.dimer');
  if (stem >= 4) notes.push('cloning.n.hairpin');
  const tmMath =
    `T_m = \\frac{1000\\,\\Delta H}{\\Delta S + R\\ln(C_T/${nn.selfComplementary ? 1 : 4})} - 273.15 = ` +
    `\\frac{1000(${fmt(nn.dH)})}{${fmt(nn.dS)} + ${fmt(nn.concTerm)}} - 273.15 = ${fmt(nn.tm, 5)}\\,^{\\circ}\\mathrm{C}`;
  return ok({
    answer: { key: 'cloning.a.primer', vars: { tm: fmt(nn.tm, 4), wallace: fmt(wallace(seq)), gc: pct(gc, 5) } },
    rows: [
      { key: 'cloning.r.length', value: `${seq.length} nt` },
      { key: 'cloning.r.gc', value: pct(gc, 5) },
      { key: 'cloning.r.clamp', value: String(clamp) },
      { key: 'cloning.r.wallace', value: `${fmt(wallace(seq))} °C` },
      { key: 'cloning.r.salt', value: `${fmt(saltAdjusted(seq, sodium), 4)} °C` },
      { key: 'cloning.r.nn', value: `${fmt(nn.tm, 5)} °C` },
      { key: 'cloning.r.dH', value: `${fmt(nn.dH)} kcal/mol` },
      { key: 'cloning.r.dS', value: `${fmt(nn.dS)} cal/(mol·K)` },
      { key: 'cloning.r.selfDimer', value: String(self.run) },
      { key: 'cloning.r.threeEnd', value: String(self.threeEnd) },
      { key: 'cloning.r.hairpin', value: String(stem) },
      { key: 'cloning.r.mass', value: `${fmt(oligoMass(seq), 7)} g/mol` },
    ],
    latex: tmMath,
    steps: [
      { key: 'cloning.s.wallace', math: `T_m = 2(A+T) + 4(G+C) = ${fmt(wallace(seq))}\\,^{\\circ}\\mathrm{C}` },
      { key: 'cloning.s.nnSum', vars: { dH: fmt(nn.dH), dS: fmt(nn.dS1M), self: nn.selfComplementary ? 'yes' : 'no' } },
      {
        key: 'cloning.s.salt',
        vars: { n: String(seq.length), sodium: fmt(sodium), term: fmt(nn.saltTerm), dS: fmt(nn.dS) },
        math: `\\Delta S_{Na} = ${fmt(nn.dS1M)} + 0.368 \\times ${seq.length - 1} \\times \\ln ${fmt(sodium)} = ${fmt(nn.dS)}`,
      },
      { key: 'cloning.s.tm', math: tmMath },
      { key: 'cloning.s.dimers', vars: { run: String(self.run), end: String(self.threeEnd), stem: String(stem) } },
    ],
    notes,
    source: 'cloning.src.nn',
  });
}

function pcr(values: Values): KitOk {
  const { seq } = cleanDna(values.template ?? '');
  const forward = primerText(values.forward ?? '', 'cloning.f.forward');
  const reverse = primerText(values.reverse ?? '', 'cloning.f.reverse');
  const sodium = positive(values, 'sodium', 'cloning.f.sodium') / 1000;
  const total = positive(values, 'conc', 'cloning.f.conc') * 1e-6;
  const product = pcrProduct(seq, forward, reverse, values.topology === 'circular');
  const tf = nearestNeighbor(forward, sodium, total).tm;
  const tr = nearestNeighbor(reverse, sodium, total).tm;
  const gc = gcFraction(product.seq);
  const { productTm, ta } = annealing(Math.min(tf, tr), gc, product.length, sodium);
  const pair = dimer(forward, reverse);
  const notes: MolKey[] = ['cloning.n.exact', 'cloning.n.annealing'];
  if (product.forwardHits > 1 || product.reverseHits > 1) notes.push('cloning.n.manyHits');
  if (Math.abs(tf - tr) > 5) notes.push('cloning.n.tmGap');
  return ok({
    answer: { key: 'cloning.a.pcr', vars: { length: String(product.length), ta: fmt(ta, 3) } },
    rows: [
      { key: 'cloning.r.product', value: `${product.length} bp` },
      { key: 'cloning.r.span', value: `${product.from}–${product.to}` },
      { key: 'cloning.r.gc', value: pct(gc, 4) },
      { key: 'cloning.r.tmForward', value: `${fmt(tf, 4)} °C` },
      { key: 'cloning.r.tmReverse', value: `${fmt(tr, 4)} °C` },
      { key: 'cloning.r.productTm', value: `${fmt(productTm, 4)} °C` },
      { key: 'cloning.r.ta', value: `${fmt(ta, 3)} °C` },
      { key: 'cloning.r.crossDimer', value: String(pair.threeEnd) },
    ],
    blocks: [{ title: 'cloning.h.product', text: numbered(product.seq) }],
    steps: [
      { key: 'cloning.s.forward', vars: { from: String(product.from) } },
      { key: 'cloning.s.reverse', vars: { to: String(product.to), length: String(product.length) } },
      {
        key: 'cloning.s.anneal',
        math:
          `T_a = 0.3\\,T_m^{\\text{primer}} + 0.7\\,T_m^{\\text{product}} - 14.9 = 0.3(${fmt(Math.min(tf, tr), 4)}) + ` +
          `0.7(${fmt(productTm, 4)}) - 14.9 = ${fmt(ta, 4)}\\,^{\\circ}\\mathrm{C}`,
      },
    ],
    notes,
    source: 'cloning.src.nn',
  });
}

function oligo(values: Values): KitOk {
  const seq = primerText(values.oligo ?? '', 'cloning.f.oligo');
  const absorbance = positive(values, 'a260', 'cloning.f.a260');
  const path = positive(values, 'path', 'cloning.f.path');
  const mass = oligoMass(seq);
  const eps = extinction(seq);
  const molar = absorbance / (eps * path);
  const ngPerUl = molar * mass * 1000;
  return ok({
    answer: { key: 'cloning.a.oligo', vars: { mass: fmt(mass, 7), conc: fmt(molar * 1e6, 4) } },
    rows: [
      { key: 'cloning.r.mass', value: `${fmt(mass, 7)} g/mol` },
      { key: 'cloning.r.eps', value: `${fmt(eps)} L/(mol·cm)` },
      { key: 'cloning.r.molar', value: `${fmt(molar * 1e6, 5)} µM` },
      { key: 'cloning.r.massConc', value: `${fmt(ngPerUl, 5)} ng/µL` },
    ],
    latex: `c = \\frac{A_{260}}{\\varepsilon\\,\\ell} = \\frac{${fmt(absorbance)}}{${fmt(eps)} \\times ${fmt(path)}} = ${fmt(molar * 1e6, 5)}\\ \\mu\\text{M}`,
    steps: [
      {
        key: 'cloning.s.mass',
        math: `M = 313.21A + 304.2T + 289.18C + 329.21G - 61.96 = ${fmt(mass, 7)}\\ \\text{g/mol}`,
      },
      { key: 'cloning.s.eps', vars: { eps: fmt(eps) } },
      {
        key: 'cloning.s.beer',
        math: `c = \\frac{A_{260}}{\\varepsilon\\,\\ell} = \\frac{${fmt(absorbance)}}{${fmt(eps)} \\times ${fmt(path)}} = ${fmt(molar * 1e6, 5)}\\ \\mu\\text{M}`,
      },
    ],
    notes: ['cloning.n.oligo'],
    source: 'cloning.src.eps',
  });
}

function ligation(values: Values): KitOk {
  const vectorNg = positive(values, 'vectorNg', 'cloning.f.vectorNg');
  const vectorBp = positive(values, 'vectorBp', 'cloning.f.vectorBp');
  const insertBp = positive(values, 'insertBp', 'cloning.f.insertBp');
  const ratio = positive(values, 'ratio', 'cloning.f.ratio');
  const ng = insertMass(ratio, vectorNg, insertBp, vectorBp);
  const pmolVector = moles(vectorNg, vectorBp) * 1e12;
  const pmolInsert = moles(ng, insertBp) * 1e12;
  const math = `m_{\\text{insert}} = r \\times m_{\\text{vector}} \\times \\frac{L_{\\text{insert}}}{L_{\\text{vector}}} = ${fmt(ratio)} \\times ${fmt(vectorNg)} \\times \\frac{${fmt(insertBp)}}{${fmt(vectorBp)}} = ${fmt(ng)}\\ \\text{ng}`;
  return ok({
    answer: { key: 'cloning.a.ligation', vars: { ng: fmt(ng), ratio: fmt(ratio) } },
    rows: [
      { key: 'cloning.r.insertNg', value: `${fmt(ng)} ng` },
      { key: 'cloning.r.vectorPmol', value: `${fmt(pmolVector, 4)} pmol` },
      { key: 'cloning.r.insertPmol', value: `${fmt(pmolInsert, 4)} pmol` },
    ],
    latex: math,
    steps: [
      { key: 'cloning.s.ligation', math },
      {
        key: 'cloning.s.pmol',
        vars: { bp: String(BP_MASS) },
        math: `n = \\frac{m}{L \\times ${BP_MASS}\\ \\text{g/mol}}`,
      },
    ],
    notes: ['cloning.n.bpMass'],
  });
}

function copyNumber(values: Values): KitOk {
  const ng = positive(values, 'massNg', 'cloning.f.massNg');
  const bp = positive(values, 'lengthBp', 'cloning.f.lengthBp');
  const volume = positive(values, 'volume', 'cloning.f.volume');
  const n = copies(ng, bp);
  const mol = moles(ng, bp);
  const nanomolar = (mol / (volume * 1e-6)) * 1e9;
  const math = `N = \\frac{m}{L \\times ${BP_MASS}} N_A = \\frac{${fmt(ng)} \\times 10^{-9}}{${fmt(bp)} \\times ${BP_MASS}} \\times 6.02214076 \\times 10^{23} = ${fmt(n, 5)}`;
  return ok({
    answer: { key: 'cloning.a.copies', vars: { copies: fmt(n, 5), ng: fmt(ng), bp: fmt(bp) } },
    rows: [
      { key: 'cloning.r.copies', value: fmt(n, 5) },
      { key: 'cloning.r.moles', value: `${fmt(mol * 1e15, 5)} fmol` },
      { key: 'cloning.r.molarity', value: `${fmt(nanomolar, 5)} nM`, vars: { volume: fmt(volume) } },
    ],
    latex: math,
    steps: [
      { key: 'cloning.s.copies', math },
      { key: 'cloning.s.molarity', math: `c = \\frac{n}{V} = ${fmt(nanomolar, 5)}\\ \\text{nM}` },
    ],
    notes: ['cloning.n.bpMass'],
  });
}

export const spec: ToolSpec = {
  id: 'cloning',
  fields,
  run(values) {
    switch (values.mode as Mode) {
      case 'gel':
        return gel(values);
      case 'primer':
        return primer(values);
      case 'pcr':
        return pcr(values);
      case 'oligo':
        return oligo(values);
      case 'ligation':
        return ligation(values);
      case 'copies':
        return copyNumber(values);
      default:
        return digest(values);
    }
  },
};
