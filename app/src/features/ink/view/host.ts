// What the ink view needs from the page view. Phase 4's seams live in features/page, which other features may not
// import, so features/page/registrations/ink.ts hands them over when it installs the ink view. The types here are the
// parts the ink view uses, so the page view's real objects fit them as they are.
import type { BlockJson, EditBatch, OpenPage, TxnAck } from '../../../services/pages/types';

export interface InkCamera {
  readonly zoom: number;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly dpr: number;
  /** The viewport's client rectangle, CSS px. */
  readonly viewport: { x: number; y: number; w: number; h: number };
  readonly gesture: string | null;
  readonly seq: number;
}

export interface InkViewport {
  /** The scroller. */
  readonly viewport: HTMLElement;
  /** The page, in page units, scaled by the zoom. */
  readonly world: HTMLElement;
  camera(): InkCamera;
  onCamera(listener: (camera: InkCamera) => void): () => void;
  toWorld(clientX: number, clientY: number): { x: number; y: number };
  holdCamera(reason: string): () => void;
  setZoom(zoom: number, focus?: { x: number; y: number }): void;
}

export interface InkRouterContext {
  readonly camera: InkCamera;
  readonly activeTool: string;
  toWorld(clientX: number, clientY: number): { x: number; y: number };
  capture(pointerId: number): void;
}

export interface InkPointerTool {
  readonly id: string;
  readonly priority: number;
  accepts(event: PointerEvent, ctx: InkRouterContext): boolean;
  down(event: PointerEvent, ctx: InkRouterContext): 'claim' | 'watch';
  move?(events: readonly PointerEvent[], ctx: InkRouterContext): 'claim' | 'watch' | 'release';
  up?(event: PointerEvent, ctx: InkRouterContext): void;
  cancel?(ctx: InkRouterContext): void;
}

export interface InkQueue {
  send(batch: EditBatch): Promise<TxnAck>;
  undo(): Promise<void>;
  redo(): Promise<void>;
}

export interface InkBlockLayer {
  blocks(): readonly BlockJson[];
  block(id: string): BlockJson | null;
  upsert(block: BlockJson): void;
  view(id: string): { readonly element: HTMLElement; measure(): { x: number; y: number; w: number; h: number } } | null;
}

export interface InkSelection {
  readonly blocks: readonly string[];
  readonly strokes: readonly string[];
}

/** A store the ink view reads and follows, but never sets. */
export interface Watched<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}

/** The page view's seams, as features/page/registrations/ink.ts passes them. */
export interface InkHost {
  registerPointerTool(def: InkPointerTool): () => void;
  setActiveTool(id: string): void;
  readonly viewport: Watched<InkViewport | null>;
  readonly queue: Watched<InkQueue | null>;
  readonly page: Watched<OpenPage | null>;
  readonly layer: Watched<InkBlockLayer | null>;
  readonly selection: Watched<InkSelection>;
  select(next: InkSelection, options?: { announce?: boolean }): void;
  /** Runs one of Phase 4's object commands on the selected blocks. */
  objectCommand(command: 'delete'): void;
}
