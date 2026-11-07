// Descriptions of the date and time functions, one line per function and one per argument, in our own words.
// Owner: tables:fn-datetime (B10). Keys are function names in capitals and argument names as in the signature.

interface FnText {
  readonly summary: string;
  readonly args: Readonly<Record<string, string>>;
}

const date = 'A date, as a serial number or date text.';
const dates = { start: 'The first date.', end: 'The last date.' };
const holidays = 'Dates to treat as days off, in a range or typed directly.';
const weekend = 'Which days are days off: a code 1 to 7 or 11 to 17, or seven digits of 0 and 1 starting Monday.';

export const fnDateTime: Readonly<Record<string, FnText>> = {
  TODAY: { summary: 'Today as a date. It updates whenever the sheet recalculates.', args: {} },
  NOW: { summary: 'The date and the time right now. It updates whenever the sheet recalculates.', args: {} },
  DATE: {
    summary: 'Builds a date from a year, a month, and a day. Months and days that run over roll into the next period.',
    args: {
      year: 'The year. 0 to 99 mean 1900 to 1999.',
      month: 'The month, 1 to 12 or beyond.',
      day: 'The day of the month.',
    },
  },
  YEAR: { summary: 'The year of a date.', args: { date } },
  MONTH: { summary: 'The month of a date, 1 to 12.', args: { date } },
  DAY: { summary: 'The day of the month of a date, 1 to 31.', args: { date } },
  HOUR: { summary: 'The hour of a time, 0 to 23.', args: { time: 'A time, as a fraction of a day or time text.' } },
  MINUTE: { summary: 'The minute of a time, 0 to 59.', args: { time: 'A time, as a fraction of a day or time text.' } },
  SECOND: { summary: 'The second of a time, 0 to 59.', args: { time: 'A time, as a fraction of a day or time text.' } },
  TIME: {
    summary: 'Builds a time of day, as a fraction of a day. More than 24 hours wraps around.',
    args: { hour: 'Hours, 0 to 32767.', minute: 'Minutes, 0 to 32767.', second: 'Seconds, 0 to 32767.' },
  },
  TIMEVALUE: {
    summary: 'Reads time text and gives it as a fraction of a day.',
    args: { text: 'Text such as "6:35 PM".' },
  },
  DATEVALUE: { summary: 'Reads date text and gives its serial number.', args: { text: 'Text such as "2024-01-31".' } },
  DAYS: {
    summary: 'The number of days from one date to another.',
    args: { end: 'The later date.', start: 'The earlier date.' },
  },
  DAYS360: {
    summary: 'Days between two dates on a year of twelve 30-day months.',
    args: { ...dates, european: 'TRUE for the European rule. FALSE or left out for the US rule.' },
  },
  EDATE: {
    summary: 'The date a number of months before or after another, on the same day when the month has it.',
    args: { start: 'The starting date.', months: 'Months to add. A negative number goes back.' },
  },
  EOMONTH: {
    summary: 'The last day of the month, a number of months before or after a date.',
    args: { start: 'The starting date.', months: 'Months to add. 0 gives the month of the date.' },
  },
  WEEKDAY: {
    summary: 'The day of the week of a date as a number.',
    args: {
      date,
      type: '1 counts Sunday as 1, 2 counts Monday as 1, 3 counts Monday as 0, and 11 to 17 start on Monday to Sunday.',
    },
  },
  WEEKNUM: {
    summary: 'The week of the year of a date. Week 1 is the week that holds January 1.',
    args: { date, type: 'The day a week starts on, as for WEEKDAY, or 21 for ISO weeks.' },
  },
  ISOWEEKNUM: { summary: 'The ISO week of the year, where week 1 holds the first Thursday.', args: { date } },
  NETWORKDAYS: {
    summary: 'Working days between two dates, counting both ends, with Saturday and Sunday off.',
    args: { ...dates, holidays },
  },
  'NETWORKDAYS.INTL': {
    summary: 'Working days between two dates, counting both ends, with weekend days you choose.',
    args: { ...dates, weekend, holidays },
  },
  WORKDAY: {
    summary: 'The date a number of working days from a start date, with Saturday and Sunday off.',
    args: { start: 'The starting date.', days: 'Working days to move. A negative number goes back.', holidays },
  },
  'WORKDAY.INTL': {
    summary: 'The date a number of working days from a start date, with weekend days you choose.',
    args: {
      start: 'The starting date.',
      days: 'Working days to move. A negative number goes back.',
      weekend,
      holidays,
    },
  },
  DATEDIF: {
    summary: 'The difference between two dates in whole years, months, or days.',
    args: {
      ...dates,
      unit: '"Y" years, "M" months, "D" days, "MD" days ignoring months and years, "YM" months ignoring years, "YD" days ignoring years.',
    },
  },
  YEARFRAC: {
    summary: 'The part of a year between two dates.',
    args: {
      ...dates,
      basis: '0 US 30/360, 1 actual days over actual year, 2 actual over 360, 3 actual over 365, 4 European 30/360.',
    },
  },
  EPOCHTODATE: {
    summary: 'Turns a Unix timestamp into a date and time in UTC.',
    args: { timestamp: 'Time since 1970-01-01 UTC.', unit: '1 for seconds, 2 for milliseconds, 3 for microseconds.' },
  },
};
