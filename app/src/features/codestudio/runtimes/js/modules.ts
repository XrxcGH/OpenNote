// Finding the project file an `import` or `require` names (DESIGN 4.3). Only project files can be imported: a path that
// starts with "./" or "../", relative to the importing file. There are no npm packages and no network.

import { isProjectPath } from '../../run/mount';

/** The file kinds a program can run or import. TypeScript's are transpiled by Sucrase first (transpile.ts). */
export const SCRIPT_FILE = /\.(?:[mc]?js|[mc]?ts)$/;
export const TYPESCRIPT_FILE = /\.[mc]?ts$/;

/** Tried in order after the specifier as written. Node tries endings this way, and so does TypeScript's bundler mode. */
const ENDINGS = ['', '.ts', '.js', '.mts', '.mjs', '.cts', '.cjs', '.json', '/index.ts', '/index.js'];

/** The folder of a project path: "" for a file at the top. */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/** Joins a relative specifier to a folder, resolving "." and ".."; null when it leaves the project. */
export function joinPath(folder: string, specifier: string): string | null {
  const parts = folder === '' ? [] : folder.split('/');
  for (const part of specifier.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  const joined = parts.join('/');
  return isProjectPath(joined) ? joined : null;
}

export type Resolved = { path: string } | { missing: 'file' | 'package' };

/**
 * The project file `specifier` names when imported from `from`. A specifier that does not start with "./" or "../"
 * is a package, which the sandbox does not have. TypeScript's own rule is kept too: "./util.js" finds util.ts.
 */
export function resolveModule(specifier: string, from: string, exists: (path: string) => boolean): Resolved {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return { missing: 'package' };
  const joined = joinPath(folderOf(from), specifier);
  if (joined === null) return { missing: 'file' };
  const typed = joined.replace(/\.([mc]?)js$/, '.$1ts');
  for (const candidate of [...ENDINGS.map((ending) => joined + ending), typed]) {
    if (exists(candidate)) return { path: candidate };
  }
  return { missing: 'file' };
}
