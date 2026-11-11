// The members source (DESIGN 10.2), after a `.`. A literal, a constructor call, or an annotation shows the
// receiver's type, and its methods are offered. Known modules offer their members. Otherwise the names used after
// the same receiver elsewhere in the file are offered.

import { family, MODULE_MEMBERS, TYPE_MEMBERS } from './tables';

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The receiver before the `.` that ends at `dot`: a dotted name such as `os.path`, or a literal's type marker. */
export function receiverAt(text: string, dot: number): string | null {
  if (text[dot] !== '.') return null;
  const before = text.slice(Math.max(0, dot - 200), dot);
  if (/["'`]$/.test(before)) return '"';
  const name = /[\p{L}_$][\p{L}\p{N}_$]*(?:\.[\p{L}_$][\p{L}\p{N}_$]*)*$/u.exec(before);
  return name ? name[0] : null;
}

function pythonType(text: string, name: string): string | null {
  const pattern = new RegExp(`^[ \\t]*${escape(name)}[ \\t]*(?::[ \\t]*([\\w.\\[\\], ]+?))?[ \\t]*=[ \\t]*(.+)$`, 'gm');
  let found: string | null = null;
  for (const match of text.matchAll(pattern)) {
    const annotation = (match[1] ?? '').toLowerCase();
    const value = match[2] ?? '';
    const typed = /^(list|dict|set|str)\b/.exec(annotation)?.[1];
    if (typed) found = typed;
    else if (/^\[/.test(value) || /^(list|sorted)\(|\.split\(/.test(value)) found = 'list';
    else if (/^\{\s*\}/.test(value) || /^\{[^}]*:/.test(value) || /^dict\(/.test(value)) found = 'dict';
    else if (/^\{/.test(value) || /^set\(/.test(value)) found = 'set';
    else if (/^[rfbu]?["']/i.test(value) || /^(str|input)\(/.test(value)) found = 'str';
  }
  return found;
}

function javascriptType(text: string, name: string): string | null {
  if (['Math', 'JSON', 'console', 'Object'].includes(name)) return name;
  const pattern = new RegExp(
    `\\b(?:const|let|var)[ \\t]+${escape(name)}[ \\t]*(?::[ \\t]*([\\w<>\\[\\]]+))?[ \\t]*=[ \\t]*(.+)$`,
    'gm',
  );
  let found: string | null = null;
  for (const match of text.matchAll(pattern)) {
    const annotation = match[1] ?? '';
    const value = match[2] ?? '';
    if (/\[\]$|^Array</.test(annotation) || /^\[/.test(value) || /^Array\.from\(|^new Array\b/.test(value)) {
      found = 'Array';
    } else if (annotation === 'string' || /^["'`]/.test(value)) found = 'String';
    else if (/^Map</.test(annotation) || /^new Map\b/.test(value)) found = 'Map';
    else if (/^Set</.test(annotation) || /^new Set\b/.test(value)) found = 'Set';
  }
  return found;
}

function cppType(text: string, name: string): string | null {
  const pattern = new RegExp(
    `\\b(?:std::)?(vector|string|map|unordered_map)\\b(?:[ \\t]*<[^;(){}]*>)?[ \\t]*&?[ \\t]*${escape(name)}\\b`,
    'g',
  );
  let found: string | null = null;
  for (const match of text.matchAll(pattern)) found = match[1] === 'unordered_map' ? 'map' : (match[1] ?? null);
  return found;
}

/** The type of `name` in the text before the caret, as a TYPE_MEMBERS key suffix. */
export function typeOf(language: string, text: string, name: string): string | null {
  const lang = family(language);
  if (name === '"') return lang === 'python' ? 'str' : lang === 'javascript' ? 'String' : null;
  if (lang === 'python') return pythonType(text, name);
  if (lang === 'javascript') return javascriptType(text, name);
  if (lang === 'cpp') return cppType(text, name);
  return null;
}

/** A member name and its rank in its table (0 is the most used), or -1 when it came from the file. */
export interface Member {
  name: string;
  rank: number;
  size: number;
  module: boolean;
}

/** The members after `receiver.`: the type's or module's table, else names used after it in the file. */
export function membersOf(language: string, text: string, receiver: string): Member[] {
  const lang = family(language);
  const module = MODULE_MEMBERS[`${lang}:${receiver}`];
  const type = typeOf(language, text, receiver);
  const table = module ?? (type ? TYPE_MEMBERS[`${lang}:${type}`] : undefined);
  if (table) return table.map((name, rank) => ({ name, rank, size: table.length, module: Boolean(module) }));
  if (receiver === '"') return [];
  const used = new Set<string>();
  for (const match of text.matchAll(new RegExp(`\\b${escape(receiver)}\\.([\\p{L}_$][\\p{L}\\p{N}_$]*)`, 'gu'))) {
    if (match[1]) used.add(match[1]);
  }
  return [...used].map((name) => ({ name, rank: -1, size: 0, module: false }));
}
