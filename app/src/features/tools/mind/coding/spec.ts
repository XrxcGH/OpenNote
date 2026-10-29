// The qualitative coding tool's fields, tables, and steps. Segments are typed or pasted one a line, so they can
// come from any page or document; each keeps its quoted text.
import { percentText } from '../kit/format';
import { str, type Outcome, type ResultTable, type ToolSpec, type Values } from '../kit/spec';
import { step } from '../kit/types';
import { analyse, codeList, readCodebook, readSegments, readTwoCoders, retrieve, tally, twoCoders } from './engine';

const isMode = (mode: string) => (v: Values) => v.mode === mode;
const raw = (text: string) => ({ raw: text });

const SEGMENTS = [
  '# segment | case | codes | quoted text',
  's1 | Interview 1 | cost, access | "The bus fare adds up every week."',
  's2 | Interview 1 | cost | "I skip the clinic when money is tight."',
  's3 | Interview 2 | access, trust | "There is no clinic I trust nearby."',
  's4 | Interview 2 | cost, access | "Parking costs more than the visit."',
].join('\n');
const PAIRS = [
  '# segment | coder 1 | coder 2',
  's1 | cost, access | cost',
  's2 | cost | cost',
  's3 | access, trust | access, trust',
  's4 | cost, access | cost, access',
  's5 | trust | access',
  's6 | | ',
].join('\n');
const CODEBOOK = [
  '# code | parent | definition | include when | exclude when | example',
  'barriers | | Anything that makes care harder to get',
  'cost | barriers | Money spent to get care | fares, fees, lost pay | insurance rules | "The fare adds up."',
  'access | barriers | Distance, hours, or transport | travel, opening hours | cost of travel',
  'trust | | Belief that care will help | confidence in staff | cost',
].join('\n');
const TALLIES = [
  '# unit | category | count',
  'ad 1 | humor | 2',
  'ad 1 | fear | 1',
  'ad 2 | fear | 3',
  'ad 3 | facts | 2',
  'ad 4 | humor | 1',
].join('\n');

function runSegments(values: Values): Outcome {
  const segments = readSegments(str(values, 'segments'));
  const order = codeList(str(values, 'order'));
  const r = analyse(segments, order);
  if (r.codes.length === 0) return { rows: [{ id: 'segments', value: segments.length }], steps: [] };
  const top = r.codes[r.frequency.indexOf(Math.max(...r.frequency))];
  const tables: ResultTable[] = [
    {
      id: 'frequency',
      columns: ['code', 'segments', 'share', 'cases'],
      rows: r.codes.map((c, i) => [c, r.frequency[i], percentText(r.frequency[i] / segments.length), r.caseCount[i]]),
    },
    { id: 'byCase', columns: ['code', ...r.cases.map(raw)], rows: r.codes.map((c, i) => [c, ...r.byCase[i]]) },
    { id: 'together', columns: ['code', ...r.codes.map(raw)], rows: r.codes.map((c, i) => [c, ...r.together[i]]) },
    {
      id: 'jaccard',
      columns: ['code', ...r.codes.map(raw)],
      rows: r.codes.map((c, i) => [c, ...r.jaccard[i].map((v) => (Number.isNaN(v) ? '' : v))]),
    },
  ];
  const wanted = str(values, 'retrieve').trim();
  if (wanted !== '')
    tables.push({
      id: 'passages',
      columns: ['segment', 'case', 'codes', 'text'],
      rows: retrieve(segments, wanted).map((s) => [s.id, s.case, s.codes.join(', '), s.text]),
    });
  const [a, b] = r.codes;
  const vars = {
    a,
    b: b ?? a,
    fa: r.frequency[0],
    fb: r.frequency[b === undefined ? 0 : 1],
    both: r.together[0][b === undefined ? 0 : 1],
    j: r.jaccard[0][b === undefined ? 0 : 1],
  };
  return {
    rows: [
      { id: 'segments', value: segments.length },
      { id: 'cases', value: r.cases.length },
      { id: 'codes', value: r.codes.length },
      { id: 'top', value: top, answer: true },
    ],
    tables,
    notes: wanted !== '' && !r.codes.includes(wanted) ? [{ id: 'notUsed', vars: { code: wanted } }] : [],
    steps: [
      step('coding.frequency'),
      step('coding.byCase'),
      step('coding.together', 'n_{\\text{[[a]]},\\text{[[b]]}} = [[both]]', vars),
      step(
        'coding.jaccard',
        'J = \\frac{|S_\\text{[[a]]} \\cap S_\\text{[[b]]}|}{|S_\\text{[[a]]} \\cup ' +
          'S_\\text{[[b]]}|} = \\frac{[[both]]}{[[fa]] + [[fb]] - [[both]]} = [[j]]',
        vars,
      ),
    ],
  };
}

