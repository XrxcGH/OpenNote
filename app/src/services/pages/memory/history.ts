// Undo and redo in memory (owner: WP2), with Phase 3's grouping rules (crates/core/src/ops/undo/group.rs). Each
// client has its own stacks. A step remembers the blocks and page fields it changed, before and after, so undoing
// it puts back only those, and fails when another client has changed them since, as the core's checks do.
import type { AppliedFrame, AssetId, AssetJson, BlockId, BlockJson, CoalesceKind, EditBatch, PageJson } from '../types';
import { sortBlocks } from './apply';
import type { ByteSplice } from './apply';

/** Typing joins a step only this soon after its last edit. */
export const TYPING_GAP = 1000;
/** A typing step is closed once it is this old. */
export const TYPING_SPAN = 10_000;
/** A typing step is closed once it holds this many inserted and deleted characters. */
export const TYPING_CHARS = 100;
/** A slider joins a step only this soon after its last change. */
export const SLIDER_GAP = 1000;

/** What a batch did, as the stacks need to know it. */
export interface Applied {
  batch: EditBatch;
  /** The text splices it made, by block, in order. */
  splices: readonly { block: BlockId; splice: ByteSplice }[];
}

export interface Step {
  before: PageJson;
  after: PageJson;
  coalesce: { kind: CoalesceKind; target: string } | null;
  ui: EditBatch['ui'] | null;
  applied: Applied[];
  first: number;
  last: number;
}

