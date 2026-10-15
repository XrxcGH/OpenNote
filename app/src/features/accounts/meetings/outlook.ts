// Meetings from the Outlook calendar, through Microsoft Graph (calendarView). Times are asked for in UTC, so a
// meeting means the same moment wherever the PC is. Cancelled meetings are left out.

import { requestConnector } from '../../connectors';
import type { ConnectorReply, ConnectorsClient } from '../../connectors';
import { agendaText } from './text';
import type { MeetingEvent } from './types';

const BASE = 'https://graph.microsoft.com/v1.0';
const MAX_PAGES = 4;

interface Person {
  emailAddress?: { name?: string; address?: string };
}

export interface GraphEvent {
  id: string;
  subject?: string;
  isCancelled?: boolean;
  isAllDay?: boolean;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  location?: { displayName?: string };
  attendees?: Person[];
  organizer?: Person;
  body?: { contentType?: string; content?: string };
  bodyPreview?: string;
  onlineMeeting?: { joinUrl?: string } | null;
}

interface GraphPage {
  value?: GraphEvent[];
  '@odata.nextLink'?: string;
}

const named = (person: Person | undefined): string =>
  person?.emailAddress?.name?.trim() || person?.emailAddress?.address?.trim() || '';

/** A Graph time in UTC: it has no zone letter, so one is added. */
function utc(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function fromGraph(event: GraphEvent): MeetingEvent | null {
  const start = utc(event.start?.dateTime);
  if (!start || event.isCancelled) return null;
  const people = [named(event.organizer), ...(event.attendees ?? []).map(named)].filter(Boolean);
  const html = event.body?.contentType?.toLowerCase() === 'html';
  return {
    source: 'outlook',
    id: event.id,
    title: event.subject?.trim() ?? '',
    start,
    end: utc(event.end?.dateTime),
    allDay: event.isAllDay === true,
    location: event.location?.displayName?.trim() ?? '',
    attendees: [...new Set(people)],
    agenda: agendaText(event.body?.content ?? event.bodyPreview ?? '', html),
    joinLink: event.onlineMeeting?.joinUrl ?? '',
  };
}

export async function listOutlookEvents(client: ConnectorsClient, from: Date, to: Date): Promise<MeetingEvent[]> {
  const events: MeetingEvent[] = [];
  let url: string | null = `${BASE}/me/calendarView`;
  for (let page = 0; page < MAX_PAGES && url; page += 1) {
    const query =
      page === 0
        ? { startDateTime: from.toISOString(), endDateTime: to.toISOString(), $top: 50, $orderby: 'start/dateTime' }
        : undefined;
    const reply: ConnectorReply<GraphPage> = await requestConnector<GraphPage>(
      'microsoft',
      ['calendarRead'],
      { url, query, headers: { Prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"' } },
      client,
    );
    for (const raw of reply.data?.value ?? []) {
      const event = fromGraph(raw);
      if (event) events.push(event);
    }
    url = reply.data?.['@odata.nextLink'] ?? null;
  }
  return events;
}
