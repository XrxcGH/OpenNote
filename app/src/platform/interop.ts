// What the interface knows about import and export (Phase 11): the host's file pickers and long jobs. The shapes
// match what app/src-tauri/src/interop sends. A job has a name the interface makes; its progress arrives as
// events under that name, and `cancel` stops it. A canceled job answers { status: 'canceled' }, not an error.

import type { Unsubscribe } from './types';

export type PickKind = 'file' | 'folder';

export type SourceKind =
  | 'markdown'
  | 'notion'
  | 'evernote'
  | 'word'
  | 'webArchive'
  | 'html'
  | 'text'
  | 'csv'
  | 'googleKeep'
  | 'textBundle'
  | 'stickyNotes'
  | 'spreadsheet'
  | 'oneNoteFile';

/** What a file, folder, or archive is. */
export interface DetectedSource {
  kind: SourceKind;
  /** A name for the dialog, such as "Obsidian vault". */
  label: string;
  /** False when this version cannot import it; `advice` then says what to do instead. */
  supported: boolean;
  zipped: boolean;
  advice: string | null;
}

/** What was simplified or skipped for one reason. */
export interface LossGroup {
  outcome: 'simplified' | 'skipped';
  why: string;
  /** A few of the parts affected, such as "3 images". */
  examples: string[];
  /** How many pages the reason touched. */
  pages: number;
}

export interface ImportChoices {
  /** Add an "Import report" page to the new notebook. */
  reportPage: boolean;
  wordPages?: 'auto' | 'single' | 'byTitle' | 'byPageBreak';
}

/** A dry run: what an import would bring in and what it would lose. */
export interface ImportPreview {
  detected: DetectedSource;
  notebookTitle: string;
  sections: { title: string; pages: number }[];
  pages: number;
  blocks: number;
  assets: number;
  assetBytes: number;
  losses: LossGroup[];
  /** How many pages lose something. */
  lostPages: number;
  /** How many parts do not come over at all. */
  skipped: number;
}

export interface ImportedPageNode {
  /** The core page that holds the content. */
  core: string;
  title: string;
  /** 0 for a page, 1 and 2 for subpages. */
  level: number;
}

/**
 * The notebook an import wrote. A host that keeps the notes itself, as the app does in the notes folder, has put it
 * in the notes tree already and says so with the node IDs (`notebookId`, and an `id` on each section); `core` of a
 * page is its node ID then. A host that doesn't leaves the interface to build the nodes and `adopt` them.
 */
export interface ImportedTree {
  /** The notebook's node ID in the notes tree, when the host has put the notebook there. */
  notebookId?: string;
  /** The notebook folder, which `adopt` names. */
  dir: string;
  title: string;
  color: string | null;
  sections: { id?: string; title: string; color: string | null; pages: ImportedPageNode[] }[];
}

export interface ImportResult {
  tree: ImportedTree;
  pages: number;
  losses: LossGroup[];
  lostPages: number;
  skipped: number;
}

export type ExportFormat = 'markdown' | 'html' | 'htmlSingle' | 'docx' | 'pdf';
export type ExportScope = 'notebook' | 'section' | 'page';

export interface ExportRequest {
  format: ExportFormat;
  scope: ExportScope;
  /** The notebook's title. */
  title: string;
  /** All the notebook's sections, or just the one section or page that is exported. */
  sections: { title: string; pages: { ui: string; title: string; level: number }[] }[];
  /** The folder the export goes into; the export makes its own folder or file inside. */
  folder: string;
}

export interface ExportResult {
  /** The folder or file to show in Explorer. */
  reveal: string;
  pages: number;
  files: number;
  losses: LossGroup[];
  lostPages: number;
  skipped: number;
}

export type JobOutcome<T> = { status: 'done'; result: T } | { status: 'canceled' };

export type JobProgress = {
  phase: 'scanning' | 'converting' | 'writing';
  unit: 'items' | 'bytes';
  done: number;
  total: number | null;
  /** The page or file being worked on, or an empty string. */
  current: string;
};

/** One event of a running job (the interop crate's events, plus the job's name). */
export type JobEvent = { job: string } & (
  | { event: 'started'; what: string }
  | ({ event: 'progress' } & JobProgress)
  | { event: 'finished'; pages: number }
  | { event: 'canceled' }
  | { event: 'failed'; message: string }
);

/** Notes that other apps keep on this PC, offered without browsing. */
export interface LocalSources {
  /** The Sticky Notes app's database, when this PC has one. */
  stickyNotes: string | null;
}

export interface InteropClient {
  /** Opens the file or folder picker. Null when the person cancels. */
  pick(kind: PickKind, initial?: string | null): Promise<string | null>;
  detect(path: string): Promise<DetectedSource>;
  localSources(): Promise<LocalSources>;
  /** The dry run. Reads the source as an import would and writes nothing. */
  preview(job: string, path: string, choices: ImportChoices): Promise<JobOutcome<ImportPreview>>;
  /** Imports into a new notebook the host keeps, and answers with its tree. */
  importFrom(job: string, path: string, choices: ImportChoices): Promise<JobOutcome<ImportResult>>;
  /** Tells the host which imported page holds the content of each page node the interface made. The app's host has none to learn. */
  adopt(dir: string, pages: readonly { ui: string; core: string }[]): Promise<void>;
  exportTo(job: string, request: ExportRequest): Promise<JobOutcome<ExportResult>>;
  /** Stops a running job at its next checkpoint. */
  cancel(job: string): void;
  /** Shows a file or folder in Explorer. */
  reveal(path: string): Promise<void>;
  onProgress(listener: (event: JobEvent) => void): Unsubscribe;
}
