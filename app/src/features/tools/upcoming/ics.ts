// A reader for local calendar files in iCalendar (.ics) format. It reads events (VEVENT) and to-dos (VTODO) with
// SUMMARY, UID, DTSTART, DUE, STATUS, RRULE, EXDATE, and RECURRENCE-ID, and skips everything else, such as alarms
// and time zone definitions. It doesn't fetch anything. The text comes from a file the user picked.

import { parseIcsTime, type IcsParams, type IcsTime } from './icsTime';
import { parseRule, type Recurrence } from './recurrence';

export interface IcsComponent {
  kind: 'event' | 'todo';
  uid: string;
  title: string;
  /** When an event starts or a to-do is due. A to-do with no DUE uses its DTSTART. Null if it has neither. */
  when: IcsTime | null;
  completed: boolean;
  canceled: boolean;
  /** The repeat rule, if it is a daily or weekly one. */
  rule: Recurrence | null;
  /** The frequency of a repeat rule that isn't supported, such as "monthly". The item then shows once. */
  ruleNote: string | null;
  /** Occurrences the series skips. */
  exceptions: IcsTime[];
  /** Set on an edited occurrence of a repeating series. It says which occurrence this one replaces. */
  replaces: IcsTime | null;
}

export interface IcsCalendar {
  components: IcsComponent[];
  /** The number of lines or components that could not be read. */
  skipped: number;
}

interface Property {
  name: string;
  params: IcsParams;
  value: string;
}

interface Open {
  type: string;
  props: Property[];
}

/** Joins folded lines, where a line break followed by a space or tab continues the line. */
function unfold(text: string): string[] {
  const joined = text.replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '');
  return joined.split('\n').filter((line) => line.trim() !== '');
}

/** Splits on a separator that is not inside double quotes. */
function splitOutsideQuotes(text: string, separator: string): string[] {
  const parts: string[] = [];
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '"') quoted = !quoted;
    else if (text[i] === separator && !quoted) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  return [...parts, text.slice(start)];
}

function parseLine(line: string): Property | null {
  const [head, ...rest] = splitOutsideQuotes(line, ':');
  if (rest.length === 0 || head === '') return null;
  const [name, ...rawParams] = splitOutsideQuotes(head, ';');
  const params: Record<string, string> = {};
  for (const raw of rawParams) {
    const at = raw.indexOf('=');
    if (at > 0) params[raw.slice(0, at).toUpperCase()] = raw.slice(at + 1).replace(/^"|"$/g, '');
  }
  return { name: name.trim().toUpperCase(), params, value: rest.join(':') };
}

/** Undoes the escapes in text values: "\n" is a line break, and "\," "\;" and "\\" are the plain characters. */
function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_, char: string) => (char === 'n' || char === 'N' ? '\n' : char));
}

function timeOf(props: Property[], name: string): IcsTime | null {
  const found = props.find((p) => p.name === name);
  return found ? parseIcsTime(found.value, found.params) : null;
}

function build(open: Open, index: number): IcsComponent | null {
  const { props } = open;
  const kind = open.type === 'VEVENT' ? 'event' : 'todo';
  const value = (name: string) => props.find((p) => p.name === name)?.value;
  const start = timeOf(props, 'DTSTART');
  const when = kind === 'event' ? start : (timeOf(props, 'DUE') ?? start);
  if (kind === 'event' && start === null) return null;
  const status = (value('STATUS') ?? '').trim().toUpperCase();
  const rrule = when !== null && value('RRULE') !== undefined ? parseRule(value('RRULE') ?? '') : null;
  const done =
    status === 'COMPLETED' || value('COMPLETED') !== undefined || value('PERCENT-COMPLETE')?.trim() === '100';
  return {
    kind,
    uid: value('UID')?.trim() || `ics-${index + 1}`,
    title: unescapeText(value('SUMMARY') ?? '').trim(),
    when,
    completed: kind === 'todo' && done,
    canceled: status === 'CANCELLED',
    rule: rrule?.rule ?? null,
    ruleNote: rrule?.note ?? null,
    exceptions: props
      .filter((p) => p.name === 'EXDATE')
      .flatMap((p) => p.value.split(',').map((v) => parseIcsTime(v, p.params)))
      .filter((t): t is IcsTime => t !== null),
    replaces: timeOf(props, 'RECURRENCE-ID'),
  };
}

/** Reads the events and to-dos in an .ics file. Lines it can't read are counted in `skipped`, never thrown. */
export function parseIcs(text: string): IcsCalendar {
  const stack: Open[] = [];
  const components: IcsComponent[] = [];
  let skipped = 0;
  for (const line of unfold(text)) {
    const prop = parseLine(line);
    if (!prop) {
      skipped += 1;
    } else if (prop.name === 'BEGIN') {
      stack.push({ type: prop.value.trim().toUpperCase(), props: [] });
    } else if (prop.name === 'END') {
      const closed = stack.pop();
      if (closed?.type !== 'VEVENT' && closed?.type !== 'VTODO') continue;
      const component = build(closed, components.length);
      if (component) components.push(component);
      else skipped += 1;
    } else {
      stack.at(-1)?.props.push(prop);
    }
  }
  return { components, skipped };
}
