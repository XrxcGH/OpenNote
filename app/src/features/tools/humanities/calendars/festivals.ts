// The festivals and holy days that fall in one Gregorian year, from five calendars, sorted by date.
import { hebrewHolidays } from './hebrew';
import { islamicHolidays } from './islamic';
import { gregorianToJdn, julianEaster, julianToJdn, westernEaster } from './jdn';
import { chineseToJdn, nowruz, qingming, springFestival } from './lunisolar';

export type FestivalCalendar = 'christian' | 'hebrew' | 'islamic' | 'chinese' | 'persian';

export interface Festival {
  key: string;
  calendar: FestivalCalendar;
  jdn: number;
}

/** Every festival in the Gregorian year, sorted by date. A calendar outside its range for the year is left out. */
export function festivals(year: number): Festival[] {
  if (!Number.isInteger(year)) throw new Error('whole');
  const first = gregorianToJdn({ year, month: 1, day: 1 });
  const last = gregorianToJdn({ year, month: 12, day: 31 });
  const out: Festival[] = [];
  const add = (calendar: FestivalCalendar, make: () => { key: string; jdn: number }[]) => {
    try {
      for (const item of make()) if (item.jdn >= first && item.jdn <= last) out.push({ ...item, calendar });
    } catch {
      // Outside that calendar's range.
    }
  };
  add('christian', () => {
    const easter = gregorianToJdn(westernEaster(year));
    return [
      { key: 'ashWednesday', jdn: easter - 46 },
      { key: 'palmSunday', jdn: easter - 7 },
      { key: 'goodFriday', jdn: easter - 2 },
      { key: 'westernEaster', jdn: easter },
      { key: 'ascension', jdn: easter + 39 },
      { key: 'pentecost', jdn: easter + 49 },
      { key: 'orthodoxEaster', jdn: julianToJdn(julianEaster(year)) },
    ];
  });
  add('hebrew', () => [...hebrewHolidays(year + 3760), ...hebrewHolidays(year + 3761)]);
  add('islamic', () => {
    const guess = Math.floor(((year - 622) * 33) / 32);
    return [guess - 1, guess, guess + 1, guess + 2].filter((y) => y >= 1).flatMap((y) => islamicHolidays(y));
  });
  add('chinese', () => [
    { key: 'springFestival', jdn: springFestival(year) },
    { key: 'lantern', jdn: springFestival(year) + 14 },
    { key: 'qingming', jdn: qingming(year) },
    { key: 'dragonBoat', jdn: chineseToJdn(year, 5, false, 5) },
    { key: 'qixi', jdn: chineseToJdn(year, 7, false, 7) },
    { key: 'midAutumn', jdn: chineseToJdn(year, 8, false, 15) },
    { key: 'doubleNinth', jdn: chineseToJdn(year, 9, false, 9) },
  ]);
  add('persian', () => [{ key: 'nowruz', jdn: nowruz(year - 621).jdn }]);
  return out.sort((a, b) => a.jdn - b.jdn || a.key.localeCompare(b.key));
}
