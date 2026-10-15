// Which pages are protected: the pages of an encrypted section (spec 5.7). The smart features keep nothing of them on
// this device. The search by meaning index and the words read in images refuse them, and drop and re-save what they
// had the moment a page is found protected, as the search crate does with locked pages (crates/search). Every index
// or cache of page text registers here with `onPagesProtected` and asks `isProtectedPage` before it keeps anything.
import type { NodeId, NodeSummary, NotesService } from '../../services/notes/types';

export interface TreePage {
  id: string;
  title: string;
  modified: string;
  /** In an encrypted section: nothing of it may be indexed or cached. */
  encrypted: boolean;
}

type Forget = (ids: readonly string[]) => void | Promise<void>;

const protectedIds = new Set<string>();
const forgetters = new Set<Forget>();

export function isProtectedPage(id: string): boolean {
  return protectedIds.has(id);
}

/** Registers what drops a page's entries when the page is found protected. Returns the function that stops it. */
export function onPagesProtected(forget: Forget): () => void {
  forgetters.add(forget);
  return () => void forgetters.delete(forget);
}

/**
 * Records which pages are protected and which are not any more. Every index and cache forgets the newly protected
 * ones; this resolves once they have saved.
 */
export async function setPagesProtected(protect: readonly string[], unprotect: readonly string[] = []): Promise<void> {
  for (const id of unprotect) protectedIds.delete(id);
  const fresh = protect.filter((id) => !protectedIds.has(id));
  for (const id of fresh) protectedIds.add(id);
  if (fresh.length > 0) await Promise.all([...forgetters].map((forget) => forget(fresh)));
}

/** Every page in the tree, each marked when its section is encrypted. */
export async function listTreePages(notes: Pick<NotesService, 'listNotebooks' | 'listChildren'>): Promise<TreePage[]> {
  const out: TreePage[] = [];
  const walk = async (nodes: readonly NodeSummary[], inEncrypted: boolean): Promise<void> => {
    for (const node of nodes) {
      const encrypted = inEncrypted || node.encrypted === true;
      if (node.kind === 'page') out.push({ id: node.id, title: node.title, modified: node.modified, encrypted });
      else if (node.childCount > 0) await walk(await notes.listChildren(node.id), encrypted);
    }
  };
  await walk(await notes.listNotebooks(), false);
  return out;
}

/** Walks the tree and records every protected page, so the caches drop what they hold of them. */
export async function sweepProtectedPages(notes: Pick<NotesService, 'listNotebooks' | 'listChildren'>): Promise<void> {
  const pages = await listTreePages(notes);
  await setPagesProtected(
    pages.filter((page) => page.encrypted).map((page) => page.id),
    pages.filter((page) => !page.encrypted).map((page) => page.id),
  );
}

/**
 * Whether a page is protected, asking the tree when this device hasn't seen it yet. A page the tree can't describe
 * counts as protected, so nothing is kept of it until the tree says otherwise.
 */
export async function checkPageProtected(id: string, notes: Pick<NotesService, 'get'>): Promise<boolean> {
  if (protectedIds.has(id)) return true;
  try {
    const node = await notes.get(id as NodeId);
    if (!node) return true;
    const encrypted = node.encrypted === true;
    await setPagesProtected(encrypted ? [id] : [], encrypted ? [] : [id]);
    return encrypted;
  } catch {
    return true;
  }
}

/** Follows the tree: a page or section that becomes encrypted has its pages dropped from every cache at once. */
export function watchProtectedPages(notes: Pick<NotesService, 'watch' | 'listChildren'>): () => void {
  return notes.watch((event) => {
    if (event.type !== 'upserted') return;
    const pages = event.nodes.filter((node) => node.kind === 'page');
    const sections = event.nodes.filter((node) => node.kind !== 'page' && node.encrypted === true);
    void setPagesProtected(
      pages.filter((node) => node.encrypted === true).map((node) => node.id),
      pages.filter((node) => node.encrypted !== true).map((node) => node.id),
    );
    for (const section of sections) {
      void listTreePages({
        listNotebooks: async () => [section],
        listChildren: (id) => notes.listChildren(id),
      })
        .then((inside) => setPagesProtected(inside.map((page) => page.id)))
        .catch(() => undefined);
    }
  });
}

/** Tests start with no page known. */
export function resetProtectedPagesForTests(): void {
  protectedIds.clear();
}
