// Phylogenetic trees: distances from an alignment, UPGMA and neighbor-joining with every matrix shown, Fitch
// parsimony on a tree or by exhaustive search, a seeded bootstrap with a majority-rule consensus, and Newick trees
// to reroot, ladderize, draw, and ask questions of.
import { Rng, parseSeed } from '../../subjects/num/rng';
import { fail, fmt, numberList, ok, whole } from '../shared';
import type { KitOk, KitStep, KitTable, MolKey, Values } from '../shared';
import { choices } from '../spec';
import type { Field, ToolSpec } from '../spec';
import { readFasta } from '../sequence/dna';
import { bootstrap, distances, fitch, neighborJoining, saturated, searchParsimony, upgma } from './build';
import type { Built, Model, Taxon } from './build';
import { treeFigure } from './draw';
import type { Style } from './draw';
import {
  hasLengths,
  isLeaf,
  isMonophyletic,
  ladderize,
  leaves,
  mrca,
  readNewick,
  reroot,
  sisters,
  writeNewick,
} from './tree';
import type { TreeNode } from './tree';

const MODES = ['distance', 'matrix', 'parsimony', 'bootstrap', 'newick'] as const;
type Mode = (typeof MODES)[number];
const is =
  (...modes: Mode[]) =>
  (v: Values) =>
    modes.includes((v.mode ?? 'distance') as Mode);

const ALIGNMENT = [
  '>A',
  'ACGTACGTACGTACGTACGTACGTAC',
  '>B',
  'ACGTACGTACGAACGTACGTACGTAC',
  '>C',
  'ACGTTCGTACGAACGTTCGTACCTAC',
  '>D',
  'TCGTTCGAACGAACCTTCGTACCTAG',
  '>E',
  'TCGTTCGAACGTACCTTCGAACCTAG',
].join('\n');

const NJ_MATRIX = ['a 0 5 9 9 8', 'b 5 0 10 10 9', 'c 9 10 0 8 7', 'd 9 10 8 0 3', 'e 8 9 7 3 0'].join('\n');
const TEACHING = 8;

const fields: Field[] = [
  { id: 'mode', label: 'phylo.f.mode', kind: 'select', initial: 'distance', options: choices('phylo.m.', MODES) },
  {
    id: 'alignment',
    label: 'phylo.f.alignment',
    kind: 'area',
    initial: ALIGNMENT,
    hint: 'phylo.f.alignmentHint',
    when: is('distance', 'parsimony', 'bootstrap'),
  },
  {
    id: 'seqType',
    label: 'phylo.f.seqType',
    kind: 'select',
    initial: 'dna',
    options: choices('phylo.seqType.', ['dna', 'protein']),
    when: is('distance', 'bootstrap'),
  },
  {
    id: 'model',
    label: 'phylo.f.model',
    kind: 'select',
    initial: 'jc',
    options: choices('phylo.model.', ['p', 'jc', 'k2p', 'poisson']),
    when: is('distance', 'bootstrap'),
  },
  {
    id: 'matrix',
    label: 'phylo.f.matrix',
    kind: 'area',
    initial: NJ_MATRIX,
    hint: 'phylo.f.matrixHint',
    when: is('matrix'),
  },
  {
    id: 'method',
    label: 'phylo.f.method',
    kind: 'select',
    initial: 'nj',
    options: choices('phylo.method.', ['nj', 'upgma']),
    when: is('distance', 'matrix', 'bootstrap'),
  },
  { id: 'tree', label: 'phylo.f.tree', kind: 'text', initial: '', hint: 'phylo.f.treeHint', when: is('parsimony') },
  { id: 'newick', label: 'phylo.f.newick', kind: 'area', initial: '((A:1,B:2):0.5,C:3);', when: is('newick') },
  { id: 'replicates', label: 'phylo.f.replicates', kind: 'number', initial: '100', when: is('bootstrap') },
  {
    id: 'seed',
    label: 'phylo.f.seed',
    kind: 'text',
    initial: '20251029',
    hint: 'phylo.f.seedHint',
    when: is('bootstrap'),
  },
  {
    id: 'outgroup',
    label: 'phylo.f.outgroup',
    kind: 'text',
    initial: '',
    hint: 'phylo.f.outgroupHint',
    when: is('distance', 'matrix', 'parsimony', 'newick'),
  },
  {
    id: 'ladderize',
    label: 'phylo.f.ladderize',
    kind: 'select',
    initial: 'no',
    options: choices('phylo.yesNo.', ['no', 'yes']),
    when: is('newick'),
  },
  { id: 'query', label: 'phylo.f.query', kind: 'text', initial: 'A, B', hint: 'phylo.f.queryHint', when: is('newick') },
  {
    id: 'style',
    label: 'phylo.f.style',
    kind: 'select',
    initial: 'phylogram',
    options: choices('phylo.style.', ['phylogram', 'cladogram', 'radial']),
  },
];

