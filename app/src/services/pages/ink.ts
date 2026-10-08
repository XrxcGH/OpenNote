// The ink part of the page service (Phase 5; owner: the ink lane). Strokes travel as ink records in the segment
// record format (format spec 9.2), the same bytes the page envelope and the core's frames carry, so neither side
// converts them. New strokes ride in an EditBatch's `strokes`, which the adapters send with page_add_strokes after
// the batch's edits, as one transaction. Every other change to ink is an edit of page_apply.

/** A matrix `a b c d e f`, as in SVG and canvas. */
export type StrokeMatrix = [number, number, number, number, number, number];

/** The parts of a stroke style to change; a missing part stays. */
export interface StrokeStyleEdit {
  tool?: number;
  palette?: number;
  /** Red, green, blue, and alpha, 0 to 255. */
  color?: [number, number, number, number];
  /** Page units. */
  width?: number;
}

/** The core's stroke edits (crates/core/src/ops/resolve.rs). */
export type StrokeEdit =
  | { edit: 'removeStrokes'; strokes: string[] }
  | { edit: 'transformStrokes'; strokes: string[]; matrix: StrokeMatrix }
  | { edit: 'restyleStrokes'; strokes: string[]; style: StrokeStyleEdit }
  | { edit: 'moveStrokesToBlock'; strokes: string[]; block: string };

/** What an undo, a redo, or another window's change did to the ink. */
export interface InkChanges {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
  /** The added and changed strokes as they are now, as ink records. */
  readonly records: Uint8Array;
}

/** The ink of an open page. */
export interface PageInk {
  /** The live strokes the page opened with, as ink records. */
  readonly records: Uint8Array;
  /** True when the page has more strokes than `records` holds; `readAll` brings them. */
  readonly more: boolean;
  /** Every live stroke, as ink records. */
  readAll(): Promise<Uint8Array>;
  /** Hears the ink part of every undo, redo, and change from another window. */
  onChange(listener: (changes: InkChanges) => void): () => void;
}

export const NO_INK_CHANGES: InkChanges = { added: [], removed: [], changed: [], records: new Uint8Array(0) };

/** Whether a change touched any stroke. */
export function hasInkChanges(changes: InkChanges | undefined): changes is InkChanges {
  return !!changes && changes.added.length + changes.removed.length + changes.changed.length > 0;
}

/** Hears listeners and tells them, for the adapters. */
export function inkListeners() {
  const set = new Set<(changes: InkChanges) => void>();
  return {
    emit(changes: InkChanges | undefined) {
      if (hasInkChanges(changes)) set.forEach((listener) => listener(changes));
    },
    add(listener: (changes: InkChanges) => void) {
      set.add(listener);
      return () => void set.delete(listener);
    },
  };
}
