// The search client's contract (Phase 8; crates/search). The Tauri client sends each method to the shell's one
// `search_call` command, and the web client answers from a small in-memory index (./memory.ts). Page IDs are the
// interface's own, and ranges are UTF-8 byte offsets into the text they come with, as the Rust side counts them
// (use ./bytes.ts to turn them into string offsets).

export type PageId = string;
export type BlockId = string;
export type Unsubscribe = () => void;

/** A range of bytes in a string: `start` is included and `end` is not. */
export interface ByteRange {
  start: number;
  end: number;
}

export type BlockKind = 'text' | 'table' | 'image' | 'file' | 'ink' | 'other';

export interface DateFilter {
  field: 'modified' | 'created';
  /** ISO 8601, included. */
  from?: string;
  /** ISO 8601, not included. */
  to?: string;
}

/** Filters the panel sets beside the typed text. Typed operators such as `tag:` add to them. */
export interface SearchFilters {
  tags?: string[];
  blockTypes?: BlockKind[];
  date?: DateFilter;
  titleOnly?: boolean;
}

export interface SearchRequest {
  /** What the person typed, operators included. The last word matches as a prefix. */
  text: string;
  /** Read the text as a regular expression. */
  regex?: boolean;
  filters?: SearchFilters;
  limit?: number;
  offset?: number;
  /** Local time's offset from UTC in minutes, east positive, for words such as `today`. */
  utcOffsetMinutes?: number;
}

export interface Snippet {
  block: BlockId;
  kind: BlockKind;
  text: string;
  highlights: ByteRange[];
}

export interface SearchHit {
  page: PageId;
  title: string;
  titleHighlights: ByteRange[];
  /** ISO 8601. */
  modified: string;
  score: number;
  snippet: Snippet | null;
}

export interface SearchResponse {
  hits: SearchHit[];
  /** False when a regular expression search ran out of time and ranked only what it read. */
  complete: boolean;
  /** Sentences for the line below the box, about typed operators the search could not use. */
  notes: { message: string }[];
  /** Why a regular expression is not valid, in plain words. */
  patternError?: string;
}

export interface SwitchRequest {
  query: string;
  /** The pages opened lately, the latest first. */
  recent?: readonly PageId[];
  current?: PageId | null;
  limit?: number;
}

export interface SwitchHit {
  page: PageId;
  title: string;
  /** Null for the recent pages an empty query lists. */
  kind: string | null;
  score: number;
  highlights: ByteRange[];
  recent: number | null;
  isCurrent: boolean;
}

export interface SwitchResponse {
  hits: SwitchHit[];
  /** The title a new page would get when nothing matched. */
  create: string | null;
}

export interface PageSuggestion {
  page: PageId;
  title: string;
}

export interface HeadingRef {
  block: BlockId;
  level: number;
  text: string;
}

export type LinkStatus = 'resolved' | 'ambiguous' | 'renamed' | 'broken';

export interface LinkTarget {
  page: PageId;
  title: string;
  block: BlockId | null;
}

export interface Resolution {
  status: LinkStatus;
  targets: LinkTarget[];
  headingMissing: boolean;
}

export interface LinkRef {
  title: string;
  heading?: string;
}

export interface LinkPreview {
  page: PageId;
  title: string;
  heading: string | null;
  block: BlockId | null;
  text: string;
  headingMissing: boolean;
}

export interface Backlink {
  source: PageId;
  sourceTitle: string;
  block: BlockId;
  link: string;
  fragment: string | null;
  context: Snippet | null;
  /** The link names an old title of the page. */
  stale: boolean;
}

export interface MentionBlock {
  block: BlockId;
  count: number;
  context: Snippet | null;
}

export interface UnlinkedMention {
  source: PageId;
  sourceTitle: string;
  blocks: MentionBlock[];
  count: number;
}

/** One place in a block's Markdown where a title appears without a link. */
export interface Mention {
  range: ByteRange;
  text: string;
  before: string;
  after: string;
}

export interface TagNode {
  tag: string;
  /** Pages with this tag or a tag nested in it. */
  pages: number;
  ownPages: number;
}

export interface TagChange {
  from: string;
  to: string | null;
  pages: PageId[];
}

export interface TagPlan {
  changes: TagChange[];
  pageCount: number;
  /** The new name exists already, so the tags merge. */
  merges: boolean;
}

/** One change a rename makes to the Markdown of a block. */
export interface LinkEdit {
  page: PageId;
  block: BlockId;
  old: string;
  new: string;
}

export interface RenamePlan {
  page: PageId;
  oldTitle: string;
  newTitle: string;
  edits: LinkEdit[];
  /** The pages other than the renamed one that the edits change. */
  otherPages: PageId[];
}

/** What the index tells the window after a batch. */
export interface IndexUpdate {
  generation?: number;
  added?: PageId[];
  updated?: PageId[];
  removed?: PageId[];
  renames?: RenamePlan[];
  rebuilt?: boolean;
  damaged?: string;
  failed?: { page: PageId; message: string };
}

/** A page the tree holds, for the index to name and list. */
export interface TreePage {
  page: PageId;
  title: string;
}

export interface IndexStatus {
  pages: number;
  failures: number;
  rebuilds: number;
}

