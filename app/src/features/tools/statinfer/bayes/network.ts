// Small discrete Bayesian networks of true-or-false nodes, solved exactly by enumerating every joint state.
//
// A network is typed one node to a line: `Name: p` for a node with no parents, or `Name | A, B: p1, p2, p3, p4` for
// a node with parents. The numbers are P(Name is true) for each combination of the parents, counted like binary
// numbers with false before true and the last parent changing fastest: (F, F), (F, T), (T, F), (T, T).
import { toNumber } from '../num/data';
import { check, num, step, tex, type Cell, type Report } from '../report';

export const MAX_NODES = 8;

export interface NetNode {
  readonly name: string;
  readonly parents: readonly string[];
  /** P(this node is true) for each combination of the parents, in counting order. */
  readonly table: readonly number[];
}

export type Evidence = ReadonlyMap<string, boolean>;

export function parseNetwork(text: string): NetNode[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  check(lines.length > 0, 'networkEmpty');
  check(lines.length <= MAX_NODES, 'networkSize', { max: String(MAX_NODES) });
  const nodes = lines.map((line): NetNode => {
    const colon = line.lastIndexOf(':');
    const shown = line.trim().slice(0, 40);
    check(colon > 0, 'networkLine', { text: shown });
    const head = line.slice(0, colon);
    const bar = head.indexOf('|');
    const name = (bar >= 0 ? head.slice(0, bar) : head).trim();
    check(name !== '', 'networkLine', { text: shown });
    const parents =
      bar >= 0
        ? head
            .slice(bar + 1)
            .split(',')
            .map((p) => p.trim())
        : [];
    check(!parents.includes(''), 'networkLine', { text: shown });
    const cells = line
      .slice(colon + 1)
      .split(/[,;\s]+/)
      .filter((c) => c !== '');
    const table = cells.map(toNumber);
    const want = 2 ** parents.length;
    check(table.length === want, 'networkCount', { name, want: String(want), got: String(table.length) });
    for (const p of table) check(Number.isFinite(p) && p >= 0 && p <= 1, 'networkProbability', { name });
    return { name, parents, table };
  });
  checkNetwork(nodes);
  return nodes;
}

/** Names are unique, every parent is a node, nothing is its own parent twice over, and there is no cycle. */
function checkNetwork(nodes: readonly NetNode[]) {
  const names = new Set<string>();
  for (const n of nodes) {
    check(!names.has(n.name.toLowerCase()), 'networkDuplicate', { name: n.name });
    names.add(n.name.toLowerCase());
  }
  const byName = new Map(nodes.map((n) => [n.name.toLowerCase(), n]));
  for (const n of nodes) {
    check(new Set(n.parents.map((p) => p.toLowerCase())).size === n.parents.length, 'networkDuplicate', {
      name: n.name,
    });
    for (const p of n.parents) check(byName.has(p.toLowerCase()), 'networkParent', { name: n.name, parent: p });
  }
  // Depth-first search for a cycle: 1 = on the current path, 2 = finished.
  const mark = new Map<string, number>();
  const visit = (key: string) => {
    const state = mark.get(key);
    check(state !== 1, 'networkCycle', { name: byName.get(key)!.name });
    if (state === 2) return;
    mark.set(key, 1);
    for (const p of byName.get(key)!.parents) visit(p.toLowerCase());
    mark.set(key, 2);
  };
  for (const n of nodes) visit(n.name.toLowerCase());
}

