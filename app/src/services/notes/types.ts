// Contract between the shell (Phase 2) and storage (Phase 3). Changes need approval from both phase owners.
//
// The notes service holds notebooks, section groups, sections, and pages. The shell's tree reads and changes
// them only through this interface, so Phase 3 can replace the in-memory service with real storage.
// ARCHITECTURE.md section 12 describes the semantics, and contract.ts tests them.

/** Opaque; stable across renames, moves, and restarts. */
export type NodeId = string & { readonly __brand: 'NodeId' };
/** Opaque. Storage may encode several Trash items in one, for example across notebooks. */
export type TrashReceiptId = string & { readonly __brand: 'TrashReceiptId' };
export type NodeKind = 'notebook' | 'sectionGroup' | 'section' | 'page';
/**
 * The pen names in brand/tokens.json, stored by name so chips follow the theme as ink does. A stored color that
 * isn't a pen name (Phase 3's format also allows hexadecimal colors) reads as null, and create and setColor store
 * any other value as null.
 */
// checks-disable-next-line brand-consistency: pen names from the tokens, not CSS colors
export type ChipColor = 'ink' | 'indigo' | 'brick' | 'fern' | 'plum' | 'amber' | 'walnut';
/** Subpage depth, as in OneNote. */
export type PageLevel = 0 | 1 | 2;
export type SaveStatus = 'saved' | 'saving' | 'offline' | 'error';

/** Every chip color, in the tokens' order, for menus and for checking stored values. */
// checks-disable-next-line brand-consistency: the same pen names as ChipColor, listed for use at run time
export const CHIP_COLORS: readonly ChipColor[] = ['ink', 'indigo', 'brick', 'fern', 'plum', 'amber', 'walnut'];

/** Limits both implementations enforce (ADR 0014). */
export const NOTES_LIMITS = {
  /** Titles set through this interface, after trimming. */
  titleLength: 200,
  /** Section groups nest at most this deep: a top-level group is at depth 1. */
  groupDepth: 4,
  /** The deepest subpage level. */
  pageLevel: 2,
} as const;

export interface NodeSummary {
  readonly id: NodeId;
  readonly kind: NodeKind;
  /** Null only for notebooks. */
  readonly parentId: NodeId | null;
  /**
   * As the person typed it (trimmed); storage maps it to file names. Titles set through this interface are 1 to
   * 200 characters, but storage may return a page title that is empty, or longer, from another tool. The shell
   * shows an empty title as "Untitled page".
   */
  readonly title: string;
  /** Notebooks, section groups, and sections; always null for pages. Only pen names, else null. */
  readonly color: ChipColor | null;
  /** Pages only; 0 for everything else. */
  readonly pageLevel: PageLevel;
  /** Containers: direct children; pages: 0. */
  readonly childCount: number;
  /** ISO 8601. */
  readonly created: string;
  /** ISO 8601. */
  readonly modified: string;
  /** For example, written by a newer app version. */
  readonly readOnly: boolean;
  /** A pinned page. Storage that keeps no pins leaves it out. */
  readonly pinned?: boolean;
  /** Hidden from the tree until Show archived. Storage that keeps no archive leaves it out. */
  readonly archived?: boolean;
}

/** Where nodes go. `beforeId: null` means at the end of the parent's children. */
export interface Placement {
  /** Null places notebooks. */
  readonly parentId: NodeId | null;
  readonly beforeId: NodeId | null;
}

export interface LibraryInfo {
  /** The notes folder, for display. */
  readonly folder: string;
  readonly readOnly: boolean;
}

export interface InitialTree {
  readonly library: LibraryInfo;
  /** In display order. */
  readonly notebooks: readonly NodeSummary[];
  /** Keyed by parent id, along the requested path. */
  readonly children: Readonly<Record<string, readonly NodeSummary[]>>;
  /** The longest prefix of the requested path that still exists. */
  readonly resolvedPath: readonly NodeId[];
  /** The requested page, if it still exists. */
  readonly page: NodeSummary | null;
}

export interface CreateInput {
  readonly kind: NodeKind;
  readonly placement: Placement;
  /** The shell passes "Untitled notebook", "Untitled section", and so on; the service has its own default. */
  readonly title?: string;
  readonly color?: ChipColor | null;
  readonly pageLevel?: PageLevel;
}

/**
 * One trash call. Each root becomes its own Trash item, and the items can sit in different notebooks, because
 * each notebook keeps its own Trash. Trashing a notebook takes it out of the library and keeps its folder.
 */
export interface TrashReceipt {
  readonly id: TrashReceiptId;
  /** The roots that were trashed, in display order; their subtrees and subpages went with them. */
  readonly nodeIds: readonly NodeId[];
}

/**
 * A trashed root. Items trashed from inside a notebook that is itself in Trash stay with that notebook: they
 * aren't listed and can't be restored until the notebook is back.
 */
export interface TrashedItem {
  /** Shared by every item one trash call made. */
  readonly receiptId: TrashReceiptId;
  /** A trashed root. Its parentId is the parent it was trashed from. */
  readonly node: NodeSummary;
  readonly trashedAt: string;
  readonly originalParentId: NodeId | null;
  readonly originalParentTitle: string;
  /** Pages inside it, including itself for a page. */
  readonly pageCount: number;
}

export type NotesEvent =
  | { readonly type: 'upserted'; readonly nodes: readonly NodeSummary[] }
  | { readonly type: 'removed'; readonly ids: readonly NodeId[] }
  /** Order or membership changed: re-list. */
  | { readonly type: 'childrenChanged'; readonly parentId: NodeId | null }
  | { readonly type: 'status'; readonly status: SaveStatus }
  /** Reload everything (folder changed, drive reconnected). */
  | { readonly type: 'reset' };

export interface NotesService {
  readonly contractVersion: 1;

  /** One call at start-up, along the saved location. */
  loadInitial(path: readonly NodeId[]): Promise<InitialTree>;
  listNotebooks(): Promise<readonly NodeSummary[]>;
  /** In display order. */
  listChildren(parentId: NodeId): Promise<readonly NodeSummary[]>;
  get(id: NodeId): Promise<NodeSummary | null>;

  create(input: CreateInput): Promise<NodeSummary>;
  rename(id: NodeId, title: string): Promise<NodeSummary>;
  setColor(id: NodeId, color: ChipColor | null): Promise<NodeSummary>;
  move(ids: readonly NodeId[], placement: Placement): Promise<void>;
  setPageLevel(ids: readonly NodeId[], level: PageLevel): Promise<void>;

  trash(ids: readonly NodeId[]): Promise<TrashReceipt>;
  /**
   * Undo of one trash call: restores the receipt's items that are still in Trash and listed, and rejects with
   * not-found when none are.
   */
  restore(receiptId: TrashReceiptId): Promise<readonly NodeSummary[]>;
  /** The listed Trash items, newest first. */
  listTrash(): Promise<readonly TrashedItem[]>;
  /** Restores the listed items with these root ids. */
  restoreFromTrash(ids: readonly NodeId[]): Promise<readonly NodeSummary[]>;

  saveStatus(): SaveStatus;
  hasUnsavedChanges(): boolean;
  /** Resolves when every change is on disk; the exit handshake waits on it. */
  flush(): Promise<void>;
  watch(listener: (event: NotesEvent) => void): () => void;
}
