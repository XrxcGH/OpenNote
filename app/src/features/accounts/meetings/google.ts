// Meetings from Google Calendar (events.list on the primary calendar). Repeating events come out one meeting at a time
// (`singleEvents`), and cancelled ones are left out.

import { requestConnector } from '../../connectors';
import type { ConnectorReply, ConnectorsClient } from '../../connectors';
import { agendaText } from './text';
import type { MeetingEvent } from './types';

const BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const MAX_PAGES = 4;

interface GoogleWhen {
  dateTime?: string;
  date?: string;
}

export interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleWhen;
  end?: GoogleWhen;
  organizer?: { email?: string; displayName?: string };
  attendees?: { email?: string; displayName?: string; resource?: boolean }[];
  hangoutLink?: string;
}

interface GooglePage {
  items?: GoogleEvent[];
  nextPageToken?: string;
}

function instant(when: GoogleWhen | undefined): string | null {
  const text = when?.dateTime ?? (when?.date ? `${when.date}T00:00:00` : undefined);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function fromGoogle(event: GoogleEvent): MeetingEvent | null {
  const start = instant(event.start);
  if (!start || event.status === 'cancelled') return null;
  const people = [
    event.organizer?.displayName?.trim() || event.organizer?.email,
    ...(event.attendees ?? []).filter((one) => !one.resource).map((one) => one.displayName?.trim() || one.email),
  ].filter((name): name is string => Boolean(name));
  const html = /<[a-z][\s\S]*>/i.test(event.description ?? '');
  return {
    source: 'google',
    id: event.id,
    title: event.summary?.trim() ?? '',
    start,
    end: instant(event.end),
    allDay: Boolean(event.start?.date),
    location: event.location?.trim() ?? '',
    attendees: [...new Set(people)],
    agenda: agendaText(event.description ?? '', html),
    joinLink: event.hangoutLink ?? '',
  };
}

export async function listGoogleEvents(client: ConnectorsClient, from: Date, to: Date): Promise<MeetingEvent[]> {
  const events: MeetingEvent[] = [];
  let token: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const reply: ConnectorReply<GooglePage> = await requestConnector<GooglePage>(
      'google',
      ['calendarRead'],
      {
        url: BASE,
        query: {
          timeMin: from.toISOString(),
          timeMax: to.toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: 50,
          pageToken: token,
        },
      },
      client,
    );
    for (const raw of reply.data?.items ?? []) {
      const event = fromGoogle(raw);
      if (event) events.push(event);
    }
    token = reply.data?.nextPageToken ?? null;
    if (!token) break;
  }
  return events;
}
