// New meeting note: the invitation text, the three calendars (Outlook and Google through mock services, and an .ics file),
// the note that fills in, and the event ID that the note and its recordings keep.
import { describe, expect, it } from 'vitest';
import { addGoogleCalendar, addGraphCalendar } from '../../../../../tests/mock-servers/calendars';
import { MockServer } from '../../../../../tests/mock-servers/server';
import { createMemoryNotesService } from '../../../services/notes/memory';
import { createMemoryPageService } from '../../../services/pages/memory';
import { createFakeConnectors } from '../../connectors';
import { listGoogleEvents } from './google';
import { eventsFromIcs } from './ics';
import { makeMeetingNote, noteBlocks, VIEW_KEY } from './note';
import { listOutlookEvents } from './outlook';
import { agendaText } from './text';
import { refOf, windowAround } from './types';
import type { MeetingEvent } from './types';

const NOW = new Date('2026-10-07T12:00:00Z');
const { from, to } = windowAround(NOW);

describe('the invitation text', () => {
  it('turns HTML into lines and cuts the conferencing boilerplate', () => {
    const html =
      '<p>Review the <b>draft</b> &amp; the budget</p><ul><li>Item one</li><li>Item two</li></ul>' +
      '<div>________________________________________________________________________________</div><div>Microsoft Teams meeting</div>';
    expect(agendaText(html, true)).toBe('Review the draft & the budget\n- Item one\n- Item two');
    expect(agendaText('Plan\r\n\r\n\r\n\r\nGo\n---------------\nJoin Zoom Meeting', false)).toBe('Plan\n\nGo');
    expect(agendaText('x'.repeat(30), false, 10)).toBe(`${'x'.repeat(10)}…`);
  });
});

describe('Outlook through Graph', () => {
  const graph = [
    { id: 'g1', subject: 'Standup', start: '2026-10-07T15:00:00', end: '2026-10-07T15:15:00', location: 'Room 4' },
    {
      id: 'g2',
      subject: 'Design review',
      start: '2026-10-08T17:00:00',
      end: '2026-10-08T18:00:00',
      organizer: 'Ada Writer',
      attendees: [{ name: 'Sam Student', address: 'sam@example.com' }],
      html: '<p>Agenda: the new cover</p><div>Microsoft Teams meeting</div>',
      joinUrl: 'https://teams.example/join/1',
    },
    { id: 'g3', subject: 'Called off', start: '2026-10-09T09:00:00', end: '2026-10-09T10:00:00', isCancelled: true },
    { id: 'g4', subject: 'Offsite', start: '2026-10-10T00:00:00', end: '2026-10-11T00:00:00', isAllDay: true },
    { id: 'g5', subject: 'Too far away', start: '2026-12-01T09:00:00', end: '2026-12-01T10:00:00' },
  ];

  it('reads every page, asks for UTC, and leaves out cancelled and faraway meetings', async () => {
    const server = addGraphCalendar(new MockServer(), graph);
    const { client } = createFakeConnectors({ connected: { microsoft: 'sam@example.com' }, respond: server.respond });
    const events = await listOutlookEvents(client, from, to);
    expect(events.map((event) => event.title)).toEqual(['Standup', 'Design review', 'Offsite']);
    expect(server.requests).toHaveLength(2);
    expect(server.requests[0]?.query.$orderby).toBe('start/dateTime');
    const review = events[1];
    expect(review).toMatchObject({
      source: 'outlook',
      id: 'g2',
      start: '2026-10-08T17:00:00.000Z',
      attendees: ['Ada Writer', 'Sam Student'],
      agenda: 'Agenda: the new cover',
      joinLink: 'https://teams.example/join/1',
    });
    expect(events[2]?.allDay).toBe(true);
  });
});

describe('Google Calendar', () => {
  it('reads every page of single events in order and keeps the people and the link', async () => {
    const server = addGoogleCalendar(new MockServer(), [
      {
        id: 'e1',
        summary: 'Lab',
        start: '2026-10-07T14:00:00.000Z',
        end: '2026-10-07T15:00:00.000Z',
        meet: 'https://meet.example/abc',
      },
      {
        id: 'e2',
        summary: 'Study group',
        start: '2026-10-08T20:00:00.000Z',
        end: '2026-10-08T21:00:00.000Z',
        description: 'Chapters 3 and 4',
        attendees: [{ name: 'Sam', email: 'sam@example.com' }, { email: 'kim@example.com' }],
      },
      {
        id: 'e3',
        summary: 'Dropped',
        start: '2026-10-09T20:00:00.000Z',
        end: '2026-10-09T21:00:00.000Z',
        status: 'cancelled',
      },
    ]);
    const { client } = createFakeConnectors({ connected: { google: 'sam@example.com' }, respond: server.respond });
    const events = await listGoogleEvents(client, from, to);
    expect(events.map((event) => event.id)).toEqual(['e1', 'e2']);
    expect(server.requests).toHaveLength(2);
    expect(events[0]?.joinLink).toBe('https://meet.example/abc');
    expect(events[1]).toMatchObject({ agenda: 'Chapters 3 and 4', attendees: ['Organizer', 'Sam', 'kim@example.com'] });
  });
});

