import { describe, expect, it } from 'vitest';
import type { BlockJson, PageJson } from '../../services/pages/types';
import { checkPage, contrast, imageAltEdits } from './check';

let counter = 0;
function block(type: string, data: Record<string, unknown>, extra: Partial<BlockJson> = {}): BlockJson {
  counter += 1;
  return {
    id: `b${counter}` as BlockJson['id'],
    type,
    order: `a${counter}`,
    created: '2026-01-01T00:00:00Z',
    modified: '2026-01-01T00:00:00Z',
    data,
    ...extra,
  };
}

function page(blocks: BlockJson[], view: PageJson['view'] = {}): PageJson {
  return {
    id: 'p1' as PageJson['id'],
    title: 'A page',
    created: '2026-01-01T00:00:00Z',
    modified: '2026-01-01T00:00:00Z',
    tags: [],
    view,
    blocks,
    assets: {},
  };
}

describe('accessibility checker', () => {
  it('passes a plain page', () => {
    const clean = page([block('text', { markdown: '## Intro\n\nHello.\n\n### Detail' })]);
    expect(checkPage(clean)).toEqual([]);
  });

  it('finds an image with no description, and accepts a decorative one', () => {
    const issues = checkPage(page([block('image', { alt: '' }), block('image', { alt: '', decorative: true })]));
    expect(issues.map((issue) => issue.kind)).toEqual(['imageAlt']);
    expect(imageAltEdits('b1', ' A graph ', false)[0]).toMatchObject({ data: { alt: 'A graph', decorative: false } });
  });

  it('finds a skipped heading level and fixes it to the next level', () => {
    const [issue] = checkPage(page([block('text', { markdown: '## One\n\n#### Four' })]));
    expect(issue.kind).toBe('headingSkip');
    expect(issue.params).toMatchObject({ from: 2, to: 4, fixed: 3 });
    expect(issue.fix).toMatchObject({ kind: 'edits', edits: [{ edit: 'setText', markdown: '## One\n\n### Four' }] });
  });

  it('wants a header row on a table with several rows', () => {
    const rows = [{}, {}];
    expect(checkPage(page([block('table', { rows, header: false })])).map((i) => i.kind)).toEqual(['tableHeader']);
    expect(checkPage(page([block('table', { rows, header: true })]))).toEqual([]);
    expect(checkPage(page([block('table', { rows: [{}], header: false })]))).toEqual([]);
  });

  it('measures contrast against white and flags pale text colors', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrast('red', '#ffffff')).toBeNull();
    const pale = block('text', { markdown: 'See <span data-color="#cccccc">this</span> part' });
    const [issue] = checkPage(page([pale]));
    expect(issue.kind).toBe('lowContrast');
    expect(issue.fix).toMatchObject({ edits: [{ markdown: 'See this part' }] });
    expect(checkPage(page([block('text', { markdown: 'See <span data-color="#222222">this</span>' })]))).toEqual([]);
  });

  it('flags meaning carried by color alone and bolds the colored text as the fix', () => {
    const text = '<span data-color="fern">Yes</span> and <span data-color="brick">No</span>';
    const [issue] = checkPage(page([block('text', { markdown: text })]));
    expect(issue.kind).toBe('colorOnly');
    const edit = issue.fix.kind === 'edits' ? issue.fix.edits[0] : null;
    expect(edit).toMatchObject({ markdown: expect.stringContaining('**Yes**') });
    expect(
      checkPage(
        page([
          block('text', {
            markdown: '**<span data-color="fern">Yes</span>** and <span data-color="brick">**No**</span>',
          }),
        ]),
      ),
    ).toEqual([]);
  });

  it('asks a free-form page for a reading order', () => {
    const frame = (x: number, y: number) => ({ frame: { x, y, w: 10, h: 10 } }) as Partial<BlockJson>;
    const blocks = [block('text', { markdown: 'b' }, frame(0, 50)), block('text', { markdown: 'a' }, frame(0, 0))];
    const [issue] = checkPage(page(blocks, { layout: 'freeform' }));
    expect(issue.kind).toBe('readingOrder');
    expect(issue.fix).toMatchObject({
      edits: [{ edit: 'setPage', view: { readingOrder: [blocks[1].id, blocks[0].id] } }],
    });
    expect(checkPage(page(blocks, { layout: 'freeform', readingOrder: [blocks[1].id, blocks[0].id] }))).toEqual([]);
  });
});