function runTwoCoders(values: Values): Outcome {
  const { segments, first, second } = readTwoCoders(str(values, 'pairs'));
  const r = twoCoders(segments, first, second);
  const n = segments.length * r.codes.length;
  return {
    rows: [
      { id: 'segments', value: segments.length },
      { id: 'codes', value: r.codes.length },
      { id: 'decisions', value: n },
      { id: 'agree', value: percentText(r.agree), answer: true },
      { id: 'kappa', value: r.kappa, sym: '\\kappa', answer: true },
    ],
    tables: [
      {
        id: 'perCode',
        columns: ['code', 'first', 'second', 'agree', 'kappa'],
        rows: r.perCode.map((c) => [
          c.code,
          c.first,
          c.second,
          percentText(c.agree),
          Number.isNaN(c.kappa) ? '' : c.kappa,
        ]),
      },
      {
        id: 'disagreements',
        columns: ['segment', 'code', 'appliedBy'],
        rows: r.disagreements.map((d) => [d.segment, d.code, { word: d.by === 1 ? 'coder1' : 'coder2' }]),
      },
    ],
    notes: r.perCode.some((c) => Number.isNaN(c.kappa)) ? [{ id: 'kappaUndefined' }] : [],
    steps: [
      step('coding.decisions', 'N = [[s]] \\times [[c]] = [[n]]', { s: segments.length, c: r.codes.length, n }),
      step('coding.agree', 'p_o = [[po]]', { po: r.agree }),
      step('coding.kappa', '\\kappa = \\frac{p_o - p_e}{1 - p_e} = [[k]]', { k: r.kappa }),
    ],
  };
}

function runCodebook(values: Values): Outcome {
  const book = readCodebook(str(values, 'codebook'));
  const pad = (depth: number) => ' '.repeat(depth);
  return {
    rows: [
      { id: 'codes', value: book.length },
      { id: 'topLevel', value: book.filter((e) => e.depth === 0).length },
      { id: 'depth', value: Math.max(...book.map((e) => e.depth)) + 1 },
    ],
    tables: [
      {
        id: 'codebook',
        columns: ['code', 'definition', 'include', 'exclude', 'example'],
        rows: book.map((e) => [pad(e.depth) + e.code, e.definition, e.include, e.exclude, e.example]),
      },
    ],
    steps: [step('coding.codebook')],
  };
}

function runTally(values: Values): Outcome {
  const r = tally(str(values, 'tallies'));
  const frame = str(values, 'frame').trim();
  const top = r.categories[r.counts.indexOf(Math.max(...r.counts))];
  return {
    rows: [
      { id: 'units', value: r.unitCount },
      { id: 'categories', value: r.categories.length },
      { id: 'total', value: r.total },
      { id: 'top', value: top, answer: true },
    ],
    tables: [
      {
        id: 'tally',
        columns: ['category', 'count', 'share', 'units', 'unitShare'],
        rows: r.categories.map((c, i) => [
          c,
          r.counts[i],
          percentText(r.counts[i] / r.total),
          r.units[i],
          percentText(r.units[i] / r.unitCount),
        ]),
      },
    ],
    notes: frame === '' ? [{ id: 'noFrame' }] : [{ id: 'frame', vars: { frame } }],
    steps: [step('coding.tally', '\\text{share} = \\frac{n_k}{[[total]]}', { total: r.total })],
  };
}

export const spec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: ['segments', 'twoCoders', 'codebook', 'tally'], first: 'segments' },
    { id: 'segments', type: 'text', rows: 7, first: SEGMENTS, when: isMode('segments') },
    { id: 'order', type: 'line', first: '', when: isMode('segments') },
    { id: 'retrieve', type: 'line', first: 'cost', when: isMode('segments') },
    { id: 'pairs', type: 'text', rows: 7, first: PAIRS, when: isMode('twoCoders') },
    { id: 'codebook', type: 'text', rows: 6, first: CODEBOOK, when: isMode('codebook') },
    { id: 'tallies', type: 'text', rows: 7, first: TALLIES, when: isMode('tally') },
    { id: 'frame', type: 'line', first: '', when: isMode('tally') },
  ],
  run(values) {
    if (values.mode === 'twoCoders') return runTwoCoders(values);
    if (values.mode === 'codebook') return runCodebook(values);
    if (values.mode === 'tally') return runTally(values);
    return runSegments(values);
  },
  examples: [
    { id: 'segments', values: { mode: 'segments' } },
    {
      id: 'small',
      values: {
        mode: 'segments',
        segments: 's1 | I1 | A, B\ns2 | I1 | A\ns3 | I2 | B, C\ns4 | I2 | A, B',
        retrieve: '',
      },
    },
    { id: 'twoCoders', values: { mode: 'twoCoders' } },
    { id: 'codebook', values: { mode: 'codebook' } },
    { id: 'tally', values: { mode: 'tally', frame: 'Every ad in one week of evening television' } },
  ],
};
