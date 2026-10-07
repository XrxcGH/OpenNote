// Writing into the notes for the account features: find or make a notebook, a section, or a page by its title, and
// put Markdown blocks on a page. Everything goes through the notes service and the page service, so the notes
// folder and the page's undo and versions stay the way the rest of the app keeps them.

import { commandContext } from '../../commands/registry';
import { newId } from '../../editor/ids';
import type { PagesClient } from '../../platform/types';
import type { NodeId, NodeKind, NodeSummary, NotesService } from '../../services/notes/types';
import { NOTES_LIMITS } from '../../services/notes/types';
import type { JsonPatch, OpenPage, PageViewJson } from '../../services/pages/types';

/** A title the notes service accepts. */
export function cleanTitle(title: string, fallback: string): string {
  const trimmed = title.replace(/\s+/g, ' ').trim().slice(0, NOTES_LIMITS.titleLength).trim();
  return trimmed === '' ? fallback : trimmed;
}

/** The context the account commands run in. */
export function services(): { notes: NotesService; pages: PagesClient } {
  const context = commandContext('palette');
  return { notes: context.notes, pages: context.platform.pages };
}

async function childrenOf(notes: NotesService, parent: NodeId | null): Promise<readonly NodeSummary[]> {
  return parent === null ? notes.listNotebooks() : notes.listChildren(parent);
}

/** The child of `parent` of this kind and title, made when it is missing. A null parent means a notebook. */
export async function findOrCreate(
  notes: NotesService,
  parent: NodeId | null,
  kind: NodeKind,
  title: string,
): Promise<NodeSummary> {
  const wanted = cleanTitle(title, title);
  const found = (await childrenOf(notes, parent)).find((node) => node.kind === kind && node.title === wanted);
  if (found) return found;
  return notes.create({ kind, placement: { parentId: parent, beforeId: null }, title: wanted });
}

/** Adds a text block for each Markdown string after the block `after`, and answers the IDs it made. */
async function insertText(open: OpenPage, markdown: readonly string[], after: string | undefined): Promise<string[]> {
  const made: string[] = [];
  let previous = after;
  for (const text of markdown) {
    const id = newId();
    const block = { id, type: 'text', data: { markdown: text } };
    await open.send({ edits: [{ edit: 'insertBlock', block, ...(previous ? { after: previous } : {}) }] });
    made.push(id);
    previous = id;
  }
  return made;
}

/** Puts a text block for each Markdown string at the end of a page. Answers the IDs of the blocks it made. */
export async function appendMarkdown(
  pages: PagesClient,
  pageId: string,
  markdown: readonly string[],
): Promise<string[]> {
  const open = await pages.open(pageId, { viewport: null });
  try {
    const made = await insertText(open, markdown, open.initial.blocks.at(-1)?.id);
    await open.saveNow();
    return made;
  } finally {
    await open.close();
  }
}

/** Makes a page in a section with this title and these Markdown blocks. */
export async function createPage(
  notes: NotesService,
  pages: PagesClient,
  section: NodeId,
  title: string,
  markdown: readonly string[],
): Promise<NodeSummary> {
  const page = await notes.create({
    kind: 'page',
    placement: { parentId: section, beforeId: null },
    title: cleanTitle(title, 'Untitled page'),
  });
  if (markdown.length > 0) await appendMarkdown(pages, page.id, markdown);
  return page;
}

/** Replaces blocks that this code wrote earlier with new text blocks; other blocks stay. Answers the new IDs. */
export async function replaceMarkdown(
  pages: PagesClient,
  pageId: string,
  blockIds: readonly string[],
  markdown: readonly string[],
): Promise<string[]> {
  const open = await pages.open(pageId, { viewport: null });
  try {
    const present = blockIds.filter((id) => open.initial.blocks.some((block) => block.id === id));
    if (present.length > 0) await open.send({ edits: [{ edit: 'deleteBlocks', blocks: present }] });
    const kept = open.initial.blocks.filter((block) => !present.includes(block.id));
    const made = await insertText(open, markdown, kept.at(-1)?.id);
    await open.saveNow();
    return made;
  } finally {
    await open.close();
  }
}

/** What a page keeps in its view under one key, such as the event a meeting note came from. */
export async function readPageKey<T>(pages: PagesClient, pageId: string, key: string): Promise<T | null> {
  const open = await pages.open(pageId, { viewport: null });
  try {
    return ((open.initial.view as PageViewJson)[key] as T | undefined) ?? null;
  } finally {
    await open.close();
  }
}

/** Saves a value in the page's view. The page keeps it with its other settings, and undo and versions cover it. */
export async function writePageKey(pages: PagesClient, pageId: string, key: string, value: unknown): Promise<void> {
  const open = await pages.open(pageId, { viewport: null });
  try {
    await open.send({ edits: [{ edit: 'setPage', view: { [key]: value } as JsonPatch }] });
    await open.saveNow();
  } finally {
    await open.close();
  }
}
