// From a date typed in one calendar to its Julian Day Number, and from a JDN to the date in every calendar, as
// words. The tool shows the rows and steps this builds.
import '../text';
import { t } from '../../../../strings/t';
import { fixed, num } from '../ui/attempt';
import { ht } from '../ui/parts';
import {
  hebrewMonthKey,
  hebrewToJdn,
  jdnToHebrew,
  monthsElapsed,
  moladTishrei,
  newYearDay,
  newYearJdn,
  yearKind,
  yearLength,
} from './hebrew';
import { islamicToJdn, jdnToIslamic } from './islamic';
import { dayOfYear, gregorianToJdn, isoWeek, jdnToGregorian, jdnToJulian, julianToJdn, weekday } from './jdn';
import type { Ymd } from './jdn';
import {
  chineseSui,
  chineseToJdn,
  daySexagenary,
  jdnToChinese,
  jdnToPersian,
  nowruz,
  persianLeap,
  persianLeap33,
  persianToJdn,
  yearStemBranch,
} from './lunisolar';
import {
  abUrbeCondita,
  eraOf,
  imperialYear,
  japaneseEra,
  jdnToMaya,
  jdnToNile,
  jdnToRepublican,
  jdnToSaka,
  jdnToWandering,
  mayaToJdn,
  nileToJdn,
  olympiad,
  republicanToJdn,
  roman,
  romanDay,
  sakaToJdn,
} from './others';
import type { Era } from './others';

export const SYSTEMS = [
  'gregorian',
  'julian',
  'hebrew',
  'islamic',
  'islamicAstro',
  'persian',
  'chinese',
  'coptic',
  'ethiopian',
  'republican',
  'saka',
  'maya',
  'jdn',
] as const;
export type System = (typeof SYSTEMS)[number];

export interface DateInput {
  system: System;
  year: string;
  month: string;
  day: string;
  leap: boolean;
  /** The Long Count or the JDN, for those two systems. */
  text: string;
}

const c = 'kitHumanities.calendars';
const names = (key: string): string[] => ht(`calendars.${key}`).split('|');
const whole = (text: string): number => {
  const value = num(text);
  if (!Number.isInteger(value)) throw new Error('whole');
  return value;
};

export function toJdn(input: DateInput): number {
  if (input.system === 'jdn') return whole(input.text);
  if (input.system === 'maya') return mayaToJdn(input.text.trim().split('.').map(whole));
  const [year, month, day] = [whole(input.year), whole(input.month), whole(input.day)];
  switch (input.system) {
    case 'gregorian':
      return gregorianToJdn({ year, month, day });
    case 'julian':
      return julianToJdn({ year, month, day });
    case 'hebrew':
      return hebrewToJdn(year, month, day);
    case 'islamic':
      return islamicToJdn(year, month, day);
    case 'islamicAstro':
      return islamicToJdn(year, month, day, 'astronomical');
    case 'persian':
      return persianToJdn(year, month, day);
    case 'chinese':
      return chineseToJdn(year, month, input.leap, day);
    case 'coptic':
    case 'ethiopian':
      return nileToJdn(input.system, year, month, day);
    case 'republican':
      return republicanToJdn(year, month, day);
    case 'saka':
      return sakaToJdn(year, month, day);
  }
}

/** A Gregorian or Julian date in words, with BCE for astronomical years of 0 and below. */
export function westernText(date: Ymd): string {
  const month = names('months.gregorian')[date.month - 1]!;
  if (date.year <= 0) return t(`${c}.value.bce`, { day: date.day, month, year: String(1 - date.year) });
  return t(`${c}.value.date`, { day: date.day, month, year: String(date.year) });
}

export const isoText = (jdn: number): string => {
  const d = jdnToGregorian(jdn);
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
};

function romanText(date: Ymd): string {
  const day = romanDay(date);
  const month = names('roman.months')[day.month - 1]!;
  let name: string;
  if (day.bis) name = t(`${c}.roman.bis`);
  else {
    const anchor = t(`${c}.roman.${day.anchor}`, { month });
    name =
      day.count === 1
        ? anchor
        : day.count === 2
          ? t(`${c}.roman.pridie`, { anchor })
          : t(`${c}.roman.before`, { count: roman(day.count), anchor });
  }
  const auc = abUrbeCondita(date.year);
  return t(`${c}.value.roman`, { roman: name, auc: auc >= 1 ? roman(Math.min(auc, 3999)) : String(auc) });
}

const monthDate = (key: string, date: Ymd, months: string[]) =>
  ht(`calendars.value.${key}`, {
    day: date.day,
    month: months[date.month - 1] ?? String(date.month),
    year: String(date.year),
  });

