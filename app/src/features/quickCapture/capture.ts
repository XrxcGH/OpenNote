// Quick capture (docs/FEATURES.md, "Quick capture"): the note typed in the small window becomes a page in the
// "Quick notes" section of the notebook that was open, so a thought typed from anywhere in Windows lands in one
// known place. The first line is the title and the rest is the body.

import { sessionStore } from '../../state/session';
import { newId } from '../../editor/ids';
import type { NodeId, NodeSummary, NotesService } from '../../services/notes';
import type { PageId } from '../../services/pages/types';
import { pagesClient } from '../qol';

/** The name of the section quick notes go in. */
export const QUICK_SECTION = 'Quick notes';

const TITLE_LIMIT = 200;

/** A note's title (its first line) and body (the lines after it). Null for a note with no text. */
export function splitCapture(text: string): { title: string; body: string } | null {
  const lines = text.replace(/\r\n?/g, '\n').trim().split('\n');
  const title = lines[0].trim().slice(0, TITLE_LIMIT);
  if (!title) return null;
  return { title, body: lines.slice(1).join('\n').trim() };
}

async function notebookFor(notes: NotesService): Promise<NodeSummary | null> {
  const books = await notes.listNotebooks();
  const open = sessionStore.get().location;
  const wanted = open.view === 'workspace' ? open.notebookId : null;
  return books.find((book) => book.id === wanted && !book.archived) ?? books.find((book) => !book.archived) ?? null;
}

async function sectionFor(notes: NotesService, notebook: NodeSummary): Promise<NodeSummary> {
  const children = await notes.listChildren(notebook.id);
  const found = children.find((child) => child.kind === 'section' && child.title === QUICK_SECTION);
  if (found) return found;
  return notes.create({ kind: 'section', placement: { parentId: notebook.id, beforeId: null }, title: QUICK_SECTION });
}

/** Saves a quick note. Resolves with the new page, or null when there was nothing to save or nowhere to put it. */
export async function saveCapture(notes: NotesService, text: string): Promise<NodeSummary | null> {
  const parts = splitCapture(text);
  const notebook = parts ? await notebookFor(notes) : null;
  if (!parts || !notebook) return null;
  const section = await sectionFor(notes, notebook);
  const first = (await notes.listChildren(section.id))[0];
  const page = await notes.create({
    kind: 'page',
    placement: { parentId: section.id as NodeId, beforeId: first?.id ?? null },
    title: parts.title,
  });
  if (parts.body) {
    const open = await pagesClient().open(page.id as unknown as PageId, { viewport: null });
    try {
      const block = { id: newId(), type: 'text' as const, data: { markdown: parts.body } };
      await open.send({ edits: [{ edit: 'insertBlock', block }] });
    } finally {
      await open.close();
    }
  }
  return page;
}
