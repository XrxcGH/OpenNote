// Contract between the shell (Phase 2) and storage (Phase 3). Changes need approval from both phase owners.
//
// A NotesService backed by the reference model. The contract suite runs against it to prove that the suite and
// the model agree, so a failure against a real service points at the service.

import { NotesError } from '../errors';
import type { NodeId, NotesEvent, NotesService, NodeSummary } from '../types';
import { NotesModel } from './model';
import type { ModelOptions } from './model';

export interface ModelService extends NotesService {
  readonly model: NotesModel;
}

function settle<T>(work: () => T): Promise<T> {
  try {
    return Promise.resolve(work());
  } catch (error) {
    const wrapped = error instanceof NotesError ? error : new NotesError('io', String(error));
    return Promise.reject(wrapped);
  }
}

/** Sends events for the model's own changes, as a service may. */
class Events {
  readonly listeners = new Set<(event: NotesEvent) => void>();

  emit(...events: NotesEvent[]): void {
    events.forEach((event) => this.listeners.forEach((listener) => listener(event)));
  }

  upserted<T extends NodeSummary | readonly NodeSummary[]>(nodes: T): T {
    this.emit({ type: 'upserted', nodes: Array.isArray(nodes) ? nodes : [nodes as NodeSummary] });
    return nodes;
  }

  childrenChanged(parents: Iterable<string | null>): void {
    const unique = [...new Set(parents)];
    this.emit(...unique.map((parentId): NotesEvent => ({ type: 'childrenChanged', parentId: parentId as NodeId })));
  }
}

type Writes = Pick<NotesService, 'create' | 'rename' | 'setColor' | 'move' | 'setPageLevel' | 'trash'>;

function writes(model: NotesModel, events: Events): Writes {
  const parentOf = (id: NodeId) => model.state.nodes.get(id)?.parentId ?? null;
  return {
    create: (input) =>
      settle(() => {
        const node = events.upserted(model.create(input));
        events.childrenChanged([node.parentId]);
        return node;
      }),
    rename: (id, title) => settle(() => events.upserted(model.rename(id, title))),
    setColor: (id, color) => settle(() => events.upserted(model.setColor(id, color))),
    move: (ids, placement) =>
      settle(() => {
        const sources = ids.map(parentOf);
        model.move(ids, placement);
        events.childrenChanged([...sources, placement.parentId]);
      }),
    setPageLevel: (ids, level) =>
      settle(() => {
        model.setPageLevel(ids, level);
        events.childrenChanged(ids.map(parentOf));
      }),
    trash: (ids) =>
      settle(() => {
        const sources = ids.map(parentOf);
        const receipt = model.trash(ids);
        events.emit({ type: 'removed', ids: receipt.nodeIds });
        events.childrenChanged(sources);
        return receipt;
      }),
  };
}

export function createModelService(options: ModelOptions = {}): ModelService {
  const model = new NotesModel(options);
  const events = new Events();
  const restored = (nodes: NodeSummary[]) => {
    events.childrenChanged(events.upserted(nodes).map((node) => node.parentId));
    return nodes;
  };
  return {
    contractVersion: 1,
    model,
    loadInitial: (path) => settle(() => model.loadInitial(path)),
    listNotebooks: () => settle(() => model.listNotebooks()),
    listChildren: (parentId) => settle(() => model.listChildren(parentId)),
    get: (id) => settle(() => model.get(id)),
    ...writes(model, events),
    restore: (receiptId) => settle(() => restored(model.restore(receiptId))),
    listTrash: () => settle(() => model.listTrash()),
    restoreFromTrash: (ids) => settle(() => restored(model.restoreFromTrash(ids))),
    saveStatus: () => 'saved',
    hasUnsavedChanges: () => false,
    flush: () => Promise.resolve(),
    watch(listener) {
      events.listeners.add(listener);
      return () => void events.listeners.delete(listener);
    },
  };
}
