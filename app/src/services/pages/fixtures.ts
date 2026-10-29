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
  | 'ruledSheets';

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
