// Contract between the shell (Phase 2) and storage (Phase 3). Changes need approval from both phase owners.
//
// The property test: random sequences of create, rename, move, level changes, trash, and restore run against a
// service and the reference model. Both must succeed or fail with the same code, the trees must match after each
// step, every node must be reachable once, and restore must return exactly what trash removed.

import fc from 'fast-check';
import { expect } from 'vitest';
import { NotesError } from '../errors';
import type { NodeId, NodeKind, NotesService, NodeSummary, PageLevel, TrashReceiptId } from '../types';
import { kase } from './helpers';
import type { ContractCase, MakeService } from './helpers';
import { NotesModel } from './model';
import { canHold, displayOrder, listOf } from './model-state';

type Op =
  | { type: 'create'; kind: NodeKind | 'fit'; parent: number; before: number; level: PageLevel; title: string }
  | { type: 'rename'; target: number; title: string }
  | { type: 'move'; targets: number[]; parent: number; before: number; fit: boolean }
  | { type: 'level'; targets: number[]; level: PageLevel }
  | { type: 'trash'; targets: number[] }
  | { type: 'restore'; receipt: number };

const title = fc.constantFrom('Alpha', 'Beta', '  Gamma  ', 'Delta', '', 'x'.repeat(201));
const level = fc.constantFrom<PageLevel>(0, 0, 1, 2);
const refs = fc.array(fc.nat(), { minLength: 1, maxLength: 3 });
const kind = fc.constantFrom<NodeKind | 'fit'>('fit', 'fit', 'fit', 'notebook', 'sectionGroup', 'section', 'page');
const OPS: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({ type: fc.constant('create'), kind, parent: fc.nat(), before: fc.nat(), level, title }),
  },
  { weight: 1, arbitrary: fc.record({ type: fc.constant('rename'), target: fc.nat(), title }) },
  {
    weight: 4,
    arbitrary: fc.record({
      type: fc.constant('move'),
      targets: refs,
      parent: fc.nat(),
      before: fc.nat(),
      fit: fc.boolean(),
    }),
  },
  { weight: 1, arbitrary: fc.record({ type: fc.constant('level'), targets: refs, level }) },
  { weight: 2, arbitrary: fc.record({ type: fc.constant('trash'), targets: refs }) },
  { weight: 2, arbitrary: fc.record({ type: fc.constant('restore'), receipt: fc.nat() }) },
) as fc.Arbitrary<Op>;

interface Run {
  readonly model: NotesModel;
  readonly service: NotesService;
  /** Model id to service id. */
  readonly ids: Map<string, NodeId>;
  readonly receipts: [string, TrashReceiptId][];
}

type Outcome = { ok: true; value: unknown } | { ok: false; code: string };

async function attempt(work: () => unknown): Promise<Outcome> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (!(error instanceof NotesError)) throw error;
    return { ok: false, code: error.code };
  }
}

function pick<T>(items: readonly T[], index: number): T {
  return items[index % items.length];
}

interface Steps {
  model(): unknown;
  service(): Promise<unknown>;
}

/** Resolves an operation's indexes against the model's live nodes, as model ids and service ids. */
class Resolver {
  readonly live: string[];
  private readonly run: Run;

  constructor(run: Run) {
    this.run = run;
    this.live = [...displayOrder(run.model.state).keys()];
  }

  service = (id: string): NodeId => this.run.ids.get(id) ?? (id as NodeId);

  serviceOrNull(id: string | null): NodeId | null {
    return id === null ? null : this.service(id);
  }

  targets(indexes: readonly number[]): string[] {
    return this.live.length ? indexes.map((i) => pick(this.live, i)) : ['missing'];
  }

  kindOf(id: string | null): NodeKind | 'root' {
    return id === null ? 'root' : (this.run.model.state.nodes.get(id)?.kind ?? 'root');
  }

  /** A parent and a beforeId; with `holds`, only parents that can hold that kind are candidates. */
  placement(parentIndex: number, beforeIndex: number, holds?: NodeKind) {
    const all = [null, ...this.live];
    const parentKind = (id: string | null) => (id === null ? null : (this.kindOf(id) as NodeKind));
    const fitting = holds ? all.filter((id) => canHold(parentKind(id), holds)) : [];
    const parentId = pick<string | null>(fitting.length ? fitting : all, parentIndex);
    const beforeId = pick<string | null>([...listOf(this.run.model.state, parentId), null], beforeIndex);
    return {
      model: { parentId: parentId as NodeId | null, beforeId: beforeId as NodeId | null },
      service: { parentId: this.serviceOrNull(parentId), beforeId: this.serviceOrNull(beforeId) },
    };
  }
}

const FIT: Record<string, NodeKind> = {
  root: 'notebook',
  notebook: 'section',
  sectionGroup: 'section',
  section: 'page',
};

