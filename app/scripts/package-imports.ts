// The package modules the app's source imports, for the component tests' dependency bundling (vitest.config.ts).
//
// Vite bundles a package the first time it meets it. One it meets after the tests start, in a chunk that loads
// lazily, reloads the page under a running test, and the test fails. Vite's own scan misses some of them, so on a
// machine with no cache (CI) the first run failed. Listing every import bundles them all before the first test.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** `import ... from 'x'`, `export ... from 'x'`, and `import('x')`, where x is a package and no type import. */
const IMPORT = /\b(?:import|export)\s+(?!type\b)[^'"`;]*?\bfrom\s+'([^'./][^']*)'|\bimport\(\s*'([^'./][^']*)'\s*\)/g;

/** Packages that are not bundled for the browser: Node's own, the test runner's, and type-only ones. */
const SKIPPED = /^(node:|virtual:|vitest($|\/)|@vitest\/|hast$)/;

const SOURCE = /\.tsx?$/;
const TEST = /\.test\.tsx?$/;

/** The package modules imported in one module's text. */
export function importsIn(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(IMPORT)) {
    const name = match[1] ?? match[2];
    if (name && !SKIPPED.test(name) && !/\.css$|\?/.test(name)) found.push(name);
  }
  return found;
}

/** Every package module imported under `dir`, outside test files, sorted. */
export function packageImports(dir: string): string[] {
  const found = new Set<string>();
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (SOURCE.test(entry.name) && !TEST.test(entry.name)) {
        for (const name of importsIn(readFileSync(path, 'utf8'))) found.add(name);
      }
    }
  };
  walk(dir);
  return [...found].sort();
}
