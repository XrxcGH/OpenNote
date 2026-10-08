// Finds which npm packages the interface bundle uses, the way the bundler does. It starts at the entry file and
// follows every import to the files it loads. Each package those files import is noted. A file nothing reaches,
// such as a test or a test helper, never ships, so its packages stay out of the bill of materials. Type-only
// imports are
// erased when the code is compiled, so they don't count either.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js'];
const SOURCE = /\.([cm]?[jt]sx?|css)$/;
/** `import x from 'a'`, `export { y } from 'a'`, and the side-effect form `import 'a'`. A `type` import is skipped. */
const STATEMENT =
  /^[ \t]*(?:import|export)\s+(?!type\b)[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|^[ \t]*import\s*['"]([^'"]+)['"]/gm;
const DYNAMIC = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const GLOB = /\bimport\.meta\.glob\(\s*['"]([^'"]+)['"]/g;
const CSS_IMPORT = /@import\s+(?:url\()?['"]([^'"]+)['"]/g;

/** The package a bare import names: `react-dom/client` is `react-dom`, and `@tiptap/core/x` is `@tiptap/core`. */
export function packageOf(specifier: string): string | undefined {
  if (/^[./~]|^node:|^virtual:/.test(specifier)) return undefined;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** The file a relative import loads, trying the same file extensions and index files as the bundler. */
export function resolveFile(from: string, specifier: string): string | undefined {
  const base = resolve(dirname(from), specifier);
  return EXTENSIONS.map((extension) => resolve(base + extension)).find(
    (path) => existsSync(path) && statSync(path).isFile(),
  );
}

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

/** A glob as a regular expression, for `*` (within one folder) and `**` (across folders) only. */
function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (let at = 0; at < pattern.length; at++) {
    const char = pattern[at];
    if (char === '*' && pattern[at + 1] === '*') {
      const slash = pattern[at + 2] === '/';
      source += slash ? '(?:.*/)?' : '.*';
      at += slash ? 2 : 1;
    } else {
      source += char === '*' ? '[^/]*' : char.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/** The files that a glob pattern from import.meta.glob matches, such as the register.ts file in each folder. */
export function expandGlob(from: string, pattern: string): string[] {
  const fixed = pattern.split('*')[0];
  const base = resolve(dirname(from), fixed.slice(0, fixed.lastIndexOf('/') + 1));
  const matcher = globToRegExp(pattern.replace(/^\.\//, ''));
  return filesUnder(base).filter((path) => matcher.test(relative(dirname(from), path).replace(/\\/g, '/')));
}

/** The import specifiers in a file, and the glob patterns it expands. */
function referencesIn(path: string, text: string): { specifiers: string[]; globs: string[] } {
  const specifiers: string[] = [];
  if (path.endsWith('.css')) {
    specifiers.push(...[...text.matchAll(CSS_IMPORT)].map((match) => match[1]));
  } else {
    for (const match of text.matchAll(STATEMENT)) specifiers.push(match[1] ?? match[2]);
    specifiers.push(...[...text.matchAll(DYNAMIC)].map((match) => match[1]));
  }
  return { specifiers, globs: [...text.matchAll(GLOB)].map((match) => match[1]) };
}

/** Every package that the files reachable from `entry` import, sorted. */
export function importedPackages(entry: string): string[] {
  const packages = new Set<string>();
  const seen = new Set<string>();
  const queue = [resolve(entry)];
  while (queue.length > 0) {
    const path = queue.pop() as string;
    if (seen.has(path) || !SOURCE.test(path)) continue;
    seen.add(path);
    const { specifiers, globs } = referencesIn(path, readFileSync(path, 'utf8'));
    for (const specifier of specifiers) {
      const name = packageOf(specifier);
      if (name) packages.add(name);
      else if (specifier.startsWith('.')) {
        const file = resolveFile(path, specifier);
        if (file) queue.push(file);
      }
    }
    for (const pattern of globs) queue.push(...expandGlob(path, pattern));
  }
  return [...packages].sort();
}
