import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importsIn, packageImports } from './package-imports.ts';

describe('importsIn', () => {
  it('finds static imports, re-exports, and lazy imports of packages', () => {
    const source = [
      "import { Editor } from '@tiptap/core';",
      "import Moon, {\n  type Icon,\n} from '@phosphor-icons/react/dist/csr/Moon';",
      "export { lowlight } from 'lowlight';",
      "const load = () => import('markdown-it');",
    ].join('\n');
    expect(importsIn(source)).toEqual([
      '@tiptap/core',
      '@phosphor-icons/react/dist/csr/Moon',
      'lowlight',
      'markdown-it',
    ]);
  });

  it('leaves out the app’s own modules, types, styles, Node, and the test runner', () => {
    const source = [
      "import { t } from '../strings/t';",
      "import type { Root } from 'hast';",
      "import type { Node } from '@tiptap/pm/model';",
      "export type { Plugin } from 'vite';",
      "import sheet from 'some-package/style.css';",
      "import { readFileSync } from 'node:fs';",
      "import { expect } from 'vitest';",
      "import { page } from 'vitest/browser';",
    ].join('\n');
    expect(importsIn(source)).toEqual([]);
  });
});

describe('packageImports', () => {
  const found = packageImports(join(import.meta.dirname, '..', 'src'));

  it('lists what the app imports, once each and sorted', () => {
    expect(found).toContain('react');
    expect(found).toContain('@tiptap/pm/state');
    expect(found).toEqual([...new Set(found)].sort());
  });

  it('lists the modules lazy chunks import, which a late scan would meet mid-test', () => {
    expect(found.some((name) => name.startsWith('@phosphor-icons/react/dist/csr/'))).toBe(true);
    expect(found.some((name) => name.startsWith('highlight.js/lib/languages/'))).toBe(true);
  });
});
