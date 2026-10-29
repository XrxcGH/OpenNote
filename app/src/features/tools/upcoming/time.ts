// Finds a time of day inside a phrase: "5 PM", "5:30pm", "17:00", or "noon", with an optional "at" before it.
// A time with a colon and no am or pm is on the 24-hour clock, so "5:30" is 5:30 in the morning. A bare number
// such as "5" is never a time, because "Chapter 5" is not one.

import type { ClockTime } from './date';

export interface ExtractedTime {
  time: ClockTime;
  /** The phrase with the time taken out. */
  rest: string;
}

// Alternatives: noon | h[:mm] am/pm | hh:mm. The text is lowercase, with single spaces.
const TIME = /(?:^| )(?:at )?(?:(noon)|(\d{1,2})(?::(\d{2}))? ?(am|pm)|(\d{1,2}):(\d{2}))(?= |$)/;

/** Builds a time from 12-hour parts, or null if the hour or minute is out of range. */
function twelveHour(hour: number, minute: number, meridiem: string): ClockTime | null {
  if (hour < 1 || hour > 12 || minute > 59) return null;
  return { hour: (hour % 12) + (meridiem === 'pm' ? 12 : 0), minute };
}

function twentyFourHour(hour: number, minute: number): ClockTime | null {
  return hour > 23 || minute > 59 ? null : { hour, minute };
}

/**
 * Takes the time out of a phrase. Returns null if there is no time, and 'invalid' if the text looks like a time
 * but isn't one, such as "13 pm" or "25:00".
 */
export function extractTime(text: string): ExtractedTime | 'invalid' | null {
  const match = TIME.exec(text);
  if (!match) return null;
  const [whole, noon, hour12, minute12, meridiem, hour24, minute24] = match;
  let time: ClockTime | null;
  if (noon) time = { hour: 12, minute: 0 };
  else if (meridiem) time = twelveHour(Number(hour12), Number(minute12 ?? 0), meridiem);
  else time = twentyFourHour(Number(hour24), Number(minute24));
  if (!time) return 'invalid';
  const rest = `${text.slice(0, match.index)} ${text.slice(match.index + whole.length)}`;
  return { time, rest: rest.replace(/\s+/g, ' ').trim() };
}
