import { describe, expect, it } from 'vitest';
import { localTime } from './astro';
import { festivals } from './festivals';
import { hebrewHolidays, hebrewToJdn, jdnToHebrew, newYearDay, yearKind, yearLength } from './hebrew';
import { islamicToJdn, jdnToIslamic } from './islamic';
import {
  dayOfYear,
  gregorianToJdn,
  isoWeek,
  jdnToGregorian,
  jdnToJulian,
  julianEaster,
  julianToJdn,
  westernEaster,
  weekday,
} from './jdn';
import {
  chineseSui,
  jdnToChinese,
  jdnToPersian,
  nowruz,
  persianLeap,
  persianLeap33,
  qingming,
  springFestival,
  TEHRAN,
  yearStemBranch,
  daySexagenary,
} from './lunisolar';
import {
  eraOf,
  japaneseEra,
  jdnToMaya,
  jdnToNile,
  jdnToRepublican,
  jdnToSaka,
  mayaToJdn,
  nileToJdn,
  parseEras,
  republicanToJdn,
  roman,
  romanDay,
  sakaToJdn,
} from './others';

const g = (year: number, month: number, day: number) => gregorianToJdn({ year, month, day });
const iso = (jdn: number) => {
  const d = jdnToGregorian(jdn);
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
};

describe('Julian Day Numbers', () => {
  it('number 2024-10-03 as 2460587 and 2000-01-01 as 2451545', () => {
    expect(g(2024, 10, 3)).toBe(2460587);
    expect(g(2000, 1, 1)).toBe(2451545);
    expect(jdnToGregorian(2460587)).toEqual({ year: 2024, month: 10, day: 3 });
    // 1 January 2000 was a Saturday.
    expect(weekday(2451545)).toBe(6);
  });

  it('turn Julian 1582-10-05 into Gregorian 1582-10-15 and Gregorian 2024-01-01 into Julian 2023-12-19', () => {
    expect(iso(julianToJdn({ year: 1582, month: 10, day: 5 }))).toBe('1582-10-15');
    expect(jdnToJulian(g(2024, 1, 1))).toEqual({ year: 2023, month: 12, day: 19 });
  });

  it('give ISO weeks and days of the year', () => {
    // 2021-01-03 was a Sunday in week 53 of 2020; 2024-12-30 is in week 1 of 2025.
    expect(isoWeek(g(2021, 1, 3))).toEqual({ year: 2020, week: 53, day: 7 });
    expect(isoWeek(g(2024, 12, 30))).toEqual({ year: 2025, week: 1, day: 1 });
    expect(dayOfYear(g(2024, 12, 31))).toBe(366);
  });

  it('refuse impossible dates and work before 1 CE', () => {
    expect(() => g(2023, 2, 29)).toThrow('day');
    expect(() => g(2023, 0, 1)).toThrow('month');
    expect(() => g(2023.5, 1, 1)).toThrow('whole');
    // The epoch of the Julian Day: noon, 1 January 4713 BCE (Julian), which is astronomical year -4712.
    expect(julianToJdn({ year: -4712, month: 1, day: 1 })).toBe(0);
  });

  it('find Western and Orthodox Easter for 2024 and 2025', () => {
    expect(westernEaster(2024)).toEqual({ year: 2024, month: 3, day: 31 });
    expect(iso(julianToJdn(julianEaster(2024)))).toBe('2024-05-05');
    expect(westernEaster(2025)).toEqual({ year: 2025, month: 4, day: 20 });
    expect(iso(julianToJdn(julianEaster(2025)))).toBe('2025-04-20');
  });
});

describe('Hebrew calendar', () => {
  it('put 1 Tishrei 5785 on 2024-10-03 after a 383-day leap year', () => {
    expect(hebrewToJdn(5785, 1, 1)).toBe(2460587);
    expect(jdnToHebrew(2460587)).toEqual({ year: 5785, month: 1, day: 1 });
    expect(yearLength(5784)).toBe(383);
    expect(yearKind(5784)).toBe('deficient');
  });

  it('never start a year on Sunday, Wednesday, or Friday, and keep the six year lengths', () => {
    // The postponements exist so that 1 Tishrei avoids those days and every year has 353 to 355 or 383 to 385 days.
    for (let year = 5600; year <= 5900; year++) {
      expect([0, 3, 5]).not.toContain(weekday(hebrewToJdn(year, 1, 1)));
      expect([353, 354, 355, 383, 384, 385]).toContain(yearLength(year));
    }
    // Year 1 began on Monday, the day of the molad BaHaRaD, with no postponement.
    expect(newYearDay(1).rules).toEqual([]);
    expect(weekday(hebrewToJdn(1, 1, 1))).toBe(1);
  });

  it('list the holidays', () => {
    const passover = hebrewHolidays(5785).find((item) => item.key === 'passover')!;
    expect(iso(passover.jdn)).toBe('2025-04-13');
    expect(() => hebrewToJdn(5785, 13, 1)).toThrow('month');
  });
});

