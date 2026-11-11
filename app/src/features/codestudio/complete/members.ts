// The members source (DESIGN 10.2), after a `.`. A literal, a constructor call, or an annotation shows the
// receiver's type, and its methods are offered. Known modules offer their members. Otherwise the names used after
// the same receiver near the caret are offered.
//
// The type rules read whole lines with string operations, or with patterns whose quantifiers never match the same
// characters side by side, so a hostile line costs linear time. Lines longer than MAX_LINE are skipped, and only
// the WINDOW characters before the caret are read.

import { family, MODULE_MEMBERS, TYPE_MEMBERS } from './tables';

/** Lines longer than this are skipped by the type rules. */
export const MAX_LINE = 500;
/** The members source reads at most this many characters on each side of the caret. */
export const WINDOW = 200_000;

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The receiver before the `.` that ends at `dot`: a dotted name such as `os.path`, or a literal's type marker. */
export function receiverAt(text: string, dot: number): string | null {
  if (text[dot] !== '.') return null;
  const before = text.slice(Math.max(0, dot - 200), dot);
  if (/["'`]$/.test(before)) return '"';
  const name = /[\p{L}_$][\p{L}\p{N}_$]*(?:\.[\p{L}_$][\p{L}\p{N}_$]*)*$/u.exec(before);
  return name ? name[0] : null;
}

/**
 * Reads the lines of `text` from the last one up, until `read` returns something other than undefined.
 * Lines over MAX_LINE characters and text beyond WINDOW are not read.
 */
function nearestLine<T>(text: string, read: (line: string) => T | undefined): T | null {
  const stop = Math.max(0, text.length - WINDOW);
  let end = text.length;
  while (end >= stop) {
    const start = text.lastIndexOf('\n', end - 1) + 1;
    if (end - start <= MAX_LINE) {
      const found = read(text.slice(start, end));
      if (found !== undefined) return found;
    }
    if (start === 0) break;
    end = start - 1;
  }
  return null;
}

function pythonValue(value: string): string | null {
  if (/^\[/.test(value) || /^(list|sorted)\(|\.split\(/.test(value)) return 'list';
  if (/^\{\s*\}/.test(value) || /^\{[^}]*:/.test(value) || /^dict\(/.test(value)) return 'dict';
  if (/^\{/.test(value) || /^set\(/.test(value)) return 'set';
  if (/^[rfbu]?["']/i.test(value) || /^(str|input)\(/.test(value)) return 'str';
  return null;
}

const pythonAnnotation = (annotation: string): string | null =>
  /^(list|dict|set|str)\b/.exec(annotation.trim().toLowerCase())?.[1] ?? null;

/**
 * The nearest line that binds `name`: an assignment, a bare annotation (`nums: list[int]`), or an annotated
 * parameter (`def f(name: str):`). An annotation names the type; otherwise the assigned value shows it.
 */
function pythonType(text: string, name: string): string | null {
  const head = new RegExp(`^[ \\t]*${escape(name)}[ \\t]*(?=[:=])`);
  const parameter = new RegExp(`[(,][ \\t]*${escape(name)}[ \\t]*:([^,)=]*)`);
  return nearestLine(text, (line) => {
    const bound = head.exec(line);
    if (bound) {
      const rest = line.slice(bound[0].length);
      if (rest.startsWith('==')) return undefined;
      if (rest.startsWith('=')) return pythonValue(rest.slice(1).trim());
      const equals = rest.indexOf('=');
      const annotation = rest.slice(1, equals < 0 ? undefined : equals);
      return pythonAnnotation(annotation) ?? (equals < 0 ? null : pythonValue(rest.slice(equals + 1).trim()));
    }
    if (/^[ \t]*(?:async[ \t]+)?def[ \t]/.test(line)) {
      const annotated = parameter.exec(line);
      if (annotated) return pythonAnnotation(annotated[1] ?? '');
    }
    return undefined;
  });
}

function javascriptValue(annotation: string, value: string): string | null {
  if (/\[\]$|^Array</.test(annotation) || /^\[/.test(value) || /^Array\.from\(|^new Array\b/.test(value)) {
    return 'Array';
  }
  if (annotation === 'string' || /^["'`]/.test(value)) return 'String';
  if (/^Map</.test(annotation) || /^new Map\b/.test(value)) return 'Map';
  if (/^Set</.test(annotation) || /^new Set\b/.test(value)) return 'Set';
  return null;
}

/** The nearest declaration of `name` (`const`, `let`, `var`), or a TypeScript parameter annotation. */
function javascriptType(text: string, name: string): string | null {
  if (['Math', 'JSON', 'console', 'Object'].includes(name)) return name;
  const declared = new RegExp(`\\b(?:const|let|var)[ \\t]+${escape(name)}(?![\\w$])`);
  const parameter = new RegExp(`[(,][ \\t]*${escape(name)}\\??[ \\t]*:[ \\t]*([A-Za-z_$][\\w$<>\\[\\]]*)`);
  return nearestLine(text, (line) => {
    const found = declared.exec(line);
    if (found) {
      const rest = line.slice(found.index + found[0].length).trimStart();
      const equals = rest.indexOf('=');
      const annotation = rest.startsWith(':') ? rest.slice(1, equals < 0 ? undefined : equals).trim() : '';
      const value = equals < 0 ? '' : rest.slice(equals + 1).trim();
      return javascriptValue(annotation, value);
    }
    const annotated = parameter.exec(line);
    if (annotated) return javascriptValue(annotated[1] ?? '', '');
    return undefined;
  });
}

/** The nearest declaration of `name` with a standard container type, read within one line. */
function cppType(text: string, name: string): string | null {
  const pattern = new RegExp(
    `\\b(?:std::)?(vector|string|map|unordered_map)\\b(?:[ \\t]*<[^;(){}\\n]*>)?[ \\t]*(?:&[ \\t]*)?${escape(name)}\\b`,
  );
  return nearestLine(text, (line) => {
    if (!line.includes(name)) return undefined;
    const found = pattern.exec(line)?.[1];
    if (!found) return undefined;
    return found === 'unordered_map' ? 'map' : found;
  });
}

/** The type of `name` from the text before `pos` (the end of the text by default), as a TYPE_MEMBERS key suffix. */
export function typeOf(language: string, text: string, name: string, pos = text.length): string | null {
  const lang = family(language);
  if (name === '"') return lang === 'python' ? 'str' : lang === 'javascript' ? 'String' : null;
  const before = text.slice(Math.max(0, pos - WINDOW), pos);
  if (lang === 'python') return pythonType(before, name);
  if (lang === 'javascript') return javascriptType(before, name);
  if (lang === 'cpp') return cppType(before, name);
  return null;
}

/** A member name and its rank in its table (0 is the most used), or -1 when it came from the file. */
export interface Member {
  name: string;
  rank: number;
  size: number;
  module: boolean;
}

/** The members after `receiver.` at `pos`: the type's or module's table, else names used after it near the caret. */
export function membersOf(language: string, text: string, receiver: string, pos = text.length): Member[] {
  const lang = family(language);
  const module = MODULE_MEMBERS[`${lang}:${receiver}`];
  const type = module ? null : typeOf(language, text, receiver, pos);
  const table = module ?? (type ? TYPE_MEMBERS[`${lang}:${type}`] : undefined);
  if (table) return table.map((name, rank) => ({ name, rank, size: table.length, module: Boolean(module) }));
  if (receiver === '"') return [];
  const used = new Set<string>();
  const near = text.slice(Math.max(0, pos - WINDOW), pos + WINDOW);
  for (const match of near.matchAll(new RegExp(`\\b${escape(receiver)}\\.([\\p{L}_$][\\p{L}\\p{N}_$]*)`, 'gu'))) {
    if (match[1]) used.add(match[1]);
  }
  return [...used].map((name) => ({ name, rank: -1, size: 0, module: false }));
}
