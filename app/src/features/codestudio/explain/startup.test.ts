// The explanation words are about 50 KB. They must load with the lazy explain chunk, never with the start-up bundle.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..', '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const rel = (file: string): string => relative(SRC, file).split(sep).join('/');

const files = new Map<string, string>();

describe('explain strings stay out of the start-up bundle', () => {
  beforeAll(() => {
    for (const file of sources(SRC)) files.set(rel(file), readFileSync(file, 'utf8'));
  }, 60_000);

  it('are imported only by the explain feature', () => {
    const words = /\/explain(?:Entries|Python|PythonClasses|JavaScript|Clang|ClangMore|Database)'/;
    const importers = [...files]
      .filter(([, text]) => words.test(text))
      .map(([file]) => file)
      .filter(
        (file) => !file.startsWith('features/codestudio/explain/') && !file.startsWith('strings/en/codeStudio/explain'),
      );
    expect(importers).toEqual([]);
  });

  it('are not part of the en tree', () => {
    expect(readFileSync(join(SRC, 'strings/en/codeStudio/explain.ts'), 'utf8')).not.toMatch(/^import /m);
  });

  it('keeps the explain feature behind a dynamic import', () => {
    const staticImport = /^import .*codestudio\/explain'/m;
    const importers = [...files]
      .filter(([, text]) => staticImport.test(text))
      .map(([file]) => file)
      .filter((file) => !file.startsWith('features/codestudio/explain/'));
    expect(importers).toEqual([]);
  });
});