describe('Islamic calendar', () => {
  it('put 1 Muharram 1446 on 2024-07-08 (civil) and 2024-07-07 (astronomical)', () => {
    expect(iso(islamicToJdn(1446, 1, 1))).toBe('2024-07-08');
    expect(iso(islamicToJdn(1446, 1, 1, 'astronomical'))).toBe('2024-07-07');
    expect(jdnToIslamic(g(2024, 7, 8))).toEqual({ year: 1446, month: 1, day: 1 });
    expect(() => islamicToJdn(0, 1, 1)).toThrow('islamicYear');
    expect(() => islamicToJdn(1446, 2, 30)).toThrow('day');
  });
});

describe('Solar Hijri calendar', () => {
  it('start 1403 on 2024-03-20 and 1404 on 2025-03-21, when the equinox came after noon', () => {
    const y1403 = nowruz(1403);
    expect(iso(y1403.jdn)).toBe('2024-03-20');
    // The equinox was at 06:36 Tehran time; within a few minutes is enough for the day.
    const morning = localTime(y1403.equinox, TEHRAN);
    expect(Math.abs(morning.hours * 60 + morning.minutes - (6 * 60 + 36))).toBeLessThanOrEqual(5);
    const y1404 = nowruz(1404);
    expect(y1404.afterNoon).toBe(true);
    expect(Math.abs(y1404.hours * 60 + y1404.minutes - (12 * 60 + 31))).toBeLessThanOrEqual(5);
    expect(iso(y1404.jdn)).toBe('2025-03-21');
    expect(persianLeap(1403)).toBe(true);
    expect(persianLeap33(1403)).toBe(true);
    expect(jdnToPersian(g(2025, 3, 21))).toEqual({ year: 1404, month: 1, day: 1 });
  });
});

describe('Chinese calendar', () => {
  it('find the Spring Festival of 2023 to 2026', () => {
    expect([2023, 2024, 2025, 2026].map((year) => iso(springFestival(year)))).toEqual([
      '2023-01-22',
      '2024-02-10',
      '2025-01-29',
      '2026-02-17',
    ]);
  });

  it('find the leap fourth month in 2020 and the leap second month in 2023', () => {
    expect(chineseSui(2020).find((month) => month.leap)?.number).toBe(4);
    expect(chineseSui(2023).find((month) => month.leap)?.number).toBe(2);
    expect(chineseSui(2024).some((month) => month.leap)).toBe(false);
  });

  it('name years and days and place Qingming and Mid-Autumn', () => {
    // 2024 was jiachen (stem 0, branch 4: the dragon).
    expect(yearStemBranch(2024)).toEqual({ stem: 0, branch: 4 });
    expect(daySexagenary(2451545)).toBe(54);
    expect(iso(qingming(2024))).toBe('2024-04-04');
    const midAutumn = chineseSui(2024).find((month) => month.number === 8 && !month.leap)!.start + 14;
    expect(iso(midAutumn)).toBe('2024-09-17');
    expect(jdnToChinese(g(2024, 2, 10))).toEqual({ year: 2024, month: 1, leap: false, day: 1 });
    expect(() => chineseSui(1500)).toThrow('chineseYear');
  });
});