export interface UndoStacks {
  record(before: PageJson, after: PageJson, applied: Applied, now: number): void;
  /** Pushes a step that never joins another, such as restoring blocks from a version. */
  push(before: PageJson, after: PageJson, now: number): void;
  peekUndo(): Step | null;
  peekRedo(): Step | null;
  undo(): Step | null;
  redo(): Step | null;
  /** Drops the top step, after a failed check, as the core does. */
  dropUndo(): void;
  dropRedo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

/** What a typing batch types into, or null when it holds anything that isn't typing. */
type Typing =
  { kind: 'text'; block: BlockId; splice: ByteSplice } | { kind: 'block'; block: BlockId } | { kind: 'page' };

function typingShape(applied: Applied): Typing | null {
  let texts = 0;
  const patched: BlockId[] = [];
  let page = false;
  for (const edit of applied.batch.edits) {
    if (edit.edit === 'setText' || edit.edit === 'spliceText') texts++;
    else if (edit.edit === 'patchBlock') patched.push(edit.block);
    else if (edit.edit === 'setPage') page = true;
    else if (edit.edit !== 'moveBlock') return null;
  }
  if (texts > 1) return null;
  if (texts === 1) {
    const text = applied.splices.at(0);
    if (!text || page) return null;
    const block = text.block;
    return patched.every((id) => id === block) ? { kind: 'text', block, splice: text.splice } : null;
  }
  if (page && patched.length === 0) return { kind: 'page' };
  if (!page && patched.length > 0 && patched.every((id) => id === patched[0]))
    return { kind: 'block', block: patched[0] };
  return null;
}

const bytes = (text: string) => new TextEncoder().encode(text).length;
const chars = (text: string) => [...text].length;

function typedChars(step: Step): number {
  return step.applied
    .flatMap((applied) => applied.splices)
    .reduce((sum, { splice }) => sum + chars(splice.ins) + chars(splice.del), 0);
}

function continuesTyping(step: Step, applied: Applied): boolean {
  const shape = typingShape(applied);
  if (!shape) return false;
  const edits = step.applied.flatMap((a) => a.batch.edits);
  if (shape.kind === 'page') return edits.some((edit) => edit.edit === 'setPage');
  if (shape.kind === 'block') return edits.some((edit) => edit.edit === 'patchBlock' && edit.block === shape.block);
  const last = step.applied
    .flatMap((a) => a.splices)
    .filter((s) => s.block === shape.block)
    .at(-1)?.splice;
  if (!last) return false;
  const kind = (s: ByteSplice) => (s.del === '' ? 'insert' : s.ins === '' ? 'delete' : 'replace');
  const next = shape.splice;
  if (kind(last) === 'insert' && kind(next) === 'insert') return next.at === last.at + bytes(last.ins);
  if (kind(last) === 'delete' && kind(next) === 'delete')
    return next.at + bytes(next.del) === last.at || next.at === last.at;
  return false;
}

function joins(top: Step, applied: Applied, now: number): boolean {
  const key = applied.batch.coalesce;
  if (!key || !top.coalesce || key.kind !== top.coalesce.kind || key.target !== top.coalesce.target) return false;
  const sinceLast = now - top.last;
  switch (key.kind) {
    case 'typing':
      return (
        sinceLast < TYPING_GAP &&
        now - top.first < TYPING_SPAN &&
        typedChars(top) < TYPING_CHARS &&
        continuesTyping(top, applied)
      );
    case 'slider':
      return sinceLast < SLIDER_GAP;
    default:
      return true;
  }
}

export function createUndoStacks(): UndoStacks {
  const done: Step[] = [];
  const undone: Step[] = [];
  return {
    record(before, after, applied, now) {
      undone.length = 0;
      const top = done.at(-1);
      if (top && joins(top, applied, now)) {
        top.after = after;
        top.last = now;
        top.applied.push(applied);
        top.ui = top.ui && applied.batch.ui ? { before: top.ui.before, after: applied.batch.ui.after } : top.ui;
        return;
      }
      const { coalesce, ui } = applied.batch;
      done.push({
        before,
        after,
        coalesce: coalesce ?? null,
        ui: ui ?? null,
        applied: [applied],
        first: now,
        last: now,
      });
    },
    push(before, after, now) {
      undone.length = 0;
      done.push({ before, after, coalesce: null, ui: null, applied: [], first: now, last: now });
    },
    peekUndo: () => done.at(-1) ?? null,
    peekRedo: () => undone.at(-1) ?? null,
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
    dropUndo: () => void done.pop(),
    dropRedo: () => void undone.pop(),
    canUndo: () => done.length > 0,
    canRedo: () => undone.length > 0,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The blocks that differ between two pages, and whether the page fields do. */
function changes(from: PageJson, to: PageJson): { blocks: BlockId[]; fields: boolean; assets: AssetId[] } {
  const a = new Map(from.blocks.map((block) => [block.id, block]));
  const b = new Map(to.blocks.map((block) => [block.id, block]));
  const blocks = [...new Set([...a.keys(), ...b.keys()])].filter((id) => !same(a.get(id), b.get(id)));
  const fields = from.title !== to.title || !same(from.view, to.view) || !same(from.tags, to.tags);
  const assets = [...new Set([...Object.keys(from.assets), ...Object.keys(to.assets)])].filter(
    (id) => !same(from.assets[id], to.assets[id]),
  );
  return { blocks, fields, assets };
}

/**
 * Takes `current` from `from` back (or forward) to `to`, touching only what differs between those two. Returns
 * null when another client changed any of it since, which is the core's failed check.
 */
export function revert(current: PageJson, from: PageJson, to: PageJson): PageJson | null {
  const diff = changes(from, to);
  const now = new Map(current.blocks.map((block) => [block.id, block]));
  const was = new Map(from.blocks.map((block) => [block.id, block]));
  const will = new Map(to.blocks.map((block) => [block.id, block]));
  if (diff.blocks.some((id) => !same(now.get(id), was.get(id)))) return null;
  if (
    diff.fields &&
    (current.title !== from.title || !same(current.view, from.view) || !same(current.tags, from.tags))
  ) {
    return null;
  }
  const next = structuredClone(current);
  next.blocks = next.blocks.filter((block) => !diff.blocks.includes(block.id));
  for (const id of diff.blocks) {
    const block = will.get(id);
    if (block) next.blocks.push(structuredClone(block));
  }
  sortBlocks(next);
  if (diff.fields) {
    next.title = to.title;
    next.view = structuredClone(to.view);
    next.tags = [...to.tags];
  }
  for (const id of diff.assets) {
    if (to.assets[id]) next.assets[id] = structuredClone(to.assets[id]);
    else delete next.assets[id];
  }
  return next;
}

/** What changed from `from` to `to`, as a frame with every changed block in full (P3-5). */
export function diffFrame(
  from: PageJson,
  to: PageJson,
  ui: AppliedFrame['ui'],
  state: { canUndo: boolean; canRedo: boolean },
): AppliedFrame {
  const diff = changes(from, to);
  const blocks: BlockJson[] = to.blocks.filter((block) => diff.blocks.includes(block.id));
  const kept = new Set(to.blocks.map((block) => block.id));
  const removed = from.blocks.filter((block) => !kept.has(block.id)).map((block) => block.id);
  const assets: Record<AssetId, AssetJson | null> = {};
  for (const id of diff.assets) assets[id] = to.assets[id] ?? null;
  return {
    blocks: structuredClone(blocks),
    removed,
    page: diff.fields ? { title: to.title, view: structuredClone(to.view), tags: [...to.tags] } : null,
    assets,
    ui,
    ...state,
  };
}
