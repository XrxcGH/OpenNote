// Deterministic pages for the web platform (?fixture=sampler), tests, and benchmarks (PLAN.md section 3.15). The
// 20-page note is ADR 0005's, from spikes/web/text-content.ts, written as Markdown. Each page is built on first use.
import type { TableData } from '../../editor/schema/specs';
import type { PageFixture } from './memory';
import type { BlockJson, Frame, PageJson } from './types';

const AT = '2026-10-01T09:00:00.000Z';

/** mulberry32, the spike's generator, so every run types into the same text. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = (
  'the of and a to in is you that it he was for on are as with his they at be this have from or one had by ' +
  'word but not what all were we when your can said there use an each which she do how their if will up ' +
  'other about out many then them these so some her would make like him into time has look two more write ' +
  'go see number no way could people my than first water been call who oil its now find long down day did ' +
  'get come made may part note page ink pen idea plan class lecture summary chapter question answer point ' +
  'draft review meeting project garden recipe budget travel reading history science music study notebook'
).split(' ');

type Random = () => number;

function sentence(random: Random, words: number): string {
  const text = Array.from({ length: words }, () => WORDS[Math.floor(random() * WORDS.length)]).join(' ');
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

function sentences(random: Random, count: number): string {
  return Array.from({ length: count }, () => sentence(random, 8 + Math.floor(random() * 12))).join(' ');
}

/** One printed page: a heading, seven paragraphs, and a short list (about 460 words). */
function printedPage(random: Random, number: number): string[] {
  const items = Array.from({ length: 5 }, () => sentence(random, 5 + Math.floor(random() * 6)));
  const list = items.map((item, i) => (number % 2 === 0 ? `${i + 1}. ${item}` : `- ${item}`)).join('\n');
  const paragraphs = (counts: number[]) => counts.map((count) => sentences(random, count));
  return [
    `## Part ${number}: ${sentence(random, 4).slice(0, -1)}`,
    ...paragraphs([5, 5, 4]),
    list,
    ...paragraphs([5, 4, 4, 4]),
  ];
}

/** ADR 0005's note, about `pages` printed pages long. */
export function longNoteMarkdown(pages = 20, seed = 20): string {
  const random = seeded(seed);
  const parts = ['# A twenty-page note'];
  for (let number = 1; number <= pages; number++) parts.push(...printedPage(random, number));
  return parts.join('\n\n');
}

/** One bulleted list of about 1,200 items, four levels deep. */
function outlineMarkdown(): string {
  const random = seeded(7);
  const lines: string[] = [];
  let level = 0;
  for (let i = 0; i < 1200; i++) {
    lines.push(`${'  '.repeat(level)}- ${sentence(random, 4 + Math.floor(random() * 8))}`);
    level = Math.min(3, Math.floor(random() * (level + 2)));
  }
  return lines.join('\n');
}

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
let ids = 0;
/** A valid, deterministic ID in SPEC 2.4's alphabet, so the core accepts it too. */
function fixtureId(): string {
  let n = ids++;
  let tail = '';
  for (let i = 0; i < 8; i++, n = Math.floor(n / 32)) tail = ALPHABET[n % 32] + tail;
  return `01k6f${'0'.repeat(13)}${tail}`;
}

function block(type: string, order: number, data: Record<string, unknown>, frame?: Frame): BlockJson {
  return {
    id: fixtureId(),
    type,
    order: `a${order.toString(36).padStart(4, '0')}`,
    created: AT,
    modified: AT,
    data,
    ...(frame ? { frame } : {}),
  };
}

const text = (order: number, markdown: string, frame?: Frame) => block('text', order, { markdown }, frame);

function page(title: string, blocks: BlockJson[], view: PageJson['view'] = {}): PageFixture {
  return { page: { id: fixtureId(), title, created: AT, modified: AT, tags: [], view, blocks, assets: {} } };
}