/** Aligned records: at least 3, unique names, the same length, letters, and gaps only. */
function readAlignment(text: string): Taxon[] {
  const records = readFasta(text);
  if (records.length < 3) return fail('phylo.e.fewSequences');
  const taxa = records.map((r, k) => ({
    name: r.name.split(/\s+/)[0] || `seq${k + 1}`,
    seq: r.seq.replace(/\s/g, '').toUpperCase(),
  }));
  const names = new Set<string>();
  for (const t of taxa) {
    if (names.has(t.name)) fail('phylo.e.duplicateTaxon', { name: t.name });
    names.add(t.name);
    const bad = [...t.seq].findIndex((ch) => !/[A-Z.?*-]/.test(ch));
    if (bad !== -1) fail('phylo.e.badLetter', { name: t.name, char: t.seq[bad]!, position: String(bad + 1) });
  }
  const length = taxa[0]!.seq.length;
  if (length === 0) fail('phylo.e.emptySequence', { name: taxa[0]!.name });
  for (const t of taxa)
    if (t.seq.length !== length)
      fail('phylo.e.unequal', { name: t.name, length: String(t.seq.length), first: String(length) });
  return taxa;
}

/** A square or lower-triangular matrix with a name at the start of each row; a first line with only a count is skipped. */
function readMatrix(text: string): { names: string[]; d: number[][] } {
  let rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
  if (rows.length > 0 && /^\d+$/.test(rows[0]!)) rows = rows.slice(1);
  const names: string[] = [];
  const values: number[][] = [];
  for (const row of rows) {
    const [name, ...rest] = row.split(/[\s,;]+/);
    names.push(name!);
    values.push(numberList(rest.join(' '), 'phylo.f.matrix'));
  }
  const n = names.length;
  if (n < 3) return fail('phylo.e.fewTaxa');
  if (new Set(names).size !== n)
    return fail('phylo.e.duplicateTaxon', { name: names.find((x, k) => names.indexOf(x) !== k)! });
  const square = values.every((r) => r.length === n);
  const lower = values.every((r, i) => r.length === i || r.length === i + 1);
  if (!square && !lower) return fail('phylo.e.matrixShape', { n: String(n) });
  const d = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) =>
      i === j ? 0 : square ? values[i]![j]! : values[Math.max(i, j)]![Math.min(i, j)]!,
    ),
  );
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (d[i]![j]! < 0) fail('phylo.e.negative', { a: names[i]!, b: names[j]! });
      if (Math.abs(d[i]![j]! - d[j]![i]!) > 1e-9) fail('phylo.e.asymmetric', { a: names[i]!, b: names[j]! });
    }
  }
  return { names, d };
}

function modelFor(values: Values): { model: Model; protein: boolean } {
  const protein = values.seqType === 'protein';
  const model = (['p', 'jc', 'k2p', 'poisson'].includes(values.model ?? '') ? values.model : 'jc') as Model;
  if (protein && (model === 'jc' || model === 'k2p')) fail('phylo.e.modelProtein');
  if (!protein && model === 'poisson') fail('phylo.e.modelDna');
  return { model, protein };
}

const matrixTable = (
  title: MolKey,
  names: readonly string[],
  d: readonly number[][],
  vars?: Record<string, string>,
): KitTable => ({
  title,
  ...(vars ? { vars } : {}),
  head: [],
  headText: ['', ...names],
  rows: d.map((row, i) => [
    names[i]!,
    ...row.map((v) => (Number.isFinite(v) ? fmt(v, 5) : { word: 'phylo.w.undefined' as MolKey })),
  ]),
});

function finish(tree: TreeNode, values: Values): TreeNode {
  const out = (values.outgroup ?? '').trim();
  return out === '' ? tree : reroot(tree, out);
}

