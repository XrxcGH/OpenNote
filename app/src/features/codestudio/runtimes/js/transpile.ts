// Turns a project file into the script text QuickJS runs (DESIGN 2.1). Sucrase (MIT; THIRD_PARTY_NOTICES.md) strips
// TypeScript's types and turns `import` and `export` into `require` and `exports`, which the module loader serves.
// Sucrase keeps every line where it was, so a line in a QuickJS error is the same line in the file.
//
// Sucrase puts its own code ("use strict" and helpers) in front of line 1. The file goes in with an empty line on
// top, so that code comes out alone on line 1; it is then joined to the file's first line again. Its length is the
// `shift` of every column on line 1, which the engine takes off again in error places.

import { TYPESCRIPT_FILE } from './modules';

/** Sucrase's `transform`, passed in so this file loads Sucrase only when the adapter does. */
export type Transform = (
  code: string,
  options: { transforms: ('typescript' | 'imports')[]; filePath: string; disableESTransforms: boolean },
) => { code: string };

/** The text to run and how many characters were put before line 1; or where the file cannot be compiled. */
export type Compiled =
  | { code: string; shift: number }
  | { line: number; column: number; message: string; unsupported?: 'namespace' | 'declarators' };

/** Ends Sucrase's line 1, so a program with no expression of its own has no last value to show. */
const END_PREFIX = 'void 0;';
/** `import` or `export` as a statement or as `import(...)`, not as part of a longer name or a property. */
const MODULE_SYNTAX = /(?:^|[^.\w$])(?:import|export)\b/;
/**
 * A TypeScript namespace or module block that is not `declare`d. Sucrase 3.35.1 removes such a block without a word,
 * so its code would never run. A match starts only at one of `;{}` or a line break. The spaces after that start are
 * not line breaks, so each character is tried once, and long runs of blank lines stay linear.
 */
const NAMESPACE = /(^|[;{}\n])[^\S\n]*(?:export\s+)?(?:namespace|module)\s+[A-Za-z_$][\w$.]*\s*\{/g;
/**
 * Sucrase 3.35.1 turns `export const a = 1, b = 2;` into `const a = 1; exports.a = a, b = 2;`, and `export let a, b;`
 * into `exports.a, b;`, which are wrong. The comma may stand after any spaces or line breaks. A match starts only at
 * one of `;{}` or a line start. The spaces after that start are not line breaks, so each start is tried once.
 */
const SEVERAL_DECLARATORS = /(?:^|[;{}])[^\S\n]*exports\.([A-Za-z_$][\w$]*)(?:\s*=\s*\1)?\s*,/gm;
const EXPORT = /\bexport\b/;

/** Whether a JavaScript file might need the imports transform: a quick test before the exact one in `compile`. */
export function usesModules(text: string): boolean {
  return MODULE_SYNTAX.test(text);
}

/** Gives the line of each index in `text`, for indexes that only grow: each line break is counted once. */
function lineCounter(text: string): (index: number) => number {
  let line = 1;
  let counted = 0;
  return (index) => {
    for (let at = text.indexOf('\n', counted); at >= 0 && at < index; at = text.indexOf('\n', at + 1)) line++;
    counted = Math.max(counted, index);
    return line;
  };
}

/** The line of the first export statement with several declarators, which Sucrase compiles wrong. */
function severalDeclarators(text: string, out: string): number | null {
  const lineOf = lineCounter(out);
  const textLines = text.split('\n');
  for (const found of out.matchAll(SEVERAL_DECLARATORS)) {
    const line = lineOf(found.index ?? 0);
    // Sucrase keeps lines, so the statement's own line still says `export`; a plain `x, y;` there does not.
    if (EXPORT.test(textLines[line - 1] ?? '')) return line;
  }
  return null;
}

/** The first `namespace` block Sucrase dropped: in the file, but no longer on its line in the output. */
function droppedNamespace(text: string, out: string): number | null {
  const outLines = out.split('\n');
  const lineOf = lineCounter(text);
  for (const found of text.matchAll(NAMESPACE)) {
    const line = lineOf((found.index ?? 0) + (found[1]?.length ?? 0));
    if (!/\b(?:namespace|module)\b/.test(outLines[line - 1] ?? '')) return line;
  }
  return null;
}

/**
 * The text QuickJS runs for a project file, or where it cannot be compiled. TypeScript always goes through the
 * imports transform too, since TypeScript files are modules. A JavaScript file goes through it only when that
 * changes the text, so a plain script keeps sloppy mode, as code cells do.
 */
export function compile(path: string, source: string, transform: Transform): Compiled {
  // A "#!" line is a comment of the same length, so it may stand inside the module wrapper too.
  const text = source.startsWith('#!') ? `//${source.slice(2)}` : source;
  const typescript = TYPESCRIPT_FILE.test(path);
  if (!typescript && !usesModules(text)) return { code: text, shift: 0 };
  let out: string;
  try {
    const transforms: ('typescript' | 'imports')[] = typescript ? ['typescript', 'imports'] : ['imports'];
    out = transform(`\n${text}`, { transforms, filePath: path, disableESTransforms: true }).code;
  } catch (error) {
    const raw = String((error as Error)?.message ?? error);
    // Sucrase's message reads "Error transforming main.ts: Unexpected token (9:5)", with the column from 1. The
    // empty line on top moves every line down by one.
    const place = /\((\d+):(\d+)\)\s*$/.exec(raw);
    const message = raw.replace(/^Error transforming [^:]*: /, '').replace(/\s*\(\d+:\d+\)\s*$/, '');
    return { line: place ? Math.max(1, Number(place[1]) - 1) : 1, column: place ? Number(place[2]) : 1, message };
  }
  const newline = out.indexOf('\n');
  const prefix = newline < 0 ? out : out.slice(0, newline);
  const body = newline < 0 ? '' : out.slice(newline + 1);
  if (!typescript && body === text) return { code: text, shift: 0 };
  if (typescript) {
    const line = droppedNamespace(text, body);
    if (line !== null) return { line, column: 1, message: '', unsupported: 'namespace' };
  }
  const several = severalDeclarators(text, body);
  if (several !== null) return { line: several, column: 1, message: '', unsupported: 'declarators' };
  return { code: `${prefix}${END_PREFIX}${body}`, shift: prefix.length + END_PREFIX.length };
}