function table(order: number, rows: number): BlockJson {
  const columns = [0, 1, 2].map(() => ({ id: fixtureId(), width: 160 }));
  const data: TableData = {
    header: true,
    columns,
    rows: Array.from({ length: rows }, (_, r) => ({
      id: fixtureId(),
      cells: Object.fromEntries(
        columns.map((column, c) => [column.id, { markdown: r === 0 ? `Head ${c + 1}` : `**${r}.${c}**` }]),
      ),
    })),
  };
  return block('table', order, data as unknown as Record<string, unknown>);
}

const SAMPLER_TEXT = [
  '# Every kind of text',
  'A **strong**, *emphasized*, ~~struck~~, ==highlighted==, <u>underlined</u>, `code`, H<sub>2</sub>O and x<sup>2</sup> word.',
  'A <mark data-color="mint">mint</mark> highlight, <span data-color="indigo">indigo</span> text, and <span data-size="large">large</span> text, with a [link](https://example.com).',
  '## Lists',
  '- one\n- two\n  - nested',
  '1. first\n2. second',
  '- [ ] to do\n- [x] done',
  '> A quote',
  ...[
    'note',
    'tip',
    'important',
    'warning',
    'caution',
    'info',
    'question',
    'success',
    'danger',
    'example',
    'quote',
  ].map((type) => `> [!${type}] A ${type} callout\n>\n> Its body.`),
  '```js\nconst answer = 42;\n```',
  '---',
  '$$\nx^2 + y^2\n$$',
].join('\n\n');

/**
 * Every kind of line on ruled paper, each with "Hxn" in it: letters that sit flat on their baseline, so a test can
 * find the baseline in a screenshot. Lines stay short, so the right side of the column is free of text.
 */
const RULED_TEXT = [
  'Hxn on a rule, then Hxn again.',
  'Hxn with H<sub>2</sub>O and x<sup>2</sup> in it.',
  'Hxn and <span data-size="large">Hxn</span> large.',
  'Hxn by ==a mark== and `some code`.',
  '# Hxn one',
  '## Hxn two',
  '### Hxn three',
  '#### Hxn four',
  '##### Hxn five',
  '###### Hxn six',
  '- Hxn bullet\n- Hxn bullet',
  '1. Hxn number\n2. Hxn number',
  '- [ ] Hxn task\n- [x] Hxn done',
  '> Hxn quote\n>\n> Hxn quote',
  '> [!note] Hxn callout\n>\n> Hxn body',
  '```\nHxn code\nHxn code\n```',
  'Hxn after code.',
].join('\n\n');

function ruledTable(order: number): BlockJson {
  const columns = [0, 1].map(() => ({ id: fixtureId(), width: 140 }));
  const row = () => ({ id: fixtureId(), cells: Object.fromEntries(columns.map((c) => [c.id, { markdown: 'Hxn' }])) });
  const data: TableData = { header: true, columns, rows: [row(), row()] };
  return block('table', order, data as unknown as Record<string, unknown>);
}

/** A table from rows of cell text, the first row its header, with `extra` keys in its data (data.sheet, say). */
function tableOf(order: number, texts: readonly (readonly string[])[], extra: Record<string, unknown> = {}): BlockJson {
  const columns = texts[0].map(() => ({ id: fixtureId(), width: 120 }));
  const rows = texts.map((line) => ({
    id: fixtureId(),
    cells: Object.fromEntries(columns.map((column, c) => [column.id, { markdown: line[c] ?? '' }])),
  }));
  return block('table', order, { header: true, columns, rows, ...extra });
}

/**
 * 3,000 rows of 10 cells, the last a formula: 30,000 cells, past the worker's threshold of 20,000. Each formula also
 * sums the rest of columns B to I, which adds nothing but keeps the worker busy for most of a second.
 */