const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:one@example.com',
  'SUMMARY:Advising',
  'DTSTART;TZID=America/New_York:20261008T100000',
  'DTEND;TZID=America/New_York:20261008T103000',
  'LOCATION:Room 12',
  'DESCRIPTION:Bring the plan\\nand the transcript',
  'ORGANIZER;CN=Dr. Patel:mailto:patel@example.edu',
  'ATTENDEE;CN="Sam Student":mailto:sam@example.edu',
  'ATTENDEE:mailto:kim@example.edu',
  'URL:https://school.example/advising',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:weekly@example.com',
  'SUMMARY:Seminar',
  'DTSTART:20261006T140000Z',
  'DTEND:20261006T150000Z',
  'RRULE:FREQ=WEEKLY',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:far@example.com',
  'SUMMARY:Next year',
  'DTSTART:20270601T140000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('a calendar file', () => {
  it('reads the meetings in the window, expands repeats, and keeps the description and the people', () => {
    const events = eventsFromIcs(ICS, NOW, 'UTC');
    expect(events.map((event) => `${event.title} ${event.start}`)).toEqual([
      'Seminar 2026-10-06T14:00:00.000Z',
      'Advising 2026-10-08T14:00:00.000Z',
      'Seminar 2026-10-13T14:00:00.000Z',
    ]);
    const advising = events.find((event) => event.title === 'Advising');
    expect(advising).toMatchObject({
      source: 'ics',
      id: 'one@example.com',
      end: '2026-10-08T14:30:00.000Z',
      location: 'Room 12',
      attendees: ['Dr. Patel', 'Sam Student', 'kim@example.edu'],
      agenda: 'Bring the plan\nand the transcript',
      joinLink: 'https://school.example/advising',
    });
    expect(events.some((event) => event.title === 'Next year')).toBe(false);
    expect(events.find((event) => event.title === 'Seminar')?.end).toBe('2026-10-06T15:00:00.000Z');
  });

  it('gives an empty list for a file with no meetings', () => {
    expect(eventsFromIcs('BEGIN:VCALENDAR\r\nEND:VCALENDAR', NOW, 'UTC')).toEqual([]);
  });
});

describe('the note', () => {
  const event: MeetingEvent = {
    source: 'outlook',
    id: 'g2',
    title: 'Design review',
    start: '2026-10-08T17:00:00.000Z',
    end: '2026-10-08T18:00:00.000Z',
    allDay: false,
    location: 'Room 4',
    attendees: ['Ada Writer', 'Sam Student'],
    agenda: 'Agenda: the new cover',
    joinLink: '',
  };

  it('fills in the time, place, people, and agenda', () => {
    const [details, agenda, notes] = noteBlocks(event);
    expect(details).toContain('When: ');
    expect(details).toContain('Where: Room 4');
    expect(details).toContain('With: Ada Writer, Sam Student');
    expect(agenda).toBe('## Agenda\n\nAgenda: the new cover');
    expect(notes.startsWith('## Notes')).toBe(true);
    expect(noteBlocks({ ...event, agenda: '' })[1]).toContain('The invitation has no agenda.');
    const crowd = noteBlocks({ ...event, attendees: Array.from({ length: 25 }, (_, i) => `Person ${i}`) })[0];
    expect(crowd).toContain('and 5 more');
  });

  it('is made once, keeps the event ID in the page, and is found again for the same meeting', async () => {
    const notes = createMemoryNotesService({ seed: 'empty' });
    const pages = createMemoryPageService([], {
      missing: (id) => ({ id, title: '', created: '', modified: '', tags: [], view: {}, blocks: [], assets: {} }),
    });
    const notebook = await notes.create({
      kind: 'notebook',
      placement: { parentId: null, beforeId: null },
      title: 'School',
    });
    const first = await makeMeetingNote(notes, pages, notebook.id, event);
    expect(first.existing).toBe(false);
    expect(first.page.title).toContain('Design review');
    expect(pages.held(first.page.id)?.view[VIEW_KEY]).toEqual(refOf(event));
    expect(pages.held(first.page.id)?.blocks).toHaveLength(3);
    const again = await makeMeetingNote(notes, pages, notebook.id, event);
    expect(again).toMatchObject({ existing: true, page: { id: first.page.id } });
    const section = (await notes.listChildren(notebook.id))[0];
    expect(section?.title).toBe('Meetings');
    expect(await notes.listChildren(section?.id ?? '')).toHaveLength(1);
  });
});
