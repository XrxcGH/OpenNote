// What the ink view needs from the page view. Phase 4's seams live in features/page, which other features may not
// import, so features/page/registrations/ink.ts hands them over when it installs the ink view. The types here are the
// parts the ink view uses, so the page view's real objects fit them as they are.
import type { BlockJson, EditBatch, OpenPage, TxnAck } from '../../../services/pages/types';
import type { InkRecognition, InkStroke as IntelStroke, TidyOperation, TidyPlan } from '../../../services/intel';
import type { Sheets } from '../space';

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

/** Typed text under the pen: where a point falls, the words around it, and the edits the pen can ask for. */
export interface TextEditing {
  /** The text block under a client point, with the editor position there. */
  hit(clientX: number, clientY: number): Promise<{ block: string; pos: number; top: number; bottom: number } | null>;
  /** The whole words between two positions of one paragraph, with the space that goes with them. */
  words(block: string, a: number, b: number): Promise<{ from: number; to: number; text: string } | null>;
  remove(block: string, from: number, to: number): Promise<boolean>;
  insert(block: string, pos: number, text: string): Promise<boolean>;
  split(block: string, pos: number): Promise<boolean>;
  select(block: string, from: number, to: number): Promise<boolean>;
  /** Undoes the last text edit of a block. */
  undo(block: string): Promise<void>;
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
  /** Reading and tidying handwriting through the on-device recognizer. Absent when the page has none to offer. */
  handwriting?: {
    /** Null when the person said not now, or reading failed. */
    recognize(strokes: IntelStroke[]): Promise<InkRecognition | null>;
    tidy(strokes: IntelStroke[], recognition: InkRecognition, operation: TidyOperation): Promise<TidyPlan | null>;
  };
  /** Editing the typed text where the pen is. Absent when the page has no text editor to offer. */
  text?: TextEditing;
  /** The page's recordings, so replay can play the sound along. Absent when the page has none to offer. */
  audio?: {
    /** Plays the recording from the moment the first of these strokes was written. False when there is none. */
    playFrom(ids: readonly string[]): Promise<boolean>;
    pause(): void;
    setSpeed?(speed: number): void;
  };
  /** The sheets of a paginated page, so pushed content lands on the next sheet. Absent in the flow and freeform views. */
  sheets?(): Sheets | null;
}
