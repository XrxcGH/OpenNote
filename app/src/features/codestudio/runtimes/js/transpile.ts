// Turns a project file into the script text QuickJS runs (DESIGN 2.1). Sucrase (MIT; THIRD_PARTY_NOTICES.md) strips
// TypeScript's types and turns `import` and `export` into `require` and `exports`, which the module loader serves.
// Sucrase keeps every line where it was, so a line in a QuickJS error is the same line in the file.

import { TYPESCRIPT_FILE } from './modules';

/** Sucrase's `transform`, passed in so this file loads Sucrase only when the adapter does. */
export type Transform = (
  code: string,
  options: { transforms: ('typescript' | 'imports')[]; filePath: string; disableESTransforms: boolean },
) => { code: string };

export type Compiled = { code: string } | { line: number; column: number; message: string };

const STRICT = '"use strict";';
/** `import` or `export` as a statement or as `import(...)`, not as part of a longer name or a property. */
const MODULE_SYNTAX = /(?:^|[^.\w$])(?:import|export)\b/;

/** Whether a JavaScript file needs the imports transform. Without it a script keeps sloppy mode, as code cells do. */
export function usesModules(text: string): boolean {
  return MODULE_SYNTAX.test(text);
}

/**
 * The text QuickJS runs for a project file, or where Sucrase found a syntax error. TypeScript always goes through
 * the imports transform too, since TypeScript files are modules.
 */
export function compile(path: string, text: string, transform: Transform): Compiled {
  const typescript = TYPESCRIPT_FILE.test(path);
  if (!typescript && !usesModules(text)) return { code: text };
  try {
    const transforms: ('typescript' | 'imports')[] = typescript ? ['typescript', 'imports'] : ['imports'];
    const { code } = transform(text, { transforms, filePath: path, disableESTransforms: true });
    // Sucrase starts the text with the directive "use strict"; a script with no expression after it would show the
    // directive as its last value. `void 0;` on the same line keeps the lines and makes that value undefined.
    return { code: code.startsWith(STRICT) ? `${STRICT}void 0;${code.slice(STRICT.length)}` : code };
  } catch (error) {
    const raw = String((error as Error)?.message ?? error);
    // Sucrase's message reads "Error transforming main.ts: Unexpected token (9:5)", with the column from 1.
    const place = /\((\d+):(\d+)\)\s*$/.exec(raw);
    const message = raw.replace(/^Error transforming [^:]*: /, '').replace(/\s*\(\d+:\d+\)\s*$/, '');
    return { line: place ? Number(place[1]) : 1, column: place ? Number(place[2]) : 1, message };
  }
}
