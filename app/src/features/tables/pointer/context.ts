// What the pieces of the pointer layer share: the editor, the table's host, the geometry of the table on screen, the
// layer's elements, and whether the last pointer was a finger.
import type { EditorView } from '@tiptap/pm/view';
import type { TableExtraHost } from '../../page';
import type { Geometry } from './geometry';

export interface Elements {
  layer: HTMLElement;
  fill: HTMLElement;
  start: HTMLElement;
  end: HTMLElement;
  preview: HTMLElement;
}

export interface PointerContext {
  view: EditorView;
  host: TableExtraHost;
  scroller: HTMLElement;
  doc: Document;
  geo: Geometry;
  els: Elements;
  /** Whether the last pointer was a finger: the selection handles show and the hit areas grow. */
  touch: boolean;
  /** Puts the handles where the selection is. */
  place(): void;
}

/** A piece of the layer: it listens on attach, and returns the function that stops. */
export type Piece = (ctx: PointerContext) => () => void;