function bigTable(order: number): BlockJson {
  const head = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  const sum = (r: number) => `=A${r}+1+0*SUM(B${r}:I3000)`;
  const body = Array.from({ length: 3000 }, (_, r) => [...head.slice(0, 9).map((_, c) => `${r + c}`), sum(r + 1)]);
  return tableOf(order, [head, ...body], { sheet: { table: { grid: true } } });
}

/**
 * A header and `count` rows of an item and two numbers, for row virtualization (docs/perf/tables.md). The numbers
 * give the table spreadsheet keys; nothing is a formula, so the engine has nothing to calculate.
 */
function longTable(order: number, count: number): BlockJson {
  const body = Array.from({ length: count }, (_, i) => [`Item ${i + 1}`, String(i + 1), String((i + 1) * 2)]);
  return tableOf(order, [['Item', 'Qty', 'Cost'], ...body]);
}

/**
 * 1,500 rows of 10 cells with data.sheet, the last a formula: 15,000 cells, under the worker's threshold, so each
 * edit calculates the page on its own thread and writes the value cache with the edit (ADR 0061).
 */
function largeSheetTable(order: number): BlockJson {
  const head = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  const body = Array.from({ length: 1500 }, (_, r) => [...head.slice(0, 9).map((_, c) => `${r + c}`), `=A${r + 1}+1`]);
  return tableOf(order, [head, ...body], { sheet: { table: { grid: true } } });
}

/** A short page of highlighted, shaded, and bordered runs: the ones that can clash in forced colors. */
function highlightedRuns(order: number): BlockJson {
  const ids = [fixtureId(), fixtureId(), fixtureId()];
  const side = { style: 'single', width: 0.5, space: 4, color: 'theme:accent1' };
  const markdown = [
    'Plain words.',
    'A <mark data-color="honey">highlighted run</mark> and ' +
      '<span data-shade="indigo"><span data-color="honey">a shaded run</span></span>.',
    'A bordered paragraph.',
  ].join('\n\n');
  const paras = { [ids[2]]: { border: { top: side, bottom: side, start: side, end: side } } };
  return block('text', order, { markdown, ids, paras });
}

/**
 * The 20-page note with the formatting a Word user adds (text design 11): 30 percent of the paragraphs in their own
 * font, size, and color; 50 paragraphs with tab stops; 10 lists with their own number formats; 20 bordered paragraphs.
 * Every element gets an ID, because `paras` is keyed by element ID.
 */
function formattedNote(order: number, reviewed = false): BlockJson {
  const formats = ['decimal', 'lowerLetter', 'upperRoman', 'lowerRoman', 'upperLetter', 'decimalZero', 'ordinal'];
  const ids: string[] = [];
  const paras: Record<string, Record<string, unknown>> = {};
  const lists: Record<string, unknown> = {};
  let paragraph = 0;
  let list = 0;
  // The reviewed variant (B12): footnotes, comments, and suggestions among the formatted paragraphs.
  const notes: Record<string, unknown> = {};
  const comments: Record<string, unknown> = {};
  const suggestions: Record<string, unknown> = {};
  const author = { author: 'Avery Quinn', time: AT };
  const pieces = longNoteMarkdown()
    .split('\n\n')
    .map((piece) => {
      if (piece.startsWith('#')) {
        ids.push(fixtureId());
        return piece;
      }
      if (/^(- |1\. )/.test(piece)) {
        const listId = list < 10 ? `f${list}` : null;
        if (listId) {
          lists[listId] = {
            levels: [{ format: formats[list % formats.length], text: list % 2 === 0 ? '%1.' : '(%1)' }],
          };
          list += 1;
        }
        for (const _item of piece.split('\n')) {
          const id = fixtureId();
          ids.push(id);
          if (listId) paras[id] = { list: { id: listId } };
        }
        return piece;
      }
      const id = fixtureId();
      ids.push(id);
      const n = paragraph++;
      const entry: Record<string, unknown> = {};
      if (n < 50) {
        entry.tabs = [
          { pos: 72, align: 'start' },
          { pos: 288, align: 'end', leader: 'dot' },
        ];
      }
      if (n % 7 === 3 && n < 140) {
        const side = { style: 'single', width: 0.5, space: 4, color: 'theme:accent1' };
        entry.border = { top: side, bottom: side, start: side, end: side };
      }
      if (Object.keys(entry).length > 0) paras[id] = entry;
      const body = n < 50 ? piece.replace(/^(\S+ \S+ \S+) /, '$1\t') : piece;
      const styled =
        n % 10 < 3
          ? `<span data-font="Georgia"><span data-size="12"><span data-color="indigo">${body}</span></span></span>`
          : body;
      if (!reviewed || n >= 150) return styled;
      if (n % 12 === 5) {
        const note = fixtureId();
        notes[note] = { kind: 'foot', markdown: `Note on paragraph ${n}.` };
        return `${styled}[^${note}]`;
      }
      if (n % 12 === 8) {
        const mark = fixtureId();
        comments[mark] = { ...author, markdown: `Check paragraph ${n}.`, replies: [], resolved: false };
        return `<span data-comment="${mark}">${styled}</span>`;
      }
      if (n % 12 === 10) {
        const mark = fixtureId();
        suggestions[mark] = { kind: 'ins', ...author };
        return `${styled}<span data-ins="${mark}"> Added words.</span>`;
      }
      return styled;
    });
  const review = reviewed ? { notes, comments, suggestions } : {};
  return block('text', order, { markdown: pieces.join('\n\n'), ids, paras, lists, ...review });
}

