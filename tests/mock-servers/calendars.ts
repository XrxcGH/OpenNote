// Mocks of the two calendar services: Microsoft Graph's calendarView and Google Calendar's events.list. Each takes the
// events it holds, filters them by the window in the query, and pages them the way the real service does, so a test
// can check that the feature reads every page and sends the times the service wants.
import type { MockServer } from './server';

export interface GraphMockEvent {
  id: string;
  subject: string;
  /** UTC, as Graph writes it when asked for UTC: no zone letter. */
  start: string;
  end: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  location?: string;
  organizer?: string;
  attendees?: { name: string; address: string }[];
  html?: string;
  text?: string;
  joinUrl?: string;
}

const graphPerson = (name: string, address = `${name.toLowerCase().replace(/\W+/g, '.')}@example.com`) => ({
  emailAddress: { name, address },
});

export function addGraphCalendar(server: MockServer, events: GraphMockEvent[], pageSize = 2): MockServer {
  return server.route('GET graph.microsoft.com/v1.0/me/calendarView', (request) => {
    if (!request.headers.prefer?.includes('outlook.timezone="UTC"')) {
      return { status: 400, json: { error: { message: 'The feature must ask for UTC times.' } } };
    }
    const from = request.query.startDateTime ?? '';
    const to = request.query.endDateTime ?? '';
    const inside = events.filter((event) => event.start >= from.slice(0, 19) && event.start < to.slice(0, 19));
    const skip = Number(request.query.$skip ?? 0) || 0;
    const slice = inside.slice(skip, skip + pageSize);
    const value = slice.map((event) => ({
      id: event.id,
      subject: event.subject,
      isAllDay: event.isAllDay ?? false,
      isCancelled: event.isCancelled ?? false,
      start: { dateTime: `${event.start}.0000000`, timeZone: 'UTC' },
      end: { dateTime: `${event.end}.0000000`, timeZone: 'UTC' },
      location: { displayName: event.location ?? '' },
      organizer: graphPerson(event.organizer ?? 'Organizer'),
      attendees: (event.attendees ?? []).map((one) => graphPerson(one.name, one.address)),
      body: event.html
        ? { contentType: 'html', content: event.html }
        : { contentType: 'text', content: event.text ?? '' },
      onlineMeeting: event.joinUrl ? { joinUrl: event.joinUrl } : null,
    }));
    const more = skip + pageSize < inside.length;
    const next = more
      ? `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${encodeURIComponent(from)}&endDateTime=${encodeURIComponent(to)}&$skip=${skip + pageSize}`
      : undefined;
    return { json: { value, ...(next ? { '@odata.nextLink': next } : {}) } };
  });
}

export interface GoogleMockEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  date?: string;
  status?: string;
  description?: string;
  location?: string;
  organizer?: string;
  attendees?: { name?: string; email: string }[];
  meet?: string;
}

export function addGoogleCalendar(server: MockServer, events: GoogleMockEvent[], pageSize = 2): MockServer {
  return server.route('GET www.googleapis.com/calendar/v3/calendars/primary/events', (request) => {
    if (request.query.singleEvents !== 'true' || request.query.orderBy !== 'startTime') {
      return { status: 400, json: { error: { message: 'The feature must ask for single events in order.' } } };
    }
    const [min, max] = [request.query.timeMin ?? '', request.query.timeMax ?? ''];
    const inside = events.filter((event) => event.start >= min && event.start < max);
    const skip = Number(request.query.pageToken ?? 0) || 0;
    const items = inside.slice(skip, skip + pageSize).map((event) => ({
      id: event.id,
      status: event.status ?? 'confirmed',
      summary: event.summary,
      description: event.description,
      location: event.location,
      start: event.date ? { date: event.date } : { dateTime: event.start },
      end: event.date ? { date: event.date } : { dateTime: event.end },
      organizer: { displayName: event.organizer ?? 'Organizer', email: 'organizer@example.com' },
      attendees: (event.attendees ?? []).map((one) => ({ displayName: one.name, email: one.email })),
      hangoutLink: event.meet,
    }));
    const next = skip + pageSize < inside.length ? String(skip + pageSize) : undefined;
    return { json: { items, ...(next ? { nextPageToken: next } : {}) } };
  });
}
