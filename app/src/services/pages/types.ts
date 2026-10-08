// The page service contract (ARCHITECTURE.md section 10.1; PLAN.md section 3.5, owned by WP0). The page view edits a
// page only through an OpenPage: the memory implementation serves the web platform and tests, and the Tauri adapter
// maps each call onto Phase 3's core commands. WP2 owns everything in this folder except this file.

import type { InkChanges, PageInk, StrokeEdit } from './ink';

export type PageId = string;
export type BlockId = string;
export type AssetId = string;
export type Unsubscribe = () => void;

/** A rectangle in page units. */
export interface PageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Frame {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rotate?: number;
}
export type BlockLock = 'position' | 'all';

export interface BlockJson {
  id: BlockId;
  type: string;
  order: string;
  frame?: Frame;
  lock?: BlockLock;
  created: string;
  modified: string;
  data: Record<string, unknown>;
  fallback?: { markdown: string; image?: AssetId };
}
export interface NewBlock {
  id: BlockId;
  type: string;
  frame?: Frame;
  lock?: BlockLock;
  data: Record<string, unknown>;
}
export interface PageViewJson {
  layout?: 'freeform' | 'flow';
  contentWidth?: number;
  readingOrder?: BlockId[];
  [key: string]: unknown;
}
export interface AssetJson {
  file: string;
  mime: string;
  bytes: number;
  sha256: string;
  name: string;
  width?: number;
  height?: number;
  created: string;
}
export interface ImportedAsset {
  id: AssetId;
  asset: AssetJson;
}
export interface PageJson {
  id: PageId;
  title: string;
  created: string;
  modified: string;
  tags: string[];
  view: PageViewJson;
  blocks: BlockJson[];
  assets: Record<AssetId, AssetJson>;
  /** Ink, recordings, and the revision: kept, unused by Phase 4. */
  [key: string]: unknown;
}
/** An RFC 7396 merge patch. */
export type JsonPatch = Record<string, unknown>;

export type Edit =
  /** `at` is an offset in UTF-8 bytes (P3-10). */
  | { edit: 'spliceText'; block: BlockId; at: number; del: string; ins: string }
  | { edit: 'setText'; block: BlockId; markdown: string }
  | { edit: 'insertBlock'; block: NewBlock; after?: BlockId; before?: BlockId }
  | { edit: 'moveBlock'; block: BlockId; frame?: Frame | null; after?: BlockId; before?: BlockId }
  | { edit: 'patchBlock'; block: BlockId; lock?: BlockLock | null; data?: JsonPatch; fallback?: unknown }
  | { edit: 'deleteBlocks'; blocks: BlockId[] }
  | { edit: 'setPage'; title?: string; tags?: string[]; view?: JsonPatch }
  | { edit: 'addAsset'; asset: AssetId }
  | { edit: 'removeAsset'; asset: AssetId }
  /** Phase 5's stroke edits (ink.ts). */
  | StrokeEdit;

export type UiSelection =
  /** ProseMirror positions in that block. */
  | { kind: 'text'; block: BlockId; anchor: number; head: number }
  | { kind: 'objects'; blocks: BlockId[] }
  | { kind: 'title'; anchor: number; head: number };

export type CoalesceKind = 'typing' | 'drag' | 'resize' | 'slider' | 'erase';

export interface EditBatch {
  edits: Edit[];
  coalesce?: { kind: CoalesceKind; target: string };
  ui?: { before: UiSelection; after: UiSelection };
  /** Phase 5: new strokes as ink records, added after `edits` in the same transaction (page_add_strokes). */
  strokes?: Uint8Array;
}

export interface TxnAck {
  seq: number;
  orderKeys: Record<BlockId, string>;
  canUndo: boolean;
  canRedo: boolean;
}

