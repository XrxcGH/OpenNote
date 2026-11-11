// The dialog's working copy of a rule: plain strings and booleans a form edits, turned into a rule (or the problems
// that stop it) when the person saves. A rule keeps only what differs from the defaults, so files stay small.
import { EN_US, STORED, convertFormula, daysToIso, parseDate, parseIsoDate, parseLocaleNumber, syntaxOf } from '../../engine';
import type { Locale } from '../../engine';
import type { JsonObject } from '../../sheet/model';
import { parseTime } from '../../sheet/validation/operands';

export type RuleKind = 'any' | 'whole' | 'decimal' | 'list' | 'date' | 'time' | 'textLength' | 'custom' | 'checkbox';
export const KINDS: readonly RuleKind[] = [
  'any',
  'whole',
  'decimal',
  'list',
  'date',
  'time',
  'textLength',
  'custom',
  'checkbox',
];
export const OPS = [
  'between',
  'notBetween',
  'equal',
  'notEqual',
  'greater',
  'less',
  'greaterOrEqual',
  'lessOrEqual',
] as const;
export type Op = (typeof OPS)[number];
export type AlertStyle = 'stop' | 'warning' | 'information';

export interface Draft {
  kind: RuleKind;
  op: Op;
  a: string;
  b: string;
  listFrom: 'items' | 'range';
  itemsText: string;
  source: string;
  dropDown: boolean;
  checked: string;
  unchecked: string;
  ignoreBlank: boolean;
  showInput: boolean;
  inputTitle: string;
  inputText: string;
  showError: boolean;
  alert: AlertStyle;
  errorTitle: string;
  errorText: string;
}

/** The kinds that compare a value with `a` (and `b`). */
export const COMPARES: readonly RuleKind[] = ['whole', 'decimal', 'date', 'time', 'textLength'];

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const message = (v: unknown): { title: string; text: string } | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
    ? { title: str((v as JsonObject).title), text: str((v as JsonObject).text) }
    : null;

/** A rule's text (stored form: English syntax, "." decimals, ISO dates) as the reader's region writes it. */
function shownText(text: string, locale: Locale, formula = false): string {
  if (formula || text.startsWith('=')) {
    const out = convertFormula(text.replace(/^=/, ''), STORED, syntaxOf(locale));
    return typeof out === 'string' ? `${text.startsWith('=') ? '=' : ''}${out}` : text;
  }
  return /^-?\d+(\.\d+)?%?$/.test(text) ? text.replace(".", locale.decimal) : text;
}

/** What a person typed in a rule's field, in their region, as the stored form; null when it can't be read. */
function storedText(text: string, kind: RuleKind, locale: Locale): string | null {
  const t = text.trim();
  if (t.startsWith('=')) {
    const out = convertFormula(t.slice(1), syntaxOf(locale), STORED);
    return typeof out === 'string' ? `=${out}` : null;
  }
  if (kind === 'date') {
    const days = parseDate(t, locale.dateOrder) ?? parseIsoDate(t);
    if (days !== null) return daysToIso(days);
  }
  if (kind === 'time') {
    if (parseTime(t) !== null) return t;
  }
  const n = parseLocaleNumber(t, locale);
  if (n === null) return null;
  return `${n.value}${n.percent ? '%' : ''}`;
}

export function draftOf(rule?: JsonObject, locale: Locale = EN_US): Draft {
  const r = rule ?? {};
  const input = message(r.input);
  const error = message(r.error);
  const kind = KINDS.find((k) => k === r.kind) ?? (rule ? 'any' : 'whole');
  return {
    kind,
    op: OPS.find((o) => o === r.op) ?? 'between',
    a: shownText(str(r.a), locale, r.kind === 'custom'),
    b: shownText(str(r.b), locale),
    listFrom: typeof r.source === 'string' ? 'range' : 'items',
    itemsText: Array.isArray(r.items) ? r.items.filter((x) => typeof x === 'string').join('\n') : '',
    source: shownText(str(r.source), locale),
    dropDown: r.dropDown !== false,
    checked: str(r.checked, 'TRUE'),
    unchecked: str(r.unchecked, 'FALSE'),
    ignoreBlank: r.ignoreBlank !== false,
    showInput: input !== null,
    inputTitle: input?.title ?? '',
    inputText: input?.text ?? '',
    showError: error !== null || r.alert !== undefined,
    alert: r.alert === 'warning' || r.alert === 'information' ? r.alert : 'stop',
    errorTitle: error?.title ?? '',
    errorText: error?.text ?? '',
  };
}

export type Problem = 'ranges' | 'items' | 'operand' | 'order' | 'formula' | 'limit';

/** The items a draft types: one per line, trimmed, without blanks or repeats, at most 1,000 of 255 characters. */
export function itemsOf(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const item = line.trim().slice(0, 255);
    if (item !== '' && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out.slice(0, 1000);
}

const NUMBER = /^-?\d+(\.\d+)?$/;

/** The rule a draft stands for over `ranges`, or what is wrong with it. */
export function ruleOf(
  d: Draft,
  ranges: readonly JsonObject[],
  locale: Locale = EN_US,
): { rule: JsonObject } | { problems: Problem[] } {
  const problems: Problem[] = [];
  if (ranges.length === 0) problems.push('ranges');
  const rule: JsonObject = { ranges: ranges.map((r) => ({ ...r })), kind: d.kind };
  if (COMPARES.includes(d.kind)) {
    const two = d.op === 'between' || d.op === 'notBetween';
    rule.op = d.op;
    const a = storedText(d.a, d.kind, locale);
    const b = two ? storedText(d.b, d.kind, locale) : null;
    rule.a = a ?? d.a.trim();
    if (a === null || (two && b === null)) problems.push('operand');
    if (two) rule.b = b ?? d.b.trim();
    if (two && a !== null && b !== null && NUMBER.test(a) && NUMBER.test(b) && Number(a) > Number(b)) problems.push('order');
  } else if (d.kind === 'custom') {
    const typed = d.a.trim();
    const out = convertFormula(typed.replace(/^=/, ''), syntaxOf(locale), STORED);
    rule.a = typeof out === 'string' ? `${typed.startsWith('=') ? '=' : ''}${out}` : typed;
    if (typed === '' || typeof out !== 'string') problems.push('formula');
  } else if (d.kind === 'list') {
    if (d.listFrom === 'items') {
      const items = itemsOf(d.itemsText);
      if (items.length === 0) problems.push('items');
      rule.items = items;
    } else {
      const src = d.source.trim();
      const stored = src.startsWith('=') ? storedText(src, 'list', locale) : src;
      rule.source = stored ?? src;
      if (src === '' || stored === null) problems.push('items');
    }
    if (!d.dropDown) rule.dropDown = false;
  } else if (d.kind === 'checkbox') {
    if (d.checked !== 'TRUE') rule.checked = d.checked;
    if (d.unchecked !== 'FALSE') rule.unchecked = d.unchecked;
  }
  if (!d.ignoreBlank) rule.ignoreBlank = false;
  if (d.showInput && (d.inputTitle !== '' || d.inputText !== ''))
    rule.input = { title: d.inputTitle.slice(0, 32), text: d.inputText.slice(0, 255) };
  if (d.showError) {
    if (d.alert !== 'stop') rule.alert = d.alert;
    if (d.errorTitle !== '' || d.errorText !== '')
      rule.error = { title: d.errorTitle.slice(0, 32), text: d.errorText.slice(0, 255) };
  }
  return problems.length > 0 ? { problems } : { rule };
}