const style = (values: Values): Style =>
  ['cladogram', 'radial'].includes(values.style ?? '') ? (values.style as Style) : 'phylogram';

function joinSteps(
  built: Built,
  method: 'nj' | 'upgma',
  names: readonly string[],
): { steps: KitStep[]; tables: KitTable[] } {
  const steps: KitStep[] = [];
  const tables: KitTable[] = [];
  const small = names.length <= TEACHING;
  built.steps.forEach((s, k) => {
    if (small) tables.push(matrixTable('phylo.h.stepMatrix', s.names, s.matrix, { step: String(k + 1) }));
    if (method === 'upgma') {
      steps.push({
        key: 'phylo.s.upgmaJoin',
        vars: { step: String(k + 1), a: s.a, b: s.b, node: s.node, height: fmt(s.la) },
      });
    } else if (s.c !== undefined) {
      steps.push({
        key: 'phylo.s.njCenter',
        vars: { a: s.a, b: s.b, c: s.c, node: s.node, la: fmt(s.la), lb: fmt(s.lb), lc: fmt(s.lc ?? 0) },
        math:
          `d_{${s.a}${s.node}} = \\tfrac{1}{2}(d_{${s.a}${s.b}} + d_{${s.a}${s.c}} - d_{${s.b}${s.c}}) ` +
          `= ${fmt(s.la)}`,
      });
    } else {
      steps.push({
        key: 'phylo.s.njJoin',
        vars: { step: String(k + 1), a: s.a, b: s.b, node: s.node, q: fmt(s.q ?? 0), la: fmt(s.la), lb: fmt(s.lb) },
        math:
          `Q_{${s.a}${s.b}} = (n-2)d_{${s.a}${s.b}} - R_{${s.a}} - R_{${s.b}} = ${fmt(s.q ?? 0)},\\ ` +
          `d_{${s.a}${s.node}} = \\frac{d_{${s.a}${s.b}}}{2} + \\frac{R_{${s.a}} - R_{${s.b}}}{2(n-2)} ` +
          `= ${fmt(s.la)}`,
      });
    }
  });
  return { steps, tables };
}

function built(names: string[], d: number[][], method: 'nj' | 'upgma'): Built {
  return method === 'upgma' ? upgma(names, d) : neighborJoining(names, d);
}

function treeResult(
  tree: TreeNode,
  values: Values,
  extra: Omit<KitOk, 'ok' | 'answer' | 'notes' | 'steps'> & { steps?: KitStep[]; notes?: MolKey[] },
): KitOk {
  const newick = writeNewick(tree);
  return ok({
    answer: { key: 'phylo.a.tree', vars: { newick } },
    ...extra,
    rows: extra.rows,
    figures: [{ title: 'phylo.h.tree', figure: treeFigure(tree, style(values)) }, ...(extra.figures ?? [])],
    blocks: [{ title: 'phylo.h.newick', text: newick }, ...(extra.blocks ?? [])],
  });
}

function fromDistances(
  values: Values,
  names: string[],
  d: number[][],
  intro: KitStep[],
  first: KitTable[],
  rows: KitOk['rows'],
): KitOk {
  const method = values.method === 'upgma' ? 'upgma' : 'nj';
  const result = built(names, d, method);
  const tree = finish(result.tree, values);
  const { steps, tables } = joinSteps(result, method, names);
  return treeResult(tree, values, {
    rows: [...rows, { key: 'phylo.r.method', value: '', word: `phylo.method.${method}` }],
    tables: [...first, ...tables],
    steps: [...intro, ...steps],
    notes: [
      method === 'nj' ? 'phylo.n.nj' : 'phylo.n.upgma',
      ...(names.length > TEACHING ? ['phylo.n.big' as MolKey] : []),
    ],
  });
}

const MODEL_MATH: Record<Model, string> = {
  p: 'p = \\frac{\\text{differences}}{\\text{sites compared}}',
  jc: 'd = -\\tfrac{3}{4}\\ln\\left(1 - \\tfrac{4}{3}p\\right)',
  k2p: 'd = -\\tfrac{1}{2}\\ln(1 - 2P - Q) - \\tfrac{1}{4}\\ln(1 - 2Q)',
  poisson: 'd = -\\ln(1 - p)',
};

