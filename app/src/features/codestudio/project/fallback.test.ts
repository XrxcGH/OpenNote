// The project fallback (DESIGN 3.1): a known answer for two files, the 256 KiB cut, and search finding code.
import { describe, expect, it } from 'vitest';
import type { PageJson } from '../../../services/pages/types';
import { createMemorySearch } from '../../../services/search/memory';
import { CODE_PROJECT_TYPE } from '../contracts';
import type { CodeProject } from '../contracts';
import { fenceLanguage, projectFallback } from './fallback';
import { starterProject, utf8Bytes } from './model';

function twoFiles(): CodeProject {
  return {
    ...starterProject('Two sum', ''),
    files: {
      f02: { path: 'data/input.txt', text: '2 7 11 15\n9\n# zebrafish\n', order: 1 },
      f01: { path: 'main.py', text: 'def two_sum(nums, target):\n    return [0, 1]\n', order: 0 },
    },
  };
}

describe('project fallback', () => {
  it('lists each file as a heading and a fenced block, in tree order (known answer)', () => {
    // Written by hand from DESIGN 3.1. First the bold name with the language and the count. Then, per file, a
    // level 4 heading and a fence whose info string is the language of the file's extension (none for .txt).
    const expected = [
      '**Two sum** (Python, 2 files)',
      '',
      '#### main.py',
      '',
      '```python',
      'def two_sum(nums, target):',
      '    return [0, 1]',
      '```',
      '',
      '#### data/input.txt',
      '',
      '```',
      '2 7 11 15',
      '9',
      '# zebrafish',
      '```',
      '',
    ].join('\n');
    expect(projectFallback(twoFiles())).toBe(expected);
  });

  it('fences code that holds backticks with a longer fence, and escapes Markdown in paths', () => {
    const project = {
      ...starterProject('A', ''),
      files: { f01: { path: '__init__.py', text: 'x = """```"""\n', order: 0 } },
    };
    expect(projectFallback(project)).toBe(
      '**A** (Python, 1 file)\n\n#### \\_\\_init\\_\\_.py\n\n````python\nx = """```"""\n````\n',
    );
  });

  it('stops at the limit with the number of lines left out, and closes the open fence', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${String(i).padStart(2, '0')} ${'x'.repeat(20)}`);
    const project = {
      ...starterProject('Big', ''),
      files: {
        f01: { path: 'a.py', text: `${lines.join('\n')}\n`, order: 0 },
        f02: { path: 'b.py', text: 'one\ntwo\nthree\n', order: 1 },
      },
    };
    const limit = 1024;
    const out = projectFallback(project, limit);
    expect(utf8Bytes(out)).toBeLessThanOrEqual(limit);
    const shown = out.split('\n').filter((line) => line.startsWith('line ')).length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(40);
    // The lines of a.py not shown, and all three of b.py.
    expect(out.endsWith(`\`\`\`\n\n…and ${40 - shown + 3} more lines\n`)).toBe(true);
    expect(out).not.toContain('b.py');
  });
});

describe('project fallback size and search', () => {
  it('keeps the whole project within 256 KiB by default', () => {
    const big = 'y'.repeat(100) + '\n';
    const files = Object.fromEntries(
      Array.from({ length: 4 }, (_, i) => [`f0${i + 1}`, { path: `m${i}.py`, text: big.repeat(1000), order: i }]),
    );
    const out = projectFallback({ ...starterProject('Many', ''), files });
    expect(utf8Bytes(out)).toBeLessThanOrEqual(256 * 1024);
    expect(out).toMatch(/…and [\d,]+ more lines\n$/);
  });

  it('picks the fence language from the extension', () => {
    expect(fenceLanguage('src/app.TS')).toBe('typescript');
    expect(fenceLanguage('Makefile')).toBe('');
    expect(fenceLanguage('.gitignore')).toBe('');
    expect(fenceLanguage('lib/x.hpp')).toBe('cpp');
  });

  it('lets search find a word that appears only in a file', async () => {
    const stamp = '2026-11-01T10:00:00.000Z';
    const project = twoFiles();
    const page: PageJson = {
      id: 'p1',
      title: 'Exercises',
      created: stamp,
      modified: stamp,
      tags: [],
      view: {},
      assets: {},
      blocks: [
        { id: 'b0', type: 'text', order: 'a', created: stamp, modified: stamp, data: { markdown: 'Practice.' } },
        {
          id: 'b1',
          type: CODE_PROJECT_TYPE,
          order: 'b',
          created: stamp,
          modified: stamp,
          data: project as unknown as Record<string, unknown>,
          fallback: { markdown: projectFallback(project) },
        },
      ],
    } as PageJson;
    const search = createMemorySearch({ held: (id) => (id === page.id ? page : null) });
    await search.sync([{ page: page.id, title: page.title }], true);
    expect((await search.search({ text: 'zebrafish' })).hits.map((hit) => hit.page)).toEqual(['p1']);
    expect((await search.search({ text: 'two_sum' })).hits.map((hit) => hit.page)).toEqual(['p1']);
  });
});
