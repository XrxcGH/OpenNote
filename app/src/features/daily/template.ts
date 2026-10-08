// The templates of daily, weekly, monthly, and yearly notes. A template is Markdown with a few placeholders, kept on
// this device. The typed-notes template engine can take over from here when it lands; the note's content is only
// what this module returns for a day.
import { isoWeek, toDate } from './dates';
import type { DailyKind, Ymd } from './dates';

export type Templates = Record<DailyKind, string>;

export const DEFAULT_TEMPLATES: Templates = {
  day: '## {longDate}\n\n',
  week: '## Week {week}, {weekYear}\n\n',
  month: '## {monthName} {year}\n\n',
  year: '## {year}\n\n',
};

/** The placeholders a template may use, for the editor's help line. */
export const PLACEHOLDERS = [
  '{date}',
  '{longDate}',
  '{weekday}',
  '{week}',
  '{weekYear}',
  '{monthName}',
  '{year}',
] as const;

const STORAGE_KEY = 'opennote.daily.templates';

export function loadTemplates(): Templates {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (raw && typeof raw === 'object') {
      const saved = raw as Partial<Record<DailyKind, unknown>>;
      const pick = (kind: DailyKind) =>
        typeof saved[kind] === 'string' ? (saved[kind] as string) : DEFAULT_TEMPLATES[kind];
      return { day: pick('day'), week: pick('week'), month: pick('month'), year: pick('year') };
    }
  } catch {
    // Without storage the defaults serve.
  }
  return { ...DEFAULT_TEMPLATES };
}

export function saveTemplates(templates: Templates): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  } catch {
    // The templates last for this session only.
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The template with its placeholders filled in for the day. Unknown placeholders stay as typed. */
export function renderTemplate(template: string, day: Ymd): string {
  const date = toDate(day);
  const week = isoWeek(day);
  const values: Record<string, string> = {
    date: `${day.y}-${pad(day.m)}-${pad(day.d)}`,
    longDate: date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    weekday: date.toLocaleDateString('en-US', { weekday: 'long' }),
    week: String(week.week),
    weekYear: String(week.year),
    monthName: date.toLocaleDateString('en-US', { month: 'long' }),
    year: String(day.y),
  };
  return template.replace(/\{(\w+)\}/g, (all, name: string) => values[name] ?? all);
}