function planCreate(run: Run, r: Resolver, op: Extract<Op, { type: 'create' }>): Steps {
  const where = r.placement(op.parent, op.before);
  const nodeKind = op.kind === 'fit' ? (FIT[r.kindOf(where.model.parentId)] ?? 'page') : op.kind;
  const input = { kind: nodeKind, title: op.title, pageLevel: op.level };
  return {
    model: () => run.model.create({ ...input, placement: where.model }),
    service: () => run.service.create({ ...input, placement: where.service }),
  };
}

function planMove(run: Run, r: Resolver, op: Extract<Op, { type: 'move' }>): Steps {
  const ids = r.targets(op.targets);
  const first = r.kindOf(ids[0]);
  const where = r.placement(op.parent, op.before, op.fit && first !== 'root' ? first : undefined);
  return {
    model: () => run.model.move(ids, where.model),
    service: () => run.service.move(ids.map(r.service), where.service),
  };
}

function planRestore(run: Run, op: Extract<Op, { type: 'restore' }>): Steps {
  const [modelReceipt, serviceReceipt] = run.receipts.length
    ? pick(run.receipts, op.receipt)
    : ['missing', 'missing' as TrashReceiptId];
  return { model: () => run.model.restore(modelReceipt), service: () => run.service.restore(serviceReceipt) };
}

function plan(run: Run, op: Op): Steps {
  const r = new Resolver(run);
  switch (op.type) {
    case 'create':
      return planCreate(run, r, op);
    case 'move':
      return planMove(run, r, op);
    case 'restore':
      return planRestore(run, op);
    case 'rename': {
      const [id] = r.targets([op.target]);
      return {
        model: () => run.model.rename(id, op.title),
        service: () => run.service.rename(r.service(id), op.title),
      };
    }
    case 'level': {
      const ids = r.targets(op.targets);
      return {
        model: () => run.model.setPageLevel(ids, op.level),
        service: () => run.service.setPageLevel(ids.map(r.service), op.level),
      };
    }
    case 'trash': {
      const ids = r.targets(op.targets);
      return { model: () => run.model.trash(ids), service: () => run.service.trash(ids.map(r.service)) };
    }
  }
}

function record(run: Run, op: Op, model: unknown, service: unknown): void {
  const mapped = (nodes: readonly NodeSummary[]) => nodes.map((node) => run.ids.get(node.id) ?? node.id);
  if (op.type === 'create') run.ids.set((model as NodeSummary).id, (service as NodeSummary).id);
  if (op.type === 'trash') {
    const [m, s] = [model as { id: string; nodeIds: NodeId[] }, service as { id: TrashReceiptId; nodeIds: NodeId[] }];
    run.receipts.push([m.id, s.id]);
    expect(s.nodeIds).toEqual(m.nodeIds.map((id) => run.ids.get(id) ?? id));
  }
  if (op.type === 'restore')
    expect((service as NodeSummary[]).map((node) => node.id)).toEqual(mapped(model as NodeSummary[]));
}

const shape = (node: NodeSummary) => [node.kind, node.title, node.color, node.pageLevel, node.childCount];

/** Walks both trees together, mapping ids for nodes the model and service each created by themselves. */
async function compareTrees(run: Run): Promise<void> {
  const seen = new Set<string>();
  const walk = async (modelParent: string | null, serviceParent: NodeId | null): Promise<void> => {
    const expected = modelParent === null ? run.model.listNotebooks() : run.model.listChildren(modelParent);
    const actual =
      serviceParent === null ? await run.service.listNotebooks() : await run.service.listChildren(serviceParent);
    expect(actual.map(shape)).toEqual(expected.map(shape));
    for (const [i, node] of actual.entries()) {
      expect(seen.has(node.id)).toBe(false);
      seen.add(node.id);
      const known = run.ids.get(expected[i].id);
      if (known === undefined) run.ids.set(expected[i].id, node.id);
      else expect(node.id).toBe(known);
      if (node.kind !== 'page') await walk(expected[i].id, node.id);
    }
  };
  await walk(null, null);
  expect((await run.service.listTrash()).length).toBe(run.model.listTrash().length);
}

async function runOps(make: MakeService, ops: readonly Op[]): Promise<void> {
  const run: Run = { model: new NotesModel(), service: await make(), ids: new Map(), receipts: [] };
  for (const op of ops) {
    const steps = plan(run, op);
    const model = await attempt(steps.model);
    const service = await attempt(steps.service);
    expect({ op: op.type, code: service.ok ? 'ok' : service.code }).toEqual({
      op: op.type,
      code: model.ok ? 'ok' : model.code,
    });
    if (model.ok && service.ok) record(run, op, model.value, service.value);
    await compareTrees(run);
  }
}

export const propertyCases: readonly ContractCase[] = [
  kase('property.model', 'agrees with the reference model on random sequences of changes', async (_s, make) => {
    await fc.assert(
      fc.asyncProperty(fc.array(OPS, { maxLength: 24 }), (ops) => runOps(make, ops)),
      { numRuns: 60 },
    );
  }),
];
