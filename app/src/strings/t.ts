// The typed translation function (ARCHITECTURE.md section 19.2). Parameter names come from the message text at
// the type level, so a missing, extra, or misspelled parameter fails type-checking at no runtime cost.
// The runtime formatter covers {name} and a small ICU subset: plural (=0, one, other, and #) and select.

import { en } from './en';
import type { ParamsArg } from './params';
import { pseudoize } from './pseudo';

type Messages = typeof en;

/** Every message key, such as 'theme.darkMode'. */
export type DottedKeys<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : DottedKeys<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = DottedKeys<Messages>;

/** The message text at a key, as a string literal type. */
export type MessageAt<K extends string, T = Messages> = K extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? MessageAt<Rest, T[Head]>
    : never
  : K extends keyof T
    ? T[K]
    : never;

export type { Params, ParamsArg } from './params';

type Part =
  | { kind: 'text'; text: string }
  | { kind: 'arg'; name: string }
  | { kind: 'plural' | 'select'; name: string; branches: Record<string, Part[]> };

const cache = new Map<string, Part[]>();
const plurals = new Intl.PluralRules('en-US');
const numbers = new Intl.NumberFormat('en-US');
let pseudo = false;

/** The index of the brace that closes the one at `open`. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  throw new Error(`Unclosed brace in message: ${text}`);
}

function parseBranches(text: string): Record<string, Part[]> {
  const branches: Record<string, Part[]> = {};
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const end = closing(text, open);
    branches[text.slice(i, open).trim()] = parse(text.slice(open + 1, end));
    i = end + 1;
  }
  return branches;
}

function parse(message: string): Part[] {
  const parts: Part[] = [];
  let i = 0;
  while (i < message.length) {
    const open = message.indexOf('{', i);
    if (open === -1) {
      parts.push({ kind: 'text', text: message.slice(i) });
      break;
    }
    if (open > i) parts.push({ kind: 'text', text: message.slice(i, open) });
    const end = closing(message, open);
    const [name, kind, ...rest] = message.slice(open + 1, end).split(',');
    const trimmedKind = kind?.trim();
    if (trimmedKind === 'plural' || trimmedKind === 'select') {
      parts.push({ kind: trimmedKind, name: name.trim(), branches: parseBranches(rest.join(',')) });
    } else {
      parts.push({ kind: 'arg', name: name.trim() });
    }
    i = end + 1;
  }
  return parts;
}

function render(parts: readonly Part[], values: Record<string, unknown>, count?: number): string {
  return parts
    .map((part) => {
      if (part.kind === 'text')
        return count === undefined ? part.text : part.text.replaceAll('#', numbers.format(count));
      const value = values[part.name];
      if (part.kind === 'arg') return typeof value === 'number' ? numbers.format(value) : String(value);
      if (part.kind === 'select') return render(part.branches[String(value)] ?? part.branches.other ?? [], values);
      const n = Number(value);
      const branch = part.branches[`=${n}`] ?? part.branches[plurals.select(n)] ?? part.branches.other ?? [];
      return render(branch, values, n);
    })
    .join('');
}

function lookup(key: string): string {
  const value = key.split('.').reduce<unknown>((node, segment) => (node as Record<string, unknown>)?.[segment], en);
  if (typeof value !== 'string') throw new Error(`No message with the key "${key}"`);
  return value;
}

/** Formats a message in a template: placeholders, plural, and select. */
export function formatMessage(message: string, values: Record<string, unknown> = {}): string {
  let parts = cache.get(message);
  if (!parts) {
    parts = parse(message);
    cache.set(message, parts);
  }
  return render(parts, values);
}

export function t<K extends MessageKey>(key: K, ...values: ParamsArg<MessageAt<K>>): string {
  const text = formatMessage(lookup(key), ((values as unknown[])[0] ?? {}) as Record<string, unknown>);
  return pseudo ? pseudoize(text) : text;
}

/** Test builds can switch every string to the pseudo-locale, which finds clipped or untranslated text. */
export function setPseudoLocale(on: boolean): void {
  pseudo = on;
}
