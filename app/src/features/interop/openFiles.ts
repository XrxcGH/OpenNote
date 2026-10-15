// Opening one Markdown or text file as a page that saves back to the file (A3-18, A4-26, A1-27). The file comes from
// Explorer ("Open with", or OpenNote as the default app), from a second launch, or from Open file. It becomes a page
// in the "Opened files" notebook, linked to the file. While that page is shown, typing is written back to the file
// a moment later, and an edit made to the file in another app comes into the page. The host only reads and writes
// files the person chose (interop/open_files.rs). A shared .opennote file opens through Import notes instead.
import { lazy } from 'react';
import { getLocation } from '../../app/location';
import { isEnabled } from '../../app/flags';
import { newId } from '../../editor/ids';
import type { InteropClient } from '../../platform/interop';
import type { Platform } from '../../platform/types';
import type { NodeId, NodeSummary, NotesService } from '../../services/notes/types';
import type { PageJson } from '../../services/pages/types';
import { showOverlay } from '../../shell/commandbar/overlays';
import { t } from '../../strings/t';
import { showToast } from '../../ui';

const LazyImport = lazy(() => import('./ImportDialog'));

/** How often the shown linked page is saved and its file checked, in milliseconds. */
export const WATCH_MS = 2_000;
/** How often, and how many times, a just-opened page is looked at until the window shows it. */
const SETTLE_MS = 50;
const SETTLE_TRIES = 60;

const TEXT = /\.(md|markdown|txt)$/i;
const SHARED = /\.opennote$/i;

export interface OpenedFile {
  path: string;
  text: string;
  /** When the file last changed, in milliseconds. */
  modified: number;
  /** False for a .txt file. */
  markdown: boolean;
}

/** What the watcher knows of a linked page. */
interface Watched {
  path: string;
  modified: number;
  /** The page's text as last written or read, or null until the first look sets it. */
  text: string | null;
}

export interface OpenFilesDeps {
  platform: Pick<Platform, 'pages'> & { interop: InteropClient };
  notes: NotesService;
  /** Opens a page in the workspace. */
  openPage(notes: NotesService, page: NodeId): Promise<boolean>;
  /** The shown page's text blocks, as the window has them now, or null when that page isn't shown. */
  shownText(page: string): Promise<string | null>;
}

const sameFile = (a: string, b: string) =>
  a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase();

/** The text of a page's text blocks, in order, as one Markdown text. */
export function pageText(page: Pick<PageJson, 'blocks'>): string {
  return [...page.blocks]
    .filter((block) => block.type === 'text' && typeof block.data.markdown === 'string')
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    .map((block) => block.data.markdown as string)
    .join('\n\n');
}

/** A file's name without its folder and extension: the page's title. */
export const fileTitle = (path: string) =>
  (path.split(/[\\/]/).pop() ?? path).replace(/\.(md|markdown|txt)$/i, '') || path;

export class OpenFiles {
  private readonly watched = new Map<string, Watched>();
  private loaded: Promise<void> | null = null;
  private busy = false;

  constructor(private readonly deps: OpenFilesDeps) {}