function distance(values: Values): KitOk {
  const taxa = readAlignment(values.alignment ?? '');
  const { model, protein } = modelFor(values);
  const dist = distances(taxa, model, protein);
  const bad = saturated(dist);
  if (bad) fail('phylo.e.saturated', { a: bad[0], b: bad[1] });
  return fromDistances(
    values,
    dist.names,
    dist.d,
    [{ key: `phylo.s.model.${model}`, math: MODEL_MATH[model] }, { key: 'phylo.s.deletion' }],
    [matrixTable('phylo.h.distances', dist.names, dist.d)],
    [
      { key: 'phylo.r.taxa', value: String(taxa.length) },
      { key: 'phylo.r.sites', value: String(taxa[0]!.seq.length) },
      { key: 'phylo.r.model', value: '', word: `phylo.model.${model}` },
    ],
  );
}

function matrix(values: Values): KitOk {
  const { names, d } = readMatrix(values.matrix ?? '');
  return fromDistances(
    values,
    names,
    d,
    [],
    [matrixTable('phylo.h.distances', names, d)],
    [{ key: 'phylo.r.taxa', value: String(names.length) }],
  );
}

const clade = (n: TreeNode): string => `(${leaves(n).join(', ')})`;

function parsimony(values: Values): KitOk {
  const taxa = readAlignment(values.alignment ?? '');
  const length = taxa[0]!.seq.length;
  const informative = Array.from({ length }, (_, k) => {
    const tally = new Map<string, number>();
    for (const t of taxa) if (/[A-Z]/.test(t.seq[k]!)) tally.set(t.seq[k]!, (tally.get(t.seq[k]!) ?? 0) + 1);
    return [...tally.values()].filter((c) => c >= 2).length >= 2;
  }).filter(Boolean).length;
  const typed = (values.tree ?? '').trim();
  if (typed !== '') {
    const tree = readNewick(typed);
    const names = new Set(leaves(tree));
    for (const t of taxa) if (!names.has(t.name)) fail('phylo.e.missingTaxon', { name: t.name });
    if (names.size !== taxa.length) fail('phylo.e.extraTaxon');
    const perSite = Array.from({ length }, (_, k) => fitch(tree, new Map(taxa.map((t) => [t.name, t.seq[k]!]))));
    const total = perSite.reduce((s, f) => s + f.score, 0);
    const shown = perSite.findIndex((f) => f.score > 0);
    const steps: KitStep[] = [{ key: 'phylo.s.fitchRule' }];
    if (shown !== -1) {
      for (const s of perSite[shown]!.sets) {
        steps.push({
          key: 'phylo.s.fitchSet',
          vars: { site: String(shown + 1), clade: clade(s.node), set: `{${[...s.set].join(', ')}}` },
        });
      }
    }
    steps.push({ key: 'phylo.s.fitchTotal', vars: { total: String(total) } });
    const out = finish(tree, values);
    return treeResult(out, values, {
      rows: [
        { key: 'phylo.r.score', value: String(total) },
        { key: 'phylo.r.informative', value: String(informative) },
        { key: 'phylo.r.sites', value: String(length) },
      ],
      tables: [
        {
          title: 'phylo.h.sites',
          head: ['phylo.h.site', 'phylo.h.changes', 'phylo.h.rootSet'],
          rows: perSite.slice(0, 200).map((f, k) => [String(k + 1), String(f.score), f.sets[0]?.set ?? '—']),
        },
      ],
      steps,
      notes: ['phylo.n.fitch'],
    });
  }
  const search = searchParsimony(taxa);
  const best = finish(search.trees[0]!, values);
  return treeResult(best, values, {
    rows: [
      { key: 'phylo.r.score', value: String(search.best) },
      { key: 'phylo.r.tied', value: String(search.trees.length) },
      { key: 'phylo.r.searched', value: `${search.scored} / ${search.total}` },
      { key: 'phylo.r.informative', value: String(informative) },
    ],
    blocks: [{ title: 'phylo.h.bestTrees', text: search.trees.map(writeNewick).join('\n') }],
    steps: [
      { key: 'phylo.s.search', vars: { n: String(taxa.length), total: String(search.total) } },
      { key: 'phylo.s.bound', vars: { scored: String(search.scored) } },
      { key: 'phylo.s.best', vars: { score: String(search.best), tied: String(search.trees.length) } },
    ],
    notes: ['phylo.n.search', ...(search.trees.length >= 20 ? ['phylo.n.manyTied' as MolKey] : [])],
  });
}