/** Each calendar's line for a JDN; a calendar that cannot show the day says so. */
export function rowsFor(jdn: number, eras: readonly Era[]): [string, string][] {
  const outside = t(`${c}.value.outside`);
  const row = (key: string, make: () => string): [string, string] => {
    let value: string;
    try {
      value = make();
    } catch {
      value = outside;
    }
    return [ht(`calendars.rows.${key}`), value];
  };
  const gregorian = jdnToGregorian(jdn);
  const rows: [string, string][] = [
    row('jdn', () => String(jdn)),
    row('weekday', () => names('weekdays')[weekday(jdn)]!),
    row('gregorian', () => westernText(gregorian)),
    row('julian', () => westernText(jdnToJulian(jdn))),
    row('iso', () => t(`${c}.value.iso`, { ...isoWeek(jdn), year: String(isoWeek(jdn).year) })),
    row('dayOfYear', () => String(dayOfYear(jdn))),
    row('hebrew', () => {
      const h = jdnToHebrew(jdn);
      return t(`${c}.value.hebrew`, {
        day: h.day,
        month: ht(`calendars.months.hebrew.${hebrewMonthKey(h.year, h.month)}`),
        year: String(h.year),
      });
    }),
    row('islamic', () => monthDate('islamic', jdnToIslamic(jdn), names('months.islamic'))),
    row('islamicAstro', () => monthDate('islamic', jdnToIslamic(jdn, 'astronomical'), names('months.islamic'))),
    row('persian', () => monthDate('persian', jdnToPersian(jdn), names('months.persian'))),
    row('chinese', () => {
      const date = jdnToChinese(jdn);
      const { stem, branch } = yearStemBranch(date.year);
      const daily = daySexagenary(jdn);
      return t(`${c}.value.${date.leap ? 'chineseLeap' : 'chinese'}`, {
        month: date.month,
        day: date.day,
        animal: names('animals')[branch]!,
        stem: names('stems')[stem]!,
        branch: names('branches')[branch]!,
        dayStem: names('stems')[daily % 10]!,
        dayBranch: names('branches')[daily % 12]!,
      });
    }),
    row('japanese', () => {
      const era = japaneseEra(jdn);
      if (!era) throw new Error('beforeEpoch');
      return t(`${c}.value.japanese`, {
        era: ht(`calendars.japaneseEras.${era.key}`),
        year: era.year,
        imperial: String(imperialYear(gregorian.year)),
      });
    }),
    row('coptic', () => monthDate('date', jdnToNile('coptic', jdn), names('months.coptic'))),
    row('ethiopian', () => monthDate('date', jdnToNile('ethiopian', jdn), names('months.ethiopian'))),
    row('republican', () => monthDate('date', jdnToRepublican(jdn), names('months.republican'))),
    row('saka', () => monthDate('date', jdnToSaka(jdn), names('months.saka'))),
    row('maya', () => {
      const maya = jdnToMaya(jdn);
      return t(`${c}.value.maya`, {
        longCount: maya.longCount.join('.'),
        tzolkinNumber: maya.tzolkin.number,
        tzolkin: names('tzolkin')[maya.tzolkin.name]!,
        haabDay: maya.haab.day,
        haab: names('haab')[maya.haab.month]!,
      });
    }),
    row('roman', () => romanText(jdnToJulian(jdn))),
    row('olympiad', () => t(`${c}.value.olympiad`, olympiad(jdnToJulian(jdn).year))),
    row('egyptian', () => monthDate('date', jdnToWandering('egyptian', jdn), names('months.egyptian'))),
    row('armenian', () => monthDate('date', jdnToWandering('armenian', jdn), names('months.armenian'))),
  ];
  const era = eras.length > 0 ? eraOf(eras, jdn) : null;
  if (era) rows.push([ht('calendars.rows.era'), t(`${c}.value.era`, { name: era.name, year: String(era.year) })]);
  return rows;
}

/** The worked steps for a JDN: the JDN, the weekday, and how the Hebrew, Islamic, Persian, Chinese, Maya, and Roman
 * dates were found. A calendar outside its range is left out. */
export function stepsFor(jdn: number): string[] {
  const steps = [
    t(`${c}.steps.jdn`, { jdn: String(jdn) }),
    t(`${c}.steps.gregorian`),
    t(`${c}.steps.weekday`, { value: weekday(jdn) }),
  ];
  const tryPush = (make: () => string | string[]) => {
    try {
      const made = make();
      steps.push(...(Array.isArray(made) ? made : [made]));
    } catch {
      // That calendar does not reach this day.
    }
  };
  tryPush(() => {
    const { year } = jdnToHebrew(jdn);
    const molad = moladTishrei(year);
    const { rules } = newYearDay(year);
    const vars = {
      jdn: String(newYearJdn(year)),
      length: yearLength(year),
      kind: ht(`calendars.kinds.${yearKind(year)}`),
    };
    return [
      t(`${c}.steps.hebrew`, {
        year: String(year),
        months: monthsElapsed(year),
        weekday: names('weekdays')[molad.weekday]!,
        hours: molad.hours,
        parts: molad.parts,
      }),
      rules.length === 0
        ? t(`${c}.steps.hebrewNone`, vars)
        : t(`${c}.steps.hebrewRules`, {
            ...vars,
            rules: rules.map((rule) => ht(`calendars.rules.${rule}`)).join(', '),
          }),
    ];
  });
  tryPush(() => (jdnToIslamic(jdn), t(`${c}.steps.islamic`)));
  tryPush(() => {
    const { year } = jdnToPersian(jdn);
    const start = nowruz(year);
    return t(`${c}.steps.persian`, {
      year: String(year),
      gregorian: String(year + 621),
      time: `${String(start.hours).padStart(2, '0')}:${String(start.minutes).padStart(2, '0')}`,
      side: ht(`calendars.${start.afterNoon ? 'after' : 'before'}`),
      start: isoText(start.jdn),
      rule: ht(`calendars.${persianLeap33(year) ? 'leapYes' : 'leapNo'}`),
      sky: ht(`calendars.${persianLeap(year) ? 'leapYes' : 'leapNo'}`),
    });
  });
  tryPush(() => {
    const gregorianYear = jdnToChinese(jdn).year;
    const sui = chineseSui(gregorianYear);
    return t(`${c}.steps.chinese`, {
      count: sui.length,
      leap: ht(`calendars.${sui.some((m) => m.leap) ? 'hasLeap' : 'noLeap'}`),
    });
  });
  tryPush(() => (jdnToMaya(jdn), t(`${c}.steps.maya`, { days: fixed(jdn - 584283, 0) })));
  steps.push(t(`${c}.steps.roman`));
  return steps;
}
