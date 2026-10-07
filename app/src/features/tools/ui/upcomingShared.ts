// Small helpers the Upcoming parts share: the time zone, weekday names, new ids, and a clock that ticks each minute.
import { useEffect, useState } from 'react';

export const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
export const weekday = (day: number): string =>
  new Date(2023, 0, 1 + day).toLocaleDateString(undefined, { weekday: 'short' });
export const longDay = (day: number): string =>
  new Date(2023, 0, 1 + day).toLocaleDateString(undefined, { weekday: 'long' });
export const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;
let counter = 0;
export const newId = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(counter += 1)}`;

/** The time now, renewed each minute, so the lists move on at midnight and as classes begin. */
export function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
