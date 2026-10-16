// A meeting as the note needs it, whichever calendar it came from.

export type MeetingSource = 'outlook' | 'google' | 'ics';

export interface MeetingEvent {
  source: MeetingSource;
  /** The calendar's own ID for the event. For a file, the event's UID. */
  id: string;
  title: string;
  /** ISO 8601, in UTC. */
  start: string;
  end: string | null;
  allDay: boolean;
  location: string;
  /** Names, or addresses for people with no name. The organizer comes first. */
  attendees: string[];
  /** The invitation's text, without HTML or the join boilerplate. */
  agenda: string;
  joinLink: string;
}

/** What a meeting note and its recordings keep to name the meeting (page view key `meetingEvent`). */
export interface MeetingRef {
  source: MeetingSource;
  id: string;
  title: string;
  start: string;
  end: string | null;
}

export const refOf = (event: MeetingEvent): MeetingRef => ({
  source: event.source,
  id: event.id,
  title: event.title,
  start: event.start,
  end: event.end,
});

/** The time window the pickers read: the last day and the next seven. */
export function windowAround(now: Date): { from: Date; to: Date } {
  return { from: new Date(now.getTime() - 86_400_000), to: new Date(now.getTime() + 7 * 86_400_000) };
}