/** An undo, redo, or another window's change, with every changed block in full (P3-5). */
export interface AppliedFrame {
  readonly blocks: readonly BlockJson[];
  readonly removed: readonly BlockId[];
  readonly page: { title?: string; view?: PageViewJson; tags?: string[] } | null;
  readonly assets: Readonly<Record<AssetId, AssetJson | null>>;
  readonly ui: { before: UiSelection; after: UiSelection } | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Phase 5: what the step did to the ink, which PageInk.onChange also hears. */
  readonly ink?: InkChanges;
}

export interface ReadOnlyInfo {
  reason: string;
  action: 'makeEditable' | 'repairInk' | null;
}
export interface ExternalChange {
  action: 'reloaded' | 'conflict' | 'suspectOverwrite';
}
export interface VersionInfo {
  revision: string;
  savedAt: string;
  reason: string;
  device: string;
  name: string | null;
  keep: boolean;
}
export interface RestoreResult {
  page: PageId;
  asCopy: boolean;
}
export interface PageHistory {
  list(): Promise<VersionInfo[]>;
  open(revision: string): Promise<PageJson>;
  restore(revision: string, asCopy: boolean): Promise<RestoreResult>;
  restoreBlocks(revision: string, blocks: readonly BlockId[]): Promise<AppliedFrame>;
  name(revision: string, name: string | null, keep: boolean): Promise<void>;
}
export type HistoryScope = { kind: 'page' | 'section' | 'notebook'; id: string };
export interface HistoryAdmin {
  deleteHistory(notebook: string, scope: HistoryScope, keepNamed: boolean): Promise<void>;
}

export type ImageSource =
  | { kind: 'bytes'; bytes: ArrayBuffer; name: string; mime: string }
  | { kind: 'url'; url: string }
  | { kind: 'clipToken'; token: string };

export interface OpenPage {
  readonly id: PageId;
  /** One client per window, such as "main-1". */
  readonly client: string;
  /** Parsed from the envelope; ink goes to Phase 5. */
  readonly initial: PageJson;
  readonly readOnly: ReadOnlyInfo | null;
  /** Whether the core takes `spliceText` (P3-10). */
  readonly supportsSplice: boolean;
  /** Phase 5: the page's strokes; absent where the service keeps no ink. */
  readonly ink?: PageInk;
  /** page_apply through the ordered queue, one request in flight. */
  send(batch: EditBatch): Promise<TxnAck>;
  undo(): Promise<AppliedFrame | null>;
  redo(): Promise<AppliedFrame | null>;
  saveNow(): Promise<void>;
  /** The asset and its ID, which the image block names (PLAN.md says AssetJson; see WP0-NOTES.md). */
  importImage(source: ImageSource, signal?: AbortSignal): Promise<ImportedAsset>;
  /** Where the image loads from: `http://opennote-asset.localhost/<page>/<asset>` in the Windows app, as WebView2
   * routes the opennote-asset scheme (images/protocol.rs), with each ID encoded as one path segment. */
  assetUrl(asset: AssetId): string;
  readonly history: PageHistory;
  onFrame(listener: (frame: AppliedFrame) => void): Unsubscribe;
  onExternal(listener: (change: ExternalChange) => void): Unsubscribe;
  onReadOnly(listener: (info: ReadOnlyInfo | null) => void): Unsubscribe;
  /** page_close, after flushing. */
  close(): Promise<void>;
}

export interface PageService {
  open(pageId: PageId, options: { viewport: PageRect | null }): Promise<OpenPage>;
}

export type PageErrorCode =
  | 'precondition'
  | 'outOfOrder'
  | 'readOnly'
  | 'locked'
  | 'invalid'
  | 'notFound'
  | 'unsupportedType'
  | 'tooLarge'
  | 'downloadFailed'
  | 'staleToken'
  | 'notImplemented';

/** `resync` says the page is out of date, so the view reopens it and remounts its editors. */
export class PageServiceError extends Error {
  readonly code: PageErrorCode;
  readonly resync: boolean;

  constructor(code: PageErrorCode, message: string, resync = code === 'precondition' || code === 'outOfOrder') {
    super(message);
    this.name = 'PageServiceError';
    this.code = code;
    this.resync = resync;
  }
}