function boot(values: Values): KitOk {
  const taxa = readAlignment(values.alignment ?? '');
  const { model, protein } = modelFor(values);
  const method = values.method === 'upgma' ? 'upgma' : 'nj';
  const replicates = whole(values, 'replicates', 'phylo.f.replicates', [1, 2000]);
  if (replicates * taxa.length ** 2 * taxa[0]!.seq.length > 4e7) fail('phylo.e.tooLong');
  const seed = parseSeed(values.seed ?? '') ?? fail('phylo.e.seed');
  const dist = distances(taxa, model, protein);
  const bad = saturated(dist);
  if (bad) fail('phylo.e.saturated', { a: bad[0], b: bad[1] });
  const result = bootstrap(taxa, model, protein, method, replicates, new Rng(seed));
  const full = built(dist.names, dist.d, method).tree;
  const order = taxa.map((t) => t.name);
  const label = (n: TreeNode): TreeNode => {
    if (isLeaf(n)) return n;
    const set = new Set(leaves(n));
    const side = set.has(order[0]!) ? order.filter((t) => !set.has(t)) : order.filter((t) => set.has(t));
    const share = result.support.get(side.join('\u0000'));
    const out: TreeNode = { ...n, children: n.children.map(label) };
    if (share !== undefined && side.length >= 2 && side.length <= order.length - 2)
      out.support = Math.round(share * 100);
    return out;
  };
  const labeled = label(full);
  const sorted = [...result.support].sort((a, b) => b[1] - a[1]);
  return treeResult(labeled, values, {
    rows: [
      { key: 'phylo.r.replicates', value: String(replicates) },
      { key: 'phylo.r.seed', value: String(seed) },
      { key: 'phylo.r.method', value: '', word: `phylo.method.${method}` },
      { key: 'phylo.r.consensus', value: writeNewick(result.consensus) },
    ],
    tables: [
      {
        title: 'phylo.h.splits',
        head: ['phylo.h.split', 'phylo.h.support'],
        rows: sorted
          .slice(0, 50)
          .map(([key, share]) => [`{${key.split('\u0000').join(', ')}}`, `${fmt(share * 100, 3)}%`]),
      },
    ],
    figures: [{ title: 'phylo.h.consensus', figure: treeFigure(result.consensus, 'cladogram') }],
    steps: [
      {
        key: 'phylo.s.resample',
        vars: { sites: String(taxa[0]!.seq.length), replicates: String(replicates), seed: String(seed) },
      },
      { key: 'phylo.s.splits' },
      { key: 'phylo.s.majority' },
    ],
    notes: ['phylo.n.bootstrap'],
  });
}

function newick(values: Values): KitOk {
  let tree = readNewick(values.newick ?? '');
  tree = finish(tree, values);
  if (values.ladderize === 'yes') tree = ladderize(tree);
  const taxa = leaves(tree);
  const query = (values.query ?? '')
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const rows: KitOk['rows'] = [
    { key: 'phylo.r.taxa', value: String(taxa.length) },
    { key: 'phylo.r.lengths', value: '', word: hasLengths(tree) ? 'w.yes' : 'w.no' },
    { key: 'phylo.r.rootDegree', value: String(tree.children.length) },
  ];
  const steps: KitStep[] = [{ key: 'phylo.s.read', vars: { taxa: String(taxa.length) } }];
  if (query.length > 0) {
    const common = mrca(tree, query);
    const mono = isMonophyletic(tree, query);
    const sister = sisters(tree, query);
    rows.push(
      { key: 'phylo.r.mrca', value: clade(common) },
      { key: 'phylo.r.monophyly', value: '', word: mono ? 'w.yes' : 'w.no' },
      { key: 'phylo.r.sisters', value: sister.length > 0 ? sister.join(', ') : '—' },
    );
    steps.push({
      key: mono ? 'phylo.s.mono' : 'phylo.s.notMono',
      vars: { taxa: query.join(', '), clade: clade(common) },
    });
  }
  return treeResult(tree, values, { rows, steps, notes: ['phylo.n.rooted'] });
}

export const spec: ToolSpec = {
  id: 'phylo',
  fields,
  run(values) {
    switch (values.mode as Mode) {
      case 'matrix':
        return matrix(values);
      case 'parsimony':
        return parsimony(values);
      case 'bootstrap':
        return boot(values);
      case 'newick':
        return newick(values);
      default:
        return distance(values);
    }
  },
};