describe('other calendars', () => {
  it('give 13.0.0.0.0 4 Ahau 3 Kankin for 2012-12-21', () => {
    const maya = jdnToMaya(g(2012, 12, 21));
    expect(maya.longCount).toEqual([13, 0, 0, 0, 0]);
    expect(maya.tzolkin).toEqual({ number: 4, name: 19 });
    expect(maya.haab).toEqual({ day: 3, month: 13 });
    expect(mayaToJdn([13, 0, 0, 0, 0])).toBe(g(2012, 12, 21));
    expect(() => mayaToJdn([13, 0, 0, 18, 0])).toThrow('maya');
  });

  it('name Reiwa 1 and Heisei 1', () => {
    expect(japaneseEra(g(2019, 5, 1))).toEqual({ key: 'reiwa', year: 1 });
    expect(japaneseEra(g(2019, 4, 30))).toEqual({ key: 'heisei', year: 31 });
    expect(japaneseEra(g(1989, 1, 8))).toEqual({ key: 'heisei', year: 1 });
    expect(japaneseEra(g(1850, 1, 1))).toBeNull();
  });

  it('put 1 Meskerem 2017 on 2024-09-11', () => {
    expect(jdnToNile('ethiopian', g(2024, 9, 11))).toEqual({ year: 2017, month: 1, day: 1 });
    expect(nileToJdn('ethiopian', 2017, 1, 1)).toBe(g(2024, 9, 11));
    // The Coptic year is 276 years behind: 1 Thout 1741 on the same day.
    expect(jdnToNile('coptic', g(2024, 9, 11))).toEqual({ year: 1741, month: 1, day: 1 });
    expect(() => nileToJdn('ethiopian', 2017, 13, 6)).toThrow('day');
  });

  it('call 16 March a.d. XVII Kal. Apr.', () => {
    expect(romanDay({ year: 44, month: 3, day: 16 })).toEqual({ anchor: 'kalends', month: 4, count: 17, bis: false });
    expect(roman(17)).toBe('XVII');
    expect(romanDay({ year: -43, month: 3, day: 15 })).toEqual({ anchor: 'ides', month: 3, count: 1, bis: false });
    expect(romanDay({ year: 4, month: 2, day: 24 }).bis).toBe(true);
    expect(romanDay({ year: 4, month: 2, day: 23 }).count).toBe(7);
  });

  it('start the French Republic on 1792-09-22 and Saka 1946 on 2024-03-21', () => {
    expect(iso(republicanToJdn(1, 1, 1))).toBe('1792-09-22');
    expect(jdnToRepublican(g(1792, 9, 22))).toEqual({ year: 1, month: 1, day: 1 });
    // Year III was leap, so year IV began on 23 September 1795; 18 Brumaire VIII, the coup, was 9 November 1799.
    expect(iso(republicanToJdn(4, 1, 1))).toBe('1795-09-23');
    expect(iso(republicanToJdn(8, 2, 18))).toBe('1799-11-09');
    expect(() => republicanToJdn(3, 13, 6)).not.toThrow();
    expect(() => republicanToJdn(4, 13, 6)).toThrow('day');
    // 1 Vendémiaire XIV was 23 September 1805; the Romme rule then runs on without a jump.
    expect(iso(republicanToJdn(14, 1, 1))).toBe('1805-09-23');
    expect(republicanToJdn(16, 1, 1) - republicanToJdn(15, 1, 1)).toBe(365);
    expect(iso(sakaToJdn(1946, 1, 1))).toBe('2024-03-21');
    expect(jdnToSaka(g(2024, 10, 3))).toEqual({ year: 1946, month: 7, day: 11 });
  });

  it('read an era table and count its years', () => {
    const eras = parseEras('1368-01-23, Hongwu\n1399-02-06, Jianwen');
    expect(eraOf(eras, g(1370, 6, 1))).toEqual({ name: 'Hongwu', year: 3 });
    expect(eraOf(eras, g(1300, 1, 1))).toBeNull();
    expect(() => parseEras('Hongwu')).toThrow('eraLine');
  });
});

describe('festivals in a year', () => {
  it('list the festivals of 2025 from five calendars in date order', () => {
    const list = festivals(2025);
    const on = (key: string) => iso(list.find((item) => item.key === key)!.jdn);
    expect(on('springFestival')).toBe('2025-01-29');
    expect(on('nowruz')).toBe('2025-03-21');
    expect(on('passover')).toBe('2025-04-13');
    expect(on('westernEaster')).toBe('2025-04-20');
    expect(on('orthodoxEaster')).toBe('2025-04-20');
    expect(on('ascension')).toBe('2025-05-29');
    expect(on('pentecost')).toBe('2025-06-08');
    expect(on('roshHashanah')).toBe('2025-09-23');
    expect(on('yomKippur')).toBe('2025-10-02');
    expect(on('midAutumn')).toBe('2025-10-06');
    expect(list.map((item) => item.jdn)).toEqual([...list.map((item) => item.jdn)].sort((a, b) => a - b));
    expect(() => festivals(2025.5)).toThrow('whole');
  });
});