/** Reads `Name = true, Other = false` (also yes/no, t/f, 1/0). An empty text is no evidence. */
export function parseEvidence(text: string, nodes: readonly NetNode[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const byName = new Map(nodes.map((n) => [n.name.toLowerCase(), n.name]));
  for (const part of text.split(/[,;\n]/)) {
    if (part.trim() === '') continue;
    const [left, right = ''] = part.split('=');
    const name = byName.get(left.trim().toLowerCase());
    check(name !== undefined, 'evidenceNode', { text: left.trim().slice(0, 40) });
    const value = right.trim().toLowerCase();
    const truth = ['true', 't', 'yes', 'y', '1'].includes(value)
      ? true
      : ['false', 'f', 'no', 'n', '0'].includes(value)
        ? false
        : null;
    check(truth !== null, 'evidenceValue', { text: part.trim().slice(0, 40) });
    check(!out.has(name) || out.get(name) === truth, 'evidenceClash', { name });
    out.set(name, truth);
  }
  return out;
}

export interface NetworkResult {
  /** P(evidence), the sum of the joint over the states that agree with it. */
  readonly evidence: number;
  /** P(node is true | evidence), in the order of the nodes. */
  readonly marginals: readonly number[];
  /** How many of the 2^n joint states agree with the evidence. */
  readonly states: number;
}

/** Exact inference by enumeration: the joint is the product of each node's table entry. */
export function inferNetwork(nodes: readonly NetNode[], evidence: Evidence): NetworkResult {
  const index = new Map(nodes.map((n, i) => [n.name.toLowerCase(), i]));
  const parentIndex = nodes.map((n) => n.parents.map((p) => index.get(p.toLowerCase())!));
  const fixed = nodes.map((n) => evidence.get(n.name));
  const count = nodes.length;
  const truthMass = new Array<number>(count).fill(0);
  let total = 0;
  let states = 0;
  for (let s = 0; s < 2 ** count; s += 1) {
    const value = (i: number) => ((s >> i) & 1) === 1;
    if (fixed.some((f, i) => f !== undefined && f !== value(i))) continue;
    states += 1;
    let joint = 1;
    for (let i = 0; i < count && joint > 0; i += 1) {
      let row = 0;
      for (const p of parentIndex[i]) row = row * 2 + (value(p) ? 1 : 0);
      const pTrue = nodes[i].table[row];
      joint *= value(i) ? pTrue : 1 - pTrue;
    }
    total += joint;
    for (let i = 0; i < count; i += 1) if (value(i)) truthMass[i] += joint;
  }
  check(total > 0, 'networkImpossible');
  return { evidence: total, marginals: truthMass.map((m) => m / total), states };
}

const truthWord = (b: boolean) => (b ? 'T' : 'F');

/** The parent combination of a table row, such as `A = T, B = F`. */
function rowLabel(parents: readonly string[], row: number): string {
  return parents.map((p, j) => `${p} = ${truthWord(((row >> (parents.length - 1 - j)) & 1) === 1)}`).join(', ');
}

export function networkReport(text: string, evidenceText: string, queryText: string): Report {
  const nodes = parseNetwork(text);
  const evidence = parseEvidence(evidenceText, nodes);
  const result = inferNetwork(nodes, evidence);
  const queryKey = queryText.trim().toLowerCase();
  let q = queryKey === '' ? nodes.findIndex((n) => !evidence.has(n.name)) : -1;
  if (queryKey !== '') q = nodes.findIndex((n) => n.name.toLowerCase() === queryKey);
  check(q >= 0, 'queryNode', { text: queryText.trim().slice(0, 40) });
  const query = nodes[q];
  const given = [...evidence].map(([n, v]) => `${n} = ${truthWord(v)}`).join(', ');
  const condition = given === '' ? '' : ` \\mid \\text{${given}}`;
  const factors = nodes
    .map((n) =>
      n.parents.length ? `P(\\text{${n.name}} \\mid \\text{${n.parents.join(', ')}})` : `P(\\text{${n.name}})`,
    )
    .join('\\,');
  return {
    answer: {
      key: 'network',
      vars: { node: query.name, p: num(result.marginals[q], 5), given: given === '' ? '—' : given },
      latex: `P(\\text{${query.name}} = T${condition}) = ${tex(result.marginals[q], 5)}`,
    },
    tables: [
      {
        title: 'networkPosterior',
        columns: ['node', 'probabilityTrue'],
        rows: nodes.map((n, i): Cell[] => [
          evidence.has(n.name) ? `${n.name} (${truthWord(evidence.get(n.name)!)})` : n.name,
          result.marginals[i],
        ]),
      },
      {
        title: 'networkTables',
        columns: ['node', 'parentStates', 'probabilityTrue'],
        rows: nodes.flatMap((n) =>
          n.table.map((p, row): Cell[] => [n.name, n.parents.length ? rowLabel(n.parents, row) : '—', p]),
        ),
      },
    ],
    steps: [
      step('yNetworkJoint', `P(\\text{all}) = ${factors}`),
      step('yNetworkSum', `P(E) = ${tex(result.evidence)}`, {
        states: String(result.states),
        total: String(2 ** nodes.length),
      }),
      step(
        'yNetworkQuery',
        `P(\\text{${query.name}} = T${condition}) = \\frac{${tex(result.marginals[q] * result.evidence)}}{${tex(result.evidence)}} = ${tex(result.marginals[q], 5)}`,
        { node: query.name },
      ),
    ],
  };
}
