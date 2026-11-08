// The dialog's working copy of a rule: plain strings and booleans a form edits, turned into a rule (or the problems
// that stop it) when the person saves. A rule keeps only what differs from the defaults, so files stay small.
import type { JsonObject } from '../../sheet/model';

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

export function draftOf(rule?: JsonObject): Draft {
  const r = rule ?? {};
  const input = message(r.input);
  const error = message(r.error);
  const kind = KINDS.find((k) => k === r.kind) ?? (rule ? 'any' : 'whole');
  return {
    kind,
    op: OPS.find((o) => o === r.op) ?? 'between',
    a: str(r.a),
    b: str(r.b),
    listFrom: typeof r.source === 'string' ? 'range' : 'items',
    itemsText: Array.isArray(r.items) ? r.items.filter((x) => typeof x === 'string').join('\n') : '',
    source: str(r.source),
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

export type Problem = 'ranges' | 'items' | 'operand' | 'order' | 'formula';

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
export function ruleOf(d: Draft, ranges: readonly JsonObject[]): { rule: JsonObject } | { problems: Problem[] } {
  const problems: Problem[] = [];
  if (ranges.length === 0) problems.push('ranges');
  const rule: JsonObject = { ranges: ranges.map((r) => ({ ...r })), kind: d.kind };
  if (COMPARES.includes(d.kind)) {
    const two = d.op === 'between' || d.op === 'notBetween';
    rule.op = d.op;
    rule.a = d.a.trim();
    if (rule.a === '' || (two && d.b.trim() === '')) problems.push('operand');
    if (two) rule.b = d.b.trim();
    if (two && NUMBER.test(d.a.trim()) && NUMBER.test(d.b.trim()) && Number(d.a) > Number(d.b)) problems.push('order');
  } else if (d.kind === 'custom') {
    rule.a = d.a.trim();
    if (rule.a === '') problems.push('formula');
  } else if (d.kind === 'list') {
    if (d.listFrom === 'items') {
      const items = itemsOf(d.itemsText);
      if (items.length === 0) problems.push('items');
      rule.items = items;
    } else {
      rule.source = d.source.trim();
      if (rule.source === '') problems.push('items');
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