/** Where the Tags pane looks. */
export type ScopeRef = { kind: 'page' | 'section' | 'notebook'; id: string } | { kind: 'all' };

/** A page as collections, the calendar, and the graph filters list it. */
export interface PageFact {
  page: PageId;
  notebook: string;
  section: string;
  title: string;
  /** Unix milliseconds. */
  created: number;
  modified: number;
  /** The page's tags and the tags of its lines. */
  tags: string[];
  hasProperties: boolean;
  /** The page's `view.properties`, as the page file holds it. Read it with features/search/properties. */
  properties?: unknown;
}

/** A text block that carries line tags or an open checkbox, with the data that names its lines. */
export interface TaggedBlock {
  page: PageId;
  title: string;
  notebook: string;
  section: string;
  modified: number;
  block: BlockId;
  markdown: string;
  ids: string[];
  tags: Record<string, string[]>;
  checked: string[];
}

/** A block whose text holds some words. */
export interface TextHit {
  page: PageId;
  title: string;
  block: BlockId;
  kind: string;
}

export interface GraphPage {
  page: PageId;
  title: string;
  notebook: string;
  section: string;
}

export interface GraphEdge {
  from: PageId;
  to: PageId;
  count: number;
  ambiguous: boolean;
}

export interface LinkGraphData {
  pages: GraphPage[];
  edges: GraphEdge[];
  /** Pages with no links in or out. */
  orphans: PageId[];
  /** Links that point at nothing. */
  broken: number;
}

export interface Neighbor {
  page: PageId;
  title: string;
  /** How many links away, 1 being next to the page. */
  distance: number;
}

export interface Connection {
  page: PageId;
  title: string;
  count: number;
  ambiguous: boolean;
}

export interface Connections {
  outgoing: Connection[];
  incoming: Connection[];
}

/** What the desktop host adds in Beta 4. The web host and the tests leave it out, and the features check for it. */
export interface SearchExtras {
  /** The `opennote://` link the app was started with, once. */
  launchLink(): Promise<string | null>;
  /** Every page of a notebook, or of all notebooks, with its dates, tags, and properties. */
  pageFacts(notebook?: string | null): Promise<PageFact[]>;
  /** The text blocks in a scope that carry line tags or an open checkbox. */
  taggedBlocks(scope: ScopeRef): Promise<TaggedBlock[]>;
  /** The blocks whose text holds the words anywhere inside, ignoring case: a literal search, for replace. */
  findText(needle: string, limit?: number): Promise<TextHit[]>;
  /** The pages of a notebook, or of all notebooks, and the links between them. */
  linkGraph(notebook?: string | null): Promise<LinkGraphData>;
  /** The pages within `depth` links (1 to 3) of a page, in either direction. */
  neighbors(page: PageId, depth: number): Promise<Neighbor[]>;
  /** What a page links to and what links to it. */
  connections(page: PageId): Promise<Connections>;
}

export interface SearchClient {
  /**
   * What the host can do, so the panel shows only filters that work. `places`: the notebook and section filters
   * work. `feed`: the interface sends the tree's pages and titles to `sync`. A host that reads the notebooks
   * itself, as the app does through the core, is not sent the tree.
   */
  readonly capabilities: { readonly places: boolean; readonly feed: boolean };
  /** Tells the index which pages the tree holds and what they are called. `complete` lists them all. */
  sync(pages: readonly TreePage[], complete: boolean): Promise<void>;
  search(request: SearchRequest): Promise<SearchResponse>;
  switcher(request: SwitchRequest): Promise<SwitchResponse>;
  suggestPages(prefix: string, limit?: number): Promise<PageSuggestion[]>;
  headings(page: PageId): Promise<HeadingRef[]>;
  /** What each link points at now, as seen from `from`. */
  resolve(links: readonly LinkRef[], from?: PageId): Promise<Resolution[]>;
  linkPreview(request: {
    title?: string;
    page?: PageId;
    fragment?: string;
    from?: PageId;
  }): Promise<LinkPreview | null>;
  backlinks(page: PageId): Promise<Backlink[]>;
  unlinkedMentions(page: PageId, limit?: number): Promise<UnlinkedMention[]>;
  /** The exact places in one block's Markdown where `title` appears without a link. */
  findMentions(markdown: string, title: string): Promise<Mention[]>;
  /** Turns mentions into links to `target`. `which` picks them by their place in `findMentions`. */
  linkMentions(
    markdown: string,
    title: string,
    target: PageId,
    which?: number[],
  ): Promise<{ markdown: string; count: number } | null>;
  /** The edits that bring links to an old title up to date. */
  repairEdits(page: PageId): Promise<LinkEdit[]>;
  tagTree(): Promise<TagNode[]>;
  planTagRename(from: string, to: string): Promise<TagPlan>;
  planTagDelete(tag: string): Promise<TagPlan>;
  /** The title field lost focus or Enter was pressed: links follow the new title now. */
  titleSettled(page: PageId): Promise<void>;
  status(): Promise<IndexStatus>;
  rebuild(): Promise<void>;
  /** Waits until the index has caught up with every save, for tests. */
  flush(): Promise<void>;
  onUpdate(listener: (update: IndexUpdate) => void): Unsubscribe;
  readonly extras?: SearchExtras;
}