function build(): Record<string, () => PageFixture> {
  return {
    sampler: () =>
      page('Sampler', [
        text(0, SAMPLER_TEXT),
        table(1, 3),
        block('image', 2, { asset: null, alt: 'A missing image' }),
        block('image', 3, { asset: null, alt: 'A cropped image', crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }),
      ]),
    smart: () => page('Smart notes', [text(0, 'Start here.'), table(1, 4)]),
    short: () => page('Short note', [text(0, '# Short note\n\nA few words to type after.')]),
    twentyPage: () => page('A twenty-page note', [text(0, longNoteMarkdown())]),
    twentyPageOutline: () => page('An outline', [text(0, outlineMarkdown())]),
    twentyPageCallout: () =>
      page('A long callout', [
        text(
          0,
          `> [!note] A twenty-page callout\n>\n${longNoteMarkdown().replace(/^/gm, '> ').replace(/^> $/gm, '>')}`,
        ),
      ]),
    freeform8: () =>
      page(
        'Freeform',
        Array.from({ length: 8 }, (_, i) =>
          text(i, i === 0 ? longNoteMarkdown() : `Box ${i + 1}: ${sentences(seeded(i), 2)}`, {
            x: 40 + (i % 4) * 320,
            y: 40 + Math.floor(i / 4) * 400,
            w: i === 0 ? 600 : 280,
          }),
        ),
        { layout: 'freeform' },
      ),
    budget500: () =>
      page(
        'Budget page',
        Array.from({ length: 500 }, (_, i) => {
          if (i % 25 === 3) return block('image', i, { asset: null, alt: `Photo ${i}` });
          if (i % 100 === 7) return table(i, 6);
          if (i % 50 === 11) return text(i, '```ts\nexport const value = 1;\n```');
          return text(i, sentences(seeded(i), 3));
        }),
      ),
    ruled: () => page('Ruled', [text(0, RULED_TEXT), ruledTable(1), text(2, 'Hxn after the table.')]),
    // The ruled lines ten times over, enough to fill five sheets of any paper (and the narrowest rules on the largest
    // paper). The paper is a custom size whose height is not a whole number of page units, so a test can check the
    // rules and the lines on sheets after a break. The View tab's paper sizes replace the custom one.
    ruledSheets: () =>
      page(
        'Ruled sheets',
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [
          text(3 * n, RULED_TEXT),
          ruledTable(3 * n + 1),
          text(3 * n + 2, 'Hxn after the table.'),
        ]),
        {
          layout: 'flow',
          paper: { size: 'custom', orientation: 'portrait', width: 650, height: 901.37 },
        },
      ),
    // A line of text and a picture with no description, for the accessibility checker's main path.
    unlabeled: () =>
      page('Unlabeled picture', [text(0, 'A picture follows.'), block('image', 1, { asset: null, alt: '' })]),
    // These sit last: a fixture's block IDs come from its place in this list, so a new one must not move the others.
    // A table that already has data.sheet, so its formula results are cached with each edit (ADR 0061).
    sheetTable: () =>
      page('Sheet notes', [
        text(0, 'Start here.'),
        tableOf(
          1,
          [
            ['Item', 'Qty', 'Total'],
            ['Pen', '2', '=B1+3'],
            ['Ink', '5', '=C1+B2'],
          ],
          { sheet: { table: { grid: true } } },
        ),
      ]),
    bigTable: () => page('Big table', [text(0, 'Start here.'), bigTable(1)]),
    largeSheetTable: () => page('Large sheet', [text(0, 'Start here.'), largeSheetTable(1)]),
    twentyPageFormatted: () => page('A formatted twenty-page note', [formattedNote(0)]),
    // The formatted note with footnotes, comments, and suggestions (B12 a11y-perf-e2e).
    twentyPageReviewed: () => page('A reviewed twenty-page note', [formattedNote(0, true)]),
    // Highlight, shading, and a border: the runs that can clash in forced colors (a11y-perf-e2e).
    highlightedRuns: () => page('Highlighted runs', [highlightedRuns(0)]),
    // Two tables with Excel's formula rules, for the formula bar: references, errors, and page names across tables.
    formulaTables: () =>
      page('Formula tables', [
        text(0, 'Start here.'),
        tableOf(
          1,
          [
            ['Item', 'Qty', 'Price', 'Total'],
            ['Pen', '2', '3', ''],
            ['Ink', '5', '4', ''],
            ['Pad', '1', '9', ''],
          ],
          { sheet: { v: 1, table: { grid: true } } },
        ),
        text(2, 'Between the tables.'),
        tableOf(
          3,
          [
            ['Label', 'Value'],
            ['Tax', ''],
          ],
          { sheet: { v: 1, table: { grid: true } } },
        ),
      ]),
    // Row virtualization: 10,001 rows (a header and 10,000), and 1,999 rows, one under the threshold.
    tenThousandRows: () => page('Long table', [text(0, 'Start here.'), longTable(1, 10_000)]),
    rows1999: () => page('Shorter table', [text(0, 'Start here.'), longTable(1, 1998)]),
  };
}

export type PageFixtureName =
  | 'sampler'
  | 'smart'
  | 'short'
  | 'twentyPage'
  | 'twentyPageOutline'
  | 'twentyPageCallout'
  | 'freeform8'
  | 'budget500'
  | 'ruled'
  | 'ruledSheets'
  | 'unlabeled'
  | 'sheetTable'
  | 'bigTable'
  | 'largeSheetTable'
  | 'twentyPageFormatted'
  | 'twentyPageReviewed'
  | 'highlightedRuns'
  | 'formulaTables'
  | 'tenThousandRows'
  | 'rows1999';

const made = new Map<PageFixtureName, PageFixture>();
const makers = build();

export function pageFixture(name: PageFixtureName): PageFixture {
  let fixture = made.get(name);
  if (!fixture) {
    // Each fixture has its own range of IDs, so its IDs never depend on which fixtures were built before it.
    ids = Object.keys(makers).indexOf(name) * 1_000_000;
    fixture = makers[name]();
    made.set(name, fixture);
  }
  return fixture;
}

export function isPageFixtureName(name: string | null | undefined): name is PageFixtureName {
  return typeof name === 'string' && name in makers;
}
