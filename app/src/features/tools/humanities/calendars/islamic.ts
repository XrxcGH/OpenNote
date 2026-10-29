// The tabular Islamic calendar: 30-year cycles with 11 leap years (the common pattern: years 2, 5, 7, 10, 13, 16,
// 18, 21, 24, 26, and 29), months of 30 and 29 days in turn, and Dhu al-Hijjah 30 days in a leap year. The civil
// epoch is 16 July 622 (Julian), the astronomical one a day earlier. Calendars that follow sighting of the moon, and
// Umm al-Qura, can differ from these dates by a day or two; no such table is bundled.

export const ISLAMIC_EPOCHS = { civil: 1948440, astronomical: 1948439 } as const;
export type IslamicEpoch = keyof typeof ISLAMIC_EPOCHS;

export const isIslamicLeap = (year: number): boolean => (((14 + 11 * year) % 30) + 30) % 30 < 11;

export function islamicToJdn(year: number, month: number, day: number, epoch: IslamicEpoch = 'civil'): number {
  if (!Number.isInteger(year) || year < 1) throw new Error('islamicYear');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('month');
  const length = month % 2 === 1 || (month === 12 && isIslamicLeap(year)) ? 30 : 29;
  if (!Number.isInteger(day) || day < 1 || day > length) throw new Error('day');
  return (
    day +
    Math.ceil(29.5 * (month - 1)) +
    354 * (year - 1) +
    Math.floor((3 + 11 * year) / 30) +
    ISLAMIC_EPOCHS[epoch] -
    1
  );
}

export function jdnToIslamic(jdn: number, epoch: IslamicEpoch = 'civil'): { year: number; month: number; day: number } {
  const start = ISLAMIC_EPOCHS[epoch];
  if (jdn < start) throw new Error('beforeEpoch');
  const year = Math.floor((30 * (jdn - start) + 10646) / 10631);
  const first = islamicToJdn(year, 1, 1, epoch);
  const month = Math.min(12, Math.ceil((jdn - (29 + first)) / 29.5) + 1);
  return { year, month, day: jdn - islamicToJdn(year, month, 1, epoch) + 1 };
}

/** The main days of an Islamic year: a key and the JDN. */
export function islamicHolidays(year: number, epoch: IslamicEpoch = 'civil'): { key: string; jdn: number }[] {
  const at = (month: number, day: number) => islamicToJdn(year, month, day, epoch);
  return [
    { key: 'islamicNewYear', jdn: at(1, 1) },
    { key: 'ashura', jdn: at(1, 10) },
    { key: 'mawlid', jdn: at(3, 12) },
    { key: 'israMiraj', jdn: at(7, 27) },
    { key: 'ramadan', jdn: at(9, 1) },
    { key: 'eidFitr', jdn: at(10, 1) },
    { key: 'eidAdha', jdn: at(12, 10) },
  ];
}
