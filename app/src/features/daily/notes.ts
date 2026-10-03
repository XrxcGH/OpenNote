// Finding and making the notes behind the calendar. Daily, weekly, monthly, and yearly notes are pages in one
// section of a notebook, named for their period, so the same title always finds the same page.
import { getLocation } from '../../app/location';
import { commandContext } from '../../commands/registry';
import { newId } from '../../editor/ids';
import type { NodeId, NodeSummary, NotesService } from '../../services/notes/types';
import { t } from '../../strings/t';
import { openPage } from '../search';
import { noteTitle } from './dates';
import type { DailyKind, Ymd } from './dates';
import { loadTemplates, renderTemplate } from './template';

/** The notebook the notes go in: the one that is open, or else the first one. */
export async function dailyNotebook(notes: NotesService): Promise<NodeId | null> {
  const here = getLocation();
  if (here.view === 'workspace' && here.notebookId) return here.notebookId;
  return (await notes.listNotebooks())[0]?.id ?? null;
}

/** The notebook's section for these notes. It is made when `create` is set and the notebook has none. */
export async function dailySection(notes: NotesService, notebook: NodeId, create: boolean): Promise<NodeSummary | null> {
  const title = t('qolSearch.daily.sectionTitle');
  const found = (await notes.listChildren(notebook)).find((node) => node.kind === 'section' && node.title === title);
  if (found || !create) return found ?? null;
  return notes.create({ kind: 'section', placement: { parentId: notebook, beforeId: null }, title });
}

/** The titles of the notes that exist in the notebook's section, to mark their days. */
export async function existingTitles(notes: NotesService, notebook: NodeId): Promise<Set<string>> {
  const section = await dailySection(notes, notebook, false);
  if (!section) return new Set();
  return new Set((await notes.listChildren(section.id)).filter((node) => node.kind === 'page').map((node) => node.title));
}

/** Makes the note for the day from its template, if it does not exist yet. Returns the page. */
export async function ensureNote(notes: NotesService, kind: DailyKind, day: Ymd): Promise<NodeSummary | null> {
  const notebook = await dailyNotebook(notes);
  if (!notebook) return null;
  const section = await dailySection(notes, notebook, true);
  if (!section) return null;
  const title = noteTitle(kind, day);
  const existing = (await notes.listChildren(section.id)).find((node) => node.kind === 'page' && node.title === title);
  if (existing) return existing;
  const page = await notes.create({ kind: 'page', placement: { parentId: section.id, beforeId: null }, title });
  const markdown = renderTemplate(loadTemplates()[kind], day);
  if (markdown.trim() !== '') {
    const open = await commandContext('palette').platform.pages.open(page.id, { viewport: null });
    try {
      await open.send({ edits: [{ edit: 'insertBlock', block: { id: newId(), type: 'text', data: { markdown } } }] });
    } finally {
      await open.close();
    }
  }
  return page;
}

/** Opens the note for the day, making it first when needed. Resolves false when there is no notebook. */
export async function openNote(kind: DailyKind, day: Ymd): Promise<boolean> {
  const { notes } = commandContext('palette');
  const page = await ensureNote(notes, kind, day);
  return page ? openPage(notes, page.id) : false;
}
