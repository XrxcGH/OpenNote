// Erase gestures (architecture 8.3 and 8.4). A gesture lasts from pen-down to pen-up and sends its hit tests as the
// pen moves. The session keeps what the gesture has done so far and shows it at once. It gives the core one
// transaction at the end, and interim ones every 500 ms for a long pen gesture. It never changes the stroke index. The
// engine does that when the transaction lands. A touch gesture sends no interim transaction: its final `commit` waits
// for the palm filter's Commit effect, and a Retract or a `pointercancel` calls `cancel` to put the picture back.

import { intersects, strokeBounds } from '../geometry/bounds';
import { capsulesAlong } from '../geometry/erase';
import { capsuleBounds, hitCapsules } from '../geometry/hitTest';
import { splitStroke } from '../geometry/partialErase';
import type { StrokeIndex } from '../geometry/strokeIndex';
import type { Capsule, Stroke, Vec } from '../geometry/types';

export interface EraseOptions {
  /** Strokes this returns true for are left alone: locked blocks, and strokes the eraser filter excludes. */
  readonly skip?: (stroke: Stroke) => boolean;
}

/** The chain of capsules for new samples, continuing from the last sample of the call before. */
function chain(last: Vec | null, samples: readonly Vec[], radius: number): Capsule[] {
  if (samples.length === 0) return [];
  return capsulesAlong(last ? [last, ...samples] : samples, radius);
}

export interface StrokeEraseSession {
  /** Adds eraser samples. Returns the ids of strokes that vanish because of them. */
  move(samples: readonly Vec[], radius: number): string[];
  /** The ids the eraser would remove at a hover point, for the outline that shows what will go. */
  preview(point: Vec, radius: number): string[];
  /** Every id erased so far. */
  erased(): ReadonlySet<string>;
  /** The ids to remove in a transaction. An interim call and the final call give only what is new since the last. */
  commit(): string[];
  /** Abandons the gesture: what the picture must show again, since no transaction took it. The session resets. */
  cancel(): EraseRollback;
}

/** What to put back in the picture when a gesture is abandoned: parts it made to hide, and core strokes to show. */
export interface EraseRollback {
  readonly hide: string[];
  readonly show: string[];
}

export function createStrokeEraseSession(index: StrokeIndex, options: EraseOptions = {}): StrokeEraseSession {
  const erased = new Set<string>();
  let committed = 0;
  let last: Vec | null = null;
  const skip = (stroke: Stroke) => erased.has(stroke.id) || (options.skip?.(stroke) ?? false);

  return {
    move(samples, radius) {
      const capsules = chain(last, samples, radius);
      if (samples.length > 0) last = samples[samples.length - 1];
      const fresh: string[] = [];
      for (const stroke of hitCapsules(index, capsules)) {
        if (skip(stroke)) continue;
        erased.add(stroke.id);
        fresh.push(stroke.id);
      }
      return fresh;
    },
    preview(point, radius) {
      return hitCapsules(index, capsulesAlong([point], radius))
        .filter((stroke) => !skip(stroke))
        .map((stroke) => stroke.id);
    },
    erased: () => erased,
    commit() {
      const all = [...erased];
      const fresh = all.slice(committed);
      committed = all.length;
      return fresh;
    },
    cancel() {
      const show = [...erased].slice(committed);
      for (const id of show) erased.delete(id);
      last = null;
      return { hide: [], show };
    },
  };
}

/** What a move changed in the picture: strokes that vanished from view, and strokes that appeared. */
export interface ViewChange<S extends Stroke> {
  readonly removed: string[];
  readonly added: S[];
}

/** What a transaction sends: strokes that existed before and are gone, and the strokes that replace them. */
export interface EraseTransaction<S extends Stroke> {
  readonly removed: string[];
  readonly added: S[];
}

export interface PartialEraseSession<S extends Stroke> {
  /** Adds eraser samples. Returns what changed in the picture. */
  move(samples: readonly Vec[], radius: number): ViewChange<S>;
  /** The strokes the gesture made that are still visible. */
  parts(): S[];
  /** True when the stroke is no longer visible: erased, or replaced by its parts. */
  isGone(id: string): boolean;
  /** An interim transaction. Parts it adds count as ordinary strokes afterward, so cutting them removes them. */
  checkpoint(): EraseTransaction<S>;
  /** The final transaction. */
  commit(): EraseTransaction<S>;
  /** Abandons the gesture: parts that never reached the core to hide, and core strokes to show again. */
  cancel(): EraseRollback;
}

/**
 * A partial erase gesture. A stroke can be cut many times, and its parts can be cut again. Parts that never reached the
 * core are left out of the transaction, and a part's `origin` is the nearest stroke that exists in the core.
 */
export function createPartialEraseSession<S extends Stroke>(
  index: StrokeIndex,
  newId: () => string,
  options: EraseOptions = {},
): PartialEraseSession<S> {
  // Strokes that exist in the core and are hidden now, and the share of them an interim transaction already sent.
  const gone = new Set<string>();
  const sent = new Set<string>();
  // Parts made since the last transaction, parts cut again before any transaction, and every part still visible.
  const fresh = new Set<string>();
  const phantoms = new Set<string>();
  const extra = new Map<string, S>();
  // The nearest stroke the core has, for each fresh part: what its `origin` names.
  const anchor = new Map<string, string>();
  let last: Vec | null = null;

  const candidates = (capsules: readonly Capsule[]): S[] => {
    const found = hitCapsules(index, capsules) as S[];
    const reach = capsules.map(capsuleBounds);
    for (const part of extra.values()) {
      if (reach.some((box) => intersects(box, strokeBounds(part)))) found.push(part);
    }
    return found.filter((stroke) => !gone.has(stroke.id) && !(options.skip?.(stroke) ?? false));
  };

  function cut(stroke: S, capsules: readonly Capsule[], change: ViewChange<S>): void {
    const pieces = splitStroke(stroke, capsules, newId);
    if (!pieces) return;
    const base = fresh.has(stroke.id) ? anchor.get(stroke.id)! : stroke.id;
    if (fresh.delete(stroke.id)) phantoms.add(stroke.id);
    else gone.add(stroke.id);
    extra.delete(stroke.id);
    change.removed.push(stroke.id);
    for (const piece of pieces) {
      const part = { ...piece, origin: base } as S;
      extra.set(part.id, part);
      fresh.add(part.id);
      anchor.set(part.id, base);
      change.added.push(part);
    }
  }

  function transaction(): EraseTransaction<S> {
    const removed = [...gone].filter((id) => !sent.has(id));
    removed.forEach((id) => sent.add(id));
    const added = [...fresh].map((id) => extra.get(id)!);
    fresh.clear();
    return { removed, added };
  }

  return {
    move(samples, radius) {
      const capsules = chain(last, samples, radius);
      if (samples.length > 0) last = samples[samples.length - 1];
      const change: ViewChange<S> = { removed: [], added: [] };
      for (const stroke of candidates(capsules)) cut(stroke, capsules, change);
      return change;
    },
    parts: () => [...extra.values()],
    isGone: (id) => gone.has(id) || phantoms.has(id),
    checkpoint: transaction,
    commit: transaction,
    cancel() {
      const hide = [...fresh];
      const show = [...gone].filter((id) => !sent.has(id));
      for (const id of hide) extra.delete(id);
      for (const id of show) gone.delete(id);
      fresh.clear();
      phantoms.clear();
      last = null;
      return { hide, show };
    },
  };
}
