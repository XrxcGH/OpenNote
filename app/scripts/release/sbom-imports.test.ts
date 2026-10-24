// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { expandGlob, importedPackages, packageOf, resolveFile } from './sbom-imports.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** Writes files (path to text) into a new folder and returns the folder. */
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'opennote-imports-'));
  dirs.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

describe('packageOf', () => {
  it('names the package a bare import points to', () => {
    expect(packageOf('react-dom/client')).toBe('react-dom');
    expect(packageOf('@tauri-apps/api/core')).toBe('@tauri-apps/api');
    expect(packageOf('react')).toBe('react');
  });

  it.each(['./a', '../b', '/c', '~/d', 'node:fs', 'virtual:x'])('ignores %s', (specifier) => {
    expect(packageOf(specifier)).toBeUndefined();
  });
});

describe('importedPackages', () => {
  it('follows imports from the entry file and ignores files nothing loads', () => {
    const dir = project({
      'main.tsx': "import React from 'react';\nimport { App } from './App';\nimport './styles.css';\n",
      'App.tsx': "import { useState } from 'react';\nexport const App = () => import('./lazy.ts');\n",
      'lazy.ts': "export { y } from '@scope/editor/extra';\n",
      'styles.css': "@import '@fontsource/mono';\n@import './more.css';\n",
      'more.css': 'body {}\n',
      'App.test.tsx': "import { it } from 'vitest';\n",
      'test/setup.ts': "import 'jsdom';\n",
      'unused.ts': "import 'lodash';\n",
    });
    expect(importedPackages(join(dir, 'main.tsx'))).toEqual(['@fontsource/mono', '@scope/editor', 'react']);
  });

  it('skips type-only imports, which are erased when the code is compiled', () => {
    const dir = project({
      'main.ts':
        "import type { A } from 'only-types';\nimport { b } from 'real';\nexport type { C } from 'also-types';\n",
    });
    expect(importedPackages(join(dir, 'main.ts'))).toEqual(['real']);
  });

  it('reads imports that span lines, side-effect imports, and index files', () => {
    const dir = project({
      'main.ts': "import {\n  one,\n  two,\n} from 'multi';\nimport 'side-effect';\nimport './feature';\n",
      'feature/index.ts': "export * from 'deep';\n",
    });
    expect(importedPackages(join(dir, 'main.ts'))).toEqual(['deep', 'multi', 'side-effect']);
  });

  it('follows import.meta.glob to the files it loads', () => {
    const dir = project({
      'index.ts': "const modules = import.meta.glob('./*/register.ts', { eager: true });\n",
      'a/register.ts': "import 'from-a';\n",
      'b/register.ts': "import 'from-b';\n",
      'b/other.ts': "import 'not-loaded';\n",
    });
    expect(importedPackages(join(dir, 'index.ts'))).toEqual(['from-a', 'from-b']);
  });

  it('survives import cycles', () => {
    const dir = project({ 'a.ts': "import './b';\nimport 'x';\n", 'b.ts': "import './a';\nimport 'y';\n" });
    expect(importedPackages(join(dir, 'a.ts'))).toEqual(['x', 'y']);
  });
});

describe('resolveFile and expandGlob', () => {
  it('tries the extensions the bundler tries', () => {
    const dir = project({ 'main.ts': '', 'a.tsx': '', 'b/index.ts': '', 'c.css': '' });
    const main = join(dir, 'main.ts');
    expect(resolveFile(main, './a')).toBe(join(dir, 'a.tsx'));
    expect(resolveFile(main, './b')).toBe(join(dir, 'b', 'index.ts'));
    expect(resolveFile(main, './c.css')).toBe(join(dir, 'c.css'));
    expect(resolveFile(main, './missing')).toBeUndefined();
  });

  it('matches * within a folder and ** across folders', () => {
    const dir = project({ 'main.ts': '', 'x/a.ts': '', 'x/y/b.ts': '', 'z.ts': '' });
    const main = join(dir, 'main.ts');
    const names = (pattern: string) =>
      expandGlob(main, pattern)
        .map((path) => path.slice(dir.length + 1).replace(/\\/g, '/'))
        .sort();
    expect(names('./x/*.ts')).toEqual(['x/a.ts']);
    expect(names('./**/*.ts')).toEqual(['main.ts', 'x/a.ts', 'x/y/b.ts', 'z.ts']);
    expect(names('./nothing/*.ts')).toEqual([]);
  });
});
