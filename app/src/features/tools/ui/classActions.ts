// What a class in the timetable can open (Productivity and study tools). "Open class" goes to the class's section and
// opens the page for that day, making it from the class template the first time. "Record" does the same and then asks
// for a recording, because the person pressed it; opening a class never starts one.
import { commandContext } from '../../../commands/registry';
import { newId } from '../../../editor/ids';
import type { NodeId, NodeSummary, NotesService } from '../../../services/notes/types';
import type { PageService } from '../../../services/pages/types';
import { dateKey } from '../upcoming';
import type { CivilDate, ClassSlot } from '../upcoming';
import { loadStored, saveStored } from './storage';

export const DEFAULT_CLASS_TEMPLATE = '## {class}, {longDate}\n\n';

/** The placeholders a class template may use, for the help line. */
export const CLASS_PLACEHOLDERS = [
  '{class}',
  '{date}',
  '{longDate}',
  '{weekday}',
  '{room}',
  '{start}',
  '{end}',
] as const;

const TEMPLATE = 'classTemplate';

export const loadClassTemplate = (): string => {
  const saved = loadStored<unknown>(TEMPLATE, null);
  return typeof saved === 'string' ? saved : DEFAULT_CLASS_TEMPLATE;
};

export const saveClassTemplate = (template: string): void => saveStored(TEMPLATE, template);

const dayOf = (date: CivilDate): Date => new Date(date.year, date.month - 1, date.day);

/** The title of the page for a class on a day: the same title always finds the same page. */
export const classPageTitle = (slot: Pick<ClassSlot, 'name'>, date: CivilDate): string =>
  `${slot.name} ${dateKey(date)}`;

/** The template with the class and the day filled in. */
export function renderClassTemplate(template: string, slot: ClassSlot, date: CivilDate): string {
  const day = dayOf(date);
  const values: Record<string, string> = {
    class: slot.name,
    date: dateKey(date),
    longDate: day.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    weekday: day.toLocaleDateString(undefined, { weekday: 'long' }),
    room: slot.room,
    start: slot.start,
    end: slot.end,
  };
  return template.replace(/\{(\w+)\}/g, (all, name: string) => values[name] ?? all);
}

export type ClassOpening =
  { ok: true; page: NodeSummary; made: boolean } | { ok: false; reason: 'noSection' | 'sectionGone' };

export interface ClassDeps {
  notes: NotesService;
  pages: Pick<PageService, 'open'>;
  template: string;
}

/** Finds the class's page for the day in its section, making it from the template when it is not there yet. */
export async function ensureClassPage(slot: ClassSlot, date: CivilDate, deps: ClassDeps): Promise<ClassOpening> {
  if (!slot.section) return { ok: false, reason: 'noSection' };
  const section = await deps.notes.get(slot.section.id as NodeId);
  if (!section || section.kind !== 'section') return { ok: false, reason: 'sectionGone' };
  const title = classPageTitle(slot, date);
  const existing = (await deps.notes.listChildren(section.id)).find(
    (node) => node.kind === 'page' && node.title === title,
  );
  if (existing) return { ok: true, page: existing, made: false };
  const page = await deps.notes.create({ kind: 'page', placement: { parentId: section.id, beforeId: null }, title });
  const markdown = renderClassTemplate(deps.template, slot, date);
  if (markdown.trim() !== '') {
    const open = await deps.pages.open(page.id, { viewport: null });
    try {
      await open.send({ edits: [{ edit: 'insertBlock', block: { id: newId(), type: 'text', data: { markdown } } }] });
    } finally {
      await open.close();
    }
  }
  return { ok: true, page, made: true };
}

function appDeps(): ClassDeps {
  const context = commandContext('palette');
  return { notes: context.notes, pages: context.platform.pages, template: loadClassTemplate() };
}

/** Opens the class's page for the day, making it first when needed. */
export async function openClass(
  slot: ClassSlot,
  date: CivilDate,
  deps: ClassDeps = appDeps(),
  open: (notes: NotesService, page: string) => Promise<boolean> = defaultOpen,
): Promise<ClassOpening> {
  const result = await ensureClassPage(slot, date, deps);
  if (result.ok) await open(deps.notes, result.page.id);
  return result;
}

/** Opens the class's page and then asks for a recording. The recording is the person's choice, made by pressing Record. */
export async function recordClass(
  slot: ClassSlot,
  date: CivilDate,
  record: (page: NodeSummary) => Promise<unknown>,
  deps: ClassDeps = appDeps(),
  open: (notes: NotesService, page: string) => Promise<boolean> = defaultOpen,
): Promise<ClassOpening> {
  const result = await openClass(slot, date, deps, open);
  if (result.ok) await record(result.page);
  return result;
}

async function defaultOpen(notes: NotesService, page: string): Promise<boolean> {
  const { openPage } = await import('../../search');
  return openPage(notes, page);
}

/**
 * Asks for a recording once the class's page is on screen (the recorder works on the shown page). It gives up quietly
 * after a few seconds, which is better than recording into a page the person did not choose, and it never stops a
 * recording that is already running, because the same command also stops one.
 */
export async function recordOnShownPage(page: NodeSummary): Promise<'started' | 'busy' | 'waited'> {
  const [{ shownMounted }, { commandContext: contextFor, executeCommand }, { commands }] = await Promise.all([
    import('../../page'),
    import('../../../commands/registry'),
    import('../../../registries'),
  ]);
  const running = () => commands.get('audio.stop')?.when?.(contextFor('commandBar')) === true;
  if (running()) return 'busy';
  for (let waited = 0; waited < 4000; waited += 100) {
    if (shownMounted.get()?.page.id === page.id) {
      await executeCommand('audio.record', undefined, 'commandBar');
      return 'started';
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return 'waited';
}
