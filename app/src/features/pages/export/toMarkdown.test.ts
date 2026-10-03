import { existsSync, readdirSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURES, fixtureJson, fixtureText } from '../formatFixtures';
import { escapeText, oneLine, rewriteLinks, writeDestination } from './escape';
import { readingOrder } from './order';
import { readExportPage, type ExportPage } from './source';
import { NEWER_VERSION_LINE, exportMarkdown, tableCell } from './toMarkdown';

interface EscapeCase {
  readonly text: string;
  readonly escaped: string;
  readonly atLineStart: boolean;
}

describe('escaping text', () => {
  const cases = fixtureJson<{ cases: EscapeCase[] }>('markdown', 'escape', 'cases.json').cases;
  it.each(cases.map((c, i) => [`${i}: ${c.text}`, c] as const))('writes %s as the shared fixtures say', (_n, c) => {
    expect(escapeText(c.text, c.atLineStart)).toBe(c.escaped);
  });

  it('turns line breaks into hard breaks and joins lines for one-line text', () => {
    expect(escapeText('a\nb', true)).toBe('a\\\nb');
    expect(escapeText('1.5\n2. x', true)).toBe('1\\.5\\\n2\\. x');
    expect(oneLine('a\r\nb\nc')).toBe('a b c');
  });

  it('writes destinations bare when it can, and in angle brackets when it cannot', () => {
    expect(writeDestination('assets/a-b.png')).toBe('assets/a-b.png');
    expect(writeDestination('assets/a b (1).png')).toBe('<assets/a b (1).png>');
    expect(writeDestination('x<y>\\')).toBe('<x\\<y\\>\\\\>');
    expect(writeDestination('')).toBe('<>');
  });
});

describe('rewriting links', () => {
  const rewrite = {
    page: (id: string) => (id === 'P1' ? '../P1/page.md' : null),
    asset: (id: string) => (id === 'A1' ? 'assets/a one.png' : null),
  };

  it('rewrites page and asset links, and drops a page fragment', () => {
    expect(rewriteLinks('See [x](opennote:page/P1#B2) and ![y](asset:A1).', rewrite)).toBe(
      'See [x](../P1/page.md) and ![y](<assets/a one.png>).',
    );
  });

  it('leaves unknown links, autolinks, code, and fences alone', () => {
    const source = '[a](opennote:page/P9) <asset:A1> `[b](asset:A1)`\n```\n[c](asset:A1)\n```\n[d](https://e.org)';
    expect(rewriteLinks(source, rewrite)).toBe(source);
  });

  it('finds links after brackets and inside nested ones', () => {
    expect(rewriteLinks('[a [b]](asset:A1) \\[c](asset:A1) [d](asset:A1 "t")', rewrite)).toBe(
      '[a [b]](<assets/a one.png>) \\[c](asset:A1) [d](<assets/a one.png> "t")',
    );
  });
});

const page = (json: object): ExportPage => readExportPage({ id: 'P0', title: 'T', ...json });

function block(id: string, order: string, type: string, data: object, frame?: object) {
  return { id, order, type, data, ...(frame ? { frame } : {}) };
}

describe('Markdown export', () => {
  it('writes the title, the blocks in reading order, and basic front matter', () => {
    const p = page({
      title: 'Cell *biology*',
      tags: ['bio', 'exam/unit-3'],
      created: '2026-09-30T14:03:22.114Z',
      modified: '2026-09-30T14:07:40.412Z',
      blocks: [
        block('b2', 'a1', 'text', { markdown: 'Second' }),
        block('b1', 'a0', 'text', { markdown: 'First' }),
        block('f1', 'a2', 'text', { markdown: 'Floating' }, { x: 10, y: 10 }),
      ],
    });
    expect(exportMarkdown(p).markdown).toBe(
      [
        '---',
        'title: "Cell *biology*"',
        'tags: ["bio", "exam/unit-3"]',
        'created: "2026-09-30T14:03:22.114Z"',
        'modified: "2026-09-30T14:07:40.412Z"',
        '---',
        '',
        '# Cell \\*biology\\*',
        '',
        'First',
        '',
        'Second',
        '',
        'Floating',
        '',
      ].join('\n'),
    );
    expect(exportMarkdown(p, { frontMatter: 'none' }).markdown.startsWith('# Cell')).toBe(true);
  });
});

describe('Markdown export of other blocks', () => {
  it('exports images, files, drawings, and blocks of unknown types', () => {
    const assets = {
      A1: { file: 'A1-leaf.png', mime: 'image/png', name: 'Leaf.png' },
      A2: { file: 'A2-notes.pdf', mime: 'application/pdf', name: 'Lab [notes].pdf' },
    };
    const p = page({
      title: '',
      assets,
      blocks: [
        block('i1', 'a0', 'image', { asset: 'A1', alt: 'A leaf\nup close' }),
        block('i2', 'a1', 'image', { asset: 'A1', alt: 'ignored', decorative: true }),
        block('i3', 'a2', 'image', { asset: 'MISSING', alt: 'gone' }),
        block('f1', 'a3', 'file', { asset: 'A2' }),
        block('d1', 'a4', 'ink', { role: 'drawing', alt: 'A *sketch*', strokeCount: 0 }),
        block('d2', 'a5', 'ink', { role: 'drawing', alt: 'x', decorative: true }),
        block('d3', 'a6', 'ink', { role: 'layer', alt: 'y' }),
        {
          ...block('u1', 'a7', 'chart', { rows: 3 }),
          fallback: { markdown: '**Chart**: [see](asset:A1)' },
        },
        block('u2', 'a8', 'embed', {}),
        block('bad', 'a9', 'image', { alt: 'no asset' }),
      ],
    });
    const { markdown, assets: used } = exportMarkdown(p, { frontMatter: 'none' });
    expect(markdown).toBe(
      [
        '![A leaf up close](assets/A1-leaf.png)',
        '![](assets/A1-leaf.png)',
        '![gone](asset:MISSING)',
        '[Lab \\[notes\\].pdf](assets/A2-notes.pdf)',
        '*A \\*sketch\\**',
        '**Chart**: [see](assets/A1-leaf.png)',
        NEWER_VERSION_LINE,
        NEWER_VERSION_LINE,
        '',
      ]
        .join('\n\n')
        .replace(/\n\n$/, '\n'),
    );
    expect([...used].sort()).toEqual(['A1', 'A2']);
  });
});

