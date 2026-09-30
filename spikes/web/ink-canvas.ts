// Renderers for the ink spike. Each draws strokes on one full-window canvas in CSS pixels.
import {
  INK_COLOR,
  PAPER_COLOR,
  newPiece,
  overlaps,
  tailPiece,
  type Box,
  type InkPoint,
  type Piece,
} from './ink-stroke';

/** What every renderer can do. Points are in CSS pixels. */
export interface Renderer {
  /** Whether the browser granted a desynchronized (low-latency) context. */
  readonly desynchronized: boolean;
  /** Starts a stroke with a dot at `point`. */
  start(point: InkPoint): void;
  /** Adds points to the stroke and draws the new piece. */
  extend(points: readonly InkPoint[]): void;
  /** Draws a temporary tail through predicted points, replacing the previous tail. */
  preview(points: readonly InkPoint[]): void;
  /** Removes the temporary tail, for example when the pen lifts. */
  settle(): void;
  /** Clears the page. */
  clear(): void;
  /** Matches the canvas to the window size and redraws what it can. */
  resize(): void;
}

/** Sizes the canvas backing store to the window in device pixels. */
export function fitCanvas(canvas: HTMLCanvasElement): number {
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * scale);
  canvas.height = Math.round(window.innerHeight * scale);
  return scale;
}

/** A 2D canvas renderer. With `desynchronized`, the browser may skip the compositor's frame queue. */
export class CanvasRenderer implements Renderer {
  readonly desynchronized: boolean;
  private readonly context: CanvasRenderingContext2D;
  private stroke: InkPoint[] = [];
  /** Every committed piece, kept to repaint the area under a temporary tail. */
  private pieces: Piece[] = [];
  private tail: Box | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    desynchronized: boolean,
  ) {
    const options: CanvasRenderingContext2DSettings = desynchronized ? { desynchronized: true, alpha: false } : {};
    const context = canvas.getContext('2d', options);
    if (!context) throw new Error('This browser has no 2D canvas.');
    this.context = context;
    this.desynchronized = context.getContextAttributes().desynchronized === true;
    this.resize();
  }

  start(point: InkPoint): void {
    this.settle();
    this.stroke = [point];
    this.commit(newPiece(this.stroke, 1));
  }

  extend(points: readonly InkPoint[]): void {
    if (points.length === 0) return;
    this.settle();
    this.stroke.push(...points);
    this.commit(newPiece(this.stroke, points.length));
  }

  preview(points: readonly InkPoint[]): void {
    this.settle();
    const piece = tailPiece(this.stroke, points);
    if (!piece) return;
    this.context.fillStyle = INK_COLOR;
    this.context.fill(piece.path);
    this.tail = piece.box;
  }

  settle(): void {
    if (!this.tail) return;
    const box = this.tail;
    this.tail = null;
    this.repaint({ left: box.left - 2, top: box.top - 2, right: box.right + 2, bottom: box.bottom + 2 });
  }

  clear(): void {
    this.stroke = [];
    this.pieces = [];
    this.tail = null;
    this.context.fillStyle = PAPER_COLOR;
    this.context.fillRect(0, 0, window.innerWidth, window.innerHeight);
  }

  resize(): void {
    const scale = fitCanvas(this.canvas);
    this.context.setTransform(scale, 0, 0, scale, 0, 0);
    this.tail = null;
    this.repaint({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight });
  }

  private commit(piece: Piece | null): void {
    if (!piece) return;
    this.context.fillStyle = INK_COLOR;
    this.context.fill(piece.path);
    this.pieces.push(piece);
  }

  /** Paints paper over `box`, then the committed pieces that cross it. */
  private repaint(box: Box): void {
    const { context } = this;
    context.save();
    context.beginPath();
    context.rect(box.left, box.top, box.right - box.left, box.bottom - box.top);
    context.clip();
    context.fillStyle = PAPER_COLOR;
    context.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
    context.fillStyle = INK_COLOR;
    for (const piece of this.pieces) {
      if (overlaps(piece.box, box)) context.fill(piece.path);
    }
    context.restore();
  }
}
