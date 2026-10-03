// Undo and redo in memory (owner after WP0: WP2): a stack of page snapshots per client, with Phase 3's typing rule
// (core plan 7.3). Typing in one block joins the step before it when it comes within 1 second and the step is
// under 10 seconds old. Frames carry every block that differs, in full, as P3-5 asks.
import type { AppliedFrame, AssetId, AssetJson, BlockJson, EditBatch, PageJson } from '../types';

const JOIN_MS = 1000;
const GROUP_MS = 10_000;

interface Step {
  before: PageJson;
  after: PageJson;
  batch: EditBatch;
  started: number;
  last: number;
}

export interface UndoStacks {
  record(before: PageJson, after: PageJson, batch: EditBatch, now: number): void;
  undo(): Step | null;
  redo(): Step | null;
  canUndo(): boolean;
  canRedo(): boolean;
}

export function createUndoStacks(): UndoStacks {
  const done: Step[] = [];
  const undone: Step[] = [];
  return {
    record(before, after, batch, now) {
      undone.length = 0;
      const top = done.at(-1);
      const joins =
        top &&
        batch.coalesce?.kind === 'typing' &&
        top.batch.coalesce?.kind === 'typing' &&
        top.batch.coalesce.target === batch.coalesce.target &&
        now - top.last < JOIN_MS &&
        now - top.started < GROUP_MS;
      if (top && joins) {
        top.after = after;
        top.last = now;
        top.batch = {
          ...top.batch,
          ui: top.batch.ui && batch.ui && { before: top.batch.ui.before, after: batch.ui.after },
        };
        return;
      }
      done.push({ before, after, batch, started: now, last: now });
    },
    undo() {
      const step = done.pop() ?? null;
      if (step) undone.push(step);
      return step;
    },
    redo() {
      const step = undone.pop() ?? null;
      if (step) done.push(step);
      return step;
    },
    canUndo: () => done.length > 0,
    canRedo: () => undone.length > 0,
  };
}

/** What changed from `from` to `to`, as a frame. */
export function diffFrame(
  from: PageJson,
  to: PageJson,
  ui: AppliedFrame['ui'],
  state: { canUndo: boolean; canRedo: boolean },
): AppliedFrame {
  const old = new Map(from.blocks.map((block) => [block.id, JSON.stringify(block)]));
  const blocks: BlockJson[] = to.blocks.filter((block) => old.get(block.id) !== JSON.stringify(block));
  const kept = new Set(to.blocks.map((block) => block.id));
  const removed = from.blocks.filter((block) => !kept.has(block.id)).map((block) => block.id);
  const fieldsChanged =
    from.title !== to.title ||
    JSON.stringify(from.view) !== JSON.stringify(to.view) ||
    JSON.stringify(from.tags) !== JSON.stringify(to.tags);
  const assets: Record<AssetId, AssetJson | null> = {};
  for (const id of new Set([...Object.keys(from.assets), ...Object.keys(to.assets)])) {
    if (JSON.stringify(from.assets[id]) !== JSON.stringify(to.assets[id])) assets[id] = to.assets[id] ?? null;
  }
  return {
    blocks: structuredClone(blocks),
    removed,
    page: fieldsChanged ? { title: to.title, view: structuredClone(to.view), tags: [...to.tags] } : null,
    assets,
    ui,
    ...state,
  };
}