describe('Markdown export of tables and ink', () => {
  it('writes tables as GFM, with an empty header when there is none', () => {
    const table = (header: boolean) =>
      block('t', 'a0', 'table', {
        header,
        columns: [
          { id: 'c1', width: 100 },
          { id: 'c2', width: 100 },
        ],
        rows: [
          { id: 'r1', cells: { c1: { markdown: 'A | B' }, c2: { markdown: 'one\\\ntwo' } } },
          { id: 'r2', cells: { c1: { markdown: 'x \\| y' } } },
        ],
      });
    expect(exportMarkdown(page({ title: '', blocks: [table(true)] }), { frontMatter: 'none' }).markdown).toBe(
      '| A \\| B | one<br>two |\n| --- | --- |\n| x \\| y |  |\n',
    );
    expect(exportMarkdown(page({ title: '', blocks: [table(false)] }), { frontMatter: 'none' }).markdown).toBe(
      '|  |  |\n| --- | --- |\n| A \\| B | one<br>two |\n| x \\| y |  |\n',
    );
    expect(tableCell('a|b\\|c')).toBe('a\\|b\\|c');
  });

  it('adds the handwriting line for a page with ink, and leaves it out on request', () => {
    const p = page({ title: 'Ink', blocks: [block('k', 'a0', 'ink', { role: 'layer', strokeCount: 3 })] });
    expect(exportMarkdown(p, { frontMatter: 'none' }).markdown).toBe('# Ink\n\n![Handwriting on this page](ink.svg)\n');
    expect(exportMarkdown(p, { frontMatter: 'none', handwriting: null }).markdown).toBe('# Ink\n');
  });

  it('exports an empty page as nothing but its front matter', () => {
    expect(exportMarkdown(page({ title: '' }), { frontMatter: 'none' }).markdown).toBe('');
  });
});

describe('the reading order fixtures', () => {
  interface Case {
    readonly name: string;
    readonly page: { blocks: unknown[]; view?: { readingOrder?: string[] } };
    readonly expected: string[];
  }
  const cases = fixtureJson<{ cases: Case[] }>('reading-order', 'cases.json').cases;
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const read = readExportPage(c.page);
    expect(readingOrder(read.blocks, read.view.readingOrder).map((b) => b.id)).toEqual(c.expected);
  });
});

/** Every page folder of the version 1 notebook that has both a page.json and a page.md. */
function pageFolders(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'ink' || entry.name === 'assets') continue;
      const path = join(dir, entry.name);
      if (existsSync(join(path, 'page.json')) && existsSync(join(path, 'page.md'))) found.push(path);
      else walk(path);
    }
  };
  walk(root);
  return found.filter((p) => !p.includes(`${sep}.opennote${sep}`));
}

/** The text of page.md after its front matter. */
function bodyOf(markdown: string): string {
  const end = markdown.indexOf('\n---\n', 4);
  return markdown.slice(end + 5).replace(/^\n/, '');
}

describe('the readable copies of the shared fixtures', () => {
  const notebook = join(FIXTURES, 'nb', 'v1');
  const folders = pageFolders(notebook);
  const byId = new Map(
    folders.map((f) => [f.split(sep).at(-1) as string, relative(notebook, f).split(sep).join('/')] as const),
  );

  it('covers pages with blocks of every kind', () => {
    expect(folders.length).toBeGreaterThanOrEqual(5);
  });

  it.each(folders.map((f) => [relative(notebook, f).split(sep).join('/'), f] as const))(
    'writes %s as page.md does',
    (_n, folder) => {
      const json = JSON.parse(fixtureText('nb', 'v1', relative(notebook, folder), 'page.json')) as { ink?: unknown };
      const read = readExportPage(json);
      const here = relative(notebook, folder).split(sep).join('/');
      const exported = exportMarkdown(
        { ...read, strokes: json.ink ? [{ id: 'x' } as never] : [] },
        {
          frontMatter: 'none',
          pagePath: (id) => {
            const target = byId.get(id);
            return target === undefined ? null : `${posix.relative(here, target)}/page.md`;
          },
        },
      );
      expect(exported.markdown).toBe(bodyOf(fixtureText('nb', 'v1', relative(notebook, folder), 'page.md')));
    },
  );

  it('writes the page of format spec 5.5 as the spec shows', () => {
    const json = fixtureJson<object>('readable', 'spec-example', 'page.json');
    const read = readExportPage(json, [{ id: 'x' } as never]);
    expect(exportMarkdown(read, { frontMatter: 'none' }).markdown).toBe(
      bodyOf(fixtureText('readable', 'spec-example', 'page.md')),
    );
  });
});