  private more<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
    const more = this.deps.platform.interop.more;
    if (!more) return Promise.reject(new Error('This copy of OpenNote cannot open files.'));
    return more<T>(op, args);
  }

  /** Reads the saved links once. */
  load(): Promise<void> {
    this.loaded ??= this.more<{ pages: Record<string, string> }>('open_list')
      .then(({ pages }) => {
        for (const [page, path] of Object.entries(pages)) {
          if (!this.watched.has(page)) this.watched.set(page, { path, modified: 0, text: null });
        }
      })
      .catch(() => undefined);
    return this.loaded;
  }

  /** Whether a page is linked to a file. */
  linked(page: string): string | null {
    return this.watched.get(page)?.path ?? null;
  }

  /** The "Opened files" notebook and its section, made when missing. */
  private async place(): Promise<NodeSummary> {
    const { notes } = this.deps;
    const title = t('interop.openFiles.notebook');
    const notebook =
      (await notes.listNotebooks()).find((node) => node.title === title) ??
      (await notes.create({ kind: 'notebook', placement: { parentId: null, beforeId: null }, title }));
    const sectionTitle = t('interop.openFiles.section');
    const children = await notes.listChildren(notebook.id);
    return (
      children.find((node) => node.kind === 'section' && node.title === sectionTitle) ??
      notes.create({ kind: 'section', placement: { parentId: notebook.id, beforeId: null }, title: sectionTitle })
    );
  }

  /** Replaces the page's text with the file's. */
  private async replace(page: string, text: string): Promise<void> {
    const open = await this.deps.platform.pages.open(page as never, { viewport: null });
    try {
      const old = open.initial.blocks.filter((block) => block.type === 'text').map((block) => block.id);
      await open.send({
        edits: [
          ...(old.length > 0 ? [{ edit: 'deleteBlocks' as const, blocks: old }] : []),
          { edit: 'insertBlock', block: { id: newId() as never, type: 'text', data: { markdown: text } } },
        ],
      });
    } finally {
      await open.close().catch(() => undefined);
    }
  }

  /**
   * Opens a file the person chose: a shared .opennote file through Import notes, and a Markdown or text file as its
   * linked page, made the first time, and brought up to date with the file after that.
   */
  async open(path: string): Promise<boolean> {
    if (SHARED.test(path)) {
      await this.more('open_picked', { path }).catch(() => undefined);
      showOverlay('interop-import', LazyImport, {
        interop: this.deps.platform.interop,
        notes: this.deps.notes,
        path,
      });
      return true;
    }
    if (!TEXT.test(path)) return false;
    try {
      const picked = await this.more<{ path: string }>('open_picked', { path });
      const file = await this.more<OpenedFile>('open_read', { path: picked.path });
      await this.load();
      const { notes } = this.deps;
      let page = [...this.watched].find(([, w]) => sameFile(w.path, file.path))?.[0] ?? null;
      if (page && !(await notes.get(page as NodeId).catch(() => null))) {
        await this.more('open_link', { page, path: null }).catch(() => undefined);
        this.watched.delete(page);
        page = null;
      }
      if (page) {
        await this.replace(page, file.text);
      } else {
        const section = await this.place();
        const node = await notes.create({
          kind: 'page',
          placement: { parentId: section.id, beforeId: null },
          title: fileTitle(file.path),
        });
        page = node.id;
        await this.replace(page, file.text);
        await this.more('open_link', { page, path: file.path });
      }
      const watched: Watched = { path: file.path, modified: file.modified, text: null };
      this.watched.set(page, watched);
      await this.deps.openPage(notes, page as NodeId);
      await this.settle(page, watched);
      return true;
    } catch {
      showToast({ message: t('interop.openFiles.cantOpen', { name: fileTitle(path) }), tone: 'danger' });
      return false;
    }
  }

  /**
   * Takes the page as the window first shows it, right after it opens, so typing that starts before the next tick
   * is saved too. Opening a file never rewrites it: only a change from this first look is written.
   */
  private async settle(page: string, watched: Watched): Promise<void> {
    for (let tries = 0; tries < SETTLE_TRIES && watched.text === null; tries += 1) {
      const text = await this.deps.shownText(page).catch(() => null);
      if (text !== null) {
        watched.text ??= text;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    }
  }

  /** Saves the shown linked page into its file, or brings in an edit made to the file elsewhere. */
  async tick(page: string): Promise<void> {
    const watched = this.watched.get(page);
    if (!watched || this.busy) return;
    this.busy = true;
    try {
      const text = await this.deps.shownText(page);
      if (text === null) return;
      if (watched.text === null) {
        // The first look takes the page as it is, so opening a file never rewrites it.
        watched.text = text;
        if (watched.modified === 0) {
          watched.modified =
            (await this.more<{ modified: number | null }>('open_stat', { path: watched.path })).modified ?? 0;
        }
        return;
      }
      if (text !== watched.text) {
        await this.save(page, watched, text);
        return;
      }
      const stat = await this.more<{ exists: boolean; modified: number | null }>('open_stat', { path: watched.path });
      if (stat.exists && stat.modified !== null && stat.modified !== watched.modified) {
        const file = await this.more<OpenedFile>('open_read', { path: watched.path });
        await this.replace(page, file.text);
        Object.assign(watched, { modified: file.modified, text: null });
        showToast({ message: t('interop.openFiles.updated', { name: fileTitle(watched.path) }) });
      }
    } catch {
      // The next tick tries again. A file that is gone or locked stays as the page has it.
    } finally {
      this.busy = false;
    }
  }

  private async save(page: string, watched: Watched, text: string): Promise<void> {
    try {
      const saved = await this.more<{ modified: number }>('open_write', {
        path: watched.path,
        text,
        expected: watched.modified,
      });
      Object.assign(watched, { modified: saved.modified, text });
    } catch (error) {
      if ((error as { code?: string }).code !== 'changed') throw error;
      // Both changed. The page keeps what was typed, and the person chooses: the file's version, or this page's.
      const file = await this.more<OpenedFile>('open_read', { path: watched.path });
      showToast({
        id: `open-file-${page}`,
        message: t('interop.openFiles.conflict', { name: fileTitle(watched.path) }),
        action: {
          label: t('interop.openFiles.loadFile'),
          run: async () => {
            await this.replace(page, file.text);
            Object.assign(watched, { modified: file.modified, text: null });
          },
        },
      });
      // Until the person chooses, the page's next save keeps their typing and replaces the file.
      Object.assign(watched, { modified: file.modified });
    }
  }
}

/** Opens the files the app was started with, and the ones a second launch forwards, and keeps linked pages saved. */
export function installOpenFiles(platform: Platform, notes: NotesService): () => void {
  if (!isEnabled('interop.openFiles') || !platform.interop.more) return () => undefined;
  const files = new OpenFiles({
    platform,
    notes,
    openPage: async (n, page) => (await import('../search')).openPage(n, page),
    shownText: async (page) => {
      const { shownMounted } = await import('../page');
      const mounted = shownMounted.get();
      if (mounted?.page.id !== page) return null;
      // The editor sends typing to the page in batches; flushing first means the file gets what the page shows.
      await mounted.sync.flushAll('command').catch(() => undefined);
      const open = await platform.pages.open(page as never, { viewport: null });
      try {
        return pageText(open.initial);
      } finally {
        await open.close().catch(() => undefined);
      }
    },
  });
  current = files;
  void files.load();
  void platform.interop
    .more<{ files: string[] }>('open_launch')
    .then(({ files: paths }) => paths.forEach((path) => void files.open(path)))
    .catch(() => undefined);
  const stop = platform.window.onForwardedArgs((args) => {
    for (const arg of args) if (TEXT.test(arg) || SHARED.test(arg)) void files.open(arg);
  });
  const timer = setInterval(() => {
    const here = getLocation();
    const page = here.view === 'workspace' ? here.pageId : null;
    if (page && files.linked(page)) void files.tick(page);
  }, WATCH_MS);
  return () => {
    stop();
    clearInterval(timer);
    if (current === files) current = null;
  };
}

let current: OpenFiles | null = null;

/** The running watcher, for Open file. */
export function openFiles(): OpenFiles | null {
  return current;
}
