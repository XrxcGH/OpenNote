// The meeting note: its title, its blocks, and where it goes. The note keeps the meeting's calendar ID in the page's
// view (`meetingEvent`), so asking for the same meeting again opens the note that is there instead of making a second,
// and a recording made on the page is stamped with the same ID (page/audio/controller.ts).

import type { PagesClient } from '../../../platform/types';
import type { NodeId, NodeSummary, NotesService } from '../../../services/notes/types';
import { formatDate, formatTime } from '../../../strings/format';
import { t } from '../../../strings/t';
import { cleanTitle, createPage, findOrCreate, readPageKey, writePageKey } from '../notebook';
import { refOf } from './types';
import type { MeetingEvent, MeetingRef } from './types';

export const VIEW_KEY = 'meetingEvent';

/** The people shown on a note before it says how many more were invited. */
const PEOPLE_SHOWN = 20;

/** "Oct 7, 2026, 10:00 AM to 10:30 AM", or "Oct 7, 2026, all day". */
export function whenText(event: Pick<MeetingEvent, 'start' | 'end' | 'allDay'>): string {
  const date = formatDate(event.start);
  if (event.allDay) return t('accounts.meetings.event.allDay', { date });
  const start = formatTime(event.start);
  return event.end
    ? t('accounts.meetings.event.span', { date, start, end: formatTime(event.end) })
    : t('accounts.meetings.event.at', { date, start });
}

export function noteTitle(event: MeetingEvent): string {
  const title = event.title.trim() || t('accounts.meetings.event.untitled');
  return cleanTitle(t('accounts.meetings.note.title', { title, date: formatDate(event.start) }), title);
}

function peopleLine(attendees: readonly string[]): string {
  const shown = attendees.slice(0, PEOPLE_SHOWN).join(', ');
  const more = attendees.length - PEOPLE_SHOWN;
  const people = more > 0 ? t('accounts.meetings.note.withMore', { people: shown, count: more }) : shown;
  return t('accounts.meetings.note.with', { people });
}

/** The blocks of the note: the details, the agenda, and an empty place for notes. */
export function noteBlocks(event: MeetingEvent): string[] {
  const details = [t('accounts.meetings.note.when', { when: whenText(event) })];
  if (event.location) details.push(t('accounts.meetings.note.where', { place: event.location }));
  if (event.attendees.length > 0) details.push(peopleLine(event.attendees));
  if (event.joinLink) details.push(t('accounts.meetings.note.join', { link: event.joinLink }));
  const agenda = event.agenda || t('accounts.meetings.note.noAgenda');
  return [
    details.join('\n\n'),
    `## ${t('accounts.meetings.note.agenda')}\n\n${agenda}`,
    `## ${t('accounts.meetings.note.notes')}\n\n`,
  ];
}

export interface MadeNote {
  page: NodeSummary;
  /** True when the note was there already and was not written again. */
  existing: boolean;
}

/** The note for this meeting in the section, if one was made before. */
async function findExisting(
  notes: NotesService,
  pages: PagesClient,
  section: NodeId,
  event: MeetingEvent,
): Promise<NodeSummary | null> {
  const pagesHere = (await notes.listChildren(section)).filter((node) => node.kind === 'page');
  for (const page of pagesHere) {
    const ref = await readPageKey<MeetingRef>(pages, page.id, VIEW_KEY);
    if (ref?.id === event.id && ref.source === event.source && ref.start === event.start) return page;
  }
  return null;
}

/** Makes the note for the meeting in the Meetings section of the notebook, or finds the one made before. */
export async function makeMeetingNote(
  notes: NotesService,
  pages: PagesClient,
  notebook: NodeId,
  event: MeetingEvent,
): Promise<MadeNote> {
  const section = await findOrCreate(notes, notebook, 'section', t('accounts.meetings.note.section'));
  const existing = await findExisting(notes, pages, section.id, event);
  if (existing) return { page: existing, existing: true };
  const page = await createPage(notes, pages, section.id, noteTitle(event), noteBlocks(event));
  await writePageKey(pages, page.id, VIEW_KEY, refOf(event));
  return { page, existing: false };
}
