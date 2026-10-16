import { describe, expect, it } from 'vitest';
import { pageLayout } from '../layout/page';
import { sheetCount } from '../pagination/freeform';
import type { Rect } from '../pagination/geometry';
import { pageOf, textBlock } from '../testing/build';
import { waveStroke } from '../testing/samples';
import { inPolygon, pathTouches, rectTouchesPolygon, segmentsCross, type Lasso } from './geometry';
import { cropPage, CROP_INK } from './crop';
import { cropOf, selectArea } from './select';
import { selectionSvg } from './svg';

const square = (x: number, y: number, w: number, h: number): Lasso => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const p = (x: number, y: number) => ({ x, y });

describe('lasso geometry', () => {
  const poly = square(0, 0, 10, 10);

  it('finds points inside a polygon, including a concave one', () => {
    expect(inPolygon(p(5, 5), poly)).toBe(true);
    expect(inPolygon(p(15, 5), poly)).toBe(false);
    const arrow: Lasso = [p(0, 0), p(10, 0), p(5, 4), p(10, 10), p(0, 10)];
    expect(inPolygon(p(8, 5), arrow)).toBe(false);
    expect(inPolygon(p(2, 5), arrow)).toBe(true);
  });

  it('finds crossing and touching segments', () => {
    expect(segmentsCross(p(0, 0), p(10, 10), p(0, 10), p(10, 0))).toBe(true);
    expect(segmentsCross(p(0, 0), p(4, 4), p(5, 5), p(9, 9))).toBe(false);
    expect(segmentsCross(p(0, 0), p(5, 5), p(5, 5), p(9, 0))).toBe(true);
  });

  it('says a path touches the polygon when a point is in it or a segment crosses its edge', () => {
    expect(pathTouches([p(5, 5)], poly)).toBe(true);
    expect(pathTouches([p(-5, 5), p(15, 5)], poly)).toBe(true);
    expect(pathTouches([p(-5, -5), p(-1, 20)], poly)).toBe(false);
    expect(pathTouches([], poly)).toBe(false);
  });

  it('says a rectangle touches the polygon when either holds the other or their edges cross', () => {
    expect(rectTouchesPolygon({ x: 4, y: 4, w: 2, h: 2 }, poly)).toBe(true);
    expect(rectTouchesPolygon({ x: -5, y: -5, w: 30, h: 30 }, poly)).toBe(true);
    expect(rectTouchesPolygon({ x: 8, y: 8, w: 10, h: 10 }, poly)).toBe(true);
    expect(rectTouchesPolygon({ x: -5, y: 4, w: 30, h: 2 }, poly)).toBe(true);
    expect(rectTouchesPolygon({ x: 20, y: 20, w: 5, h: 5 }, poly)).toBe(false);
  });
});

function sample() {
  const strokes = [
    { ...waveStroke('ink1', 110, 400, 200), id: 's-near' },
    { ...waveStroke('ink1', 600, 900, 100), id: 's-far' },
    { ...waveStroke('ink2', 120, 420, 100), id: 's-hidden' },
  ];
  const page = pageOf(
    [
      textBlock('Selected words', { x: 100, y: 100, w: 200, h: 60 }, 'note'),
      { id: 'leaf', type: 'image', data: { asset: 'a1', alt: 'A leaf' }, frame: { x: 400, y: 100, w: 120, h: 80 } },
      textBlock('Far away text', { x: 600, y: 700, w: 150, h: 30 }, 'far'),
      textBlock('A flowing paragraph', undefined, 'flow'),
      { id: 'ink1', type: 'ink', data: { role: 'layer', strokeCount: 2 }, frame: { x: 0, y: 0 } },
      { id: 'ink2', type: 'ink', data: { role: 'layer', strokeCount: 1 }, frame: { x: 0, y: 0 } },
    ],
    {
      strokes,
      assets: {
        a1: { file: 'leaf.png', mime: 'image/png', name: 'leaf.png', width: 120, height: 80 },
        a2: { file: 'other.png', mime: 'image/png', name: 'other.png' },
      },
    },
  );
  const boxes = new Map<string, Rect>([['flow', { x: 50, y: 300, w: 300, h: 40 }]]);
  return { page, boxes };
}

describe('smart select', () => {
  const { page, boxes } = sample();

  it('takes whole items the lasso only touches, and trims to them with padding', () => {
    // The lasso crosses the corner of the text box, the flowing block, and the start of the near stroke.
    const sel = selectArea(page, square(250, 120, 100, 300), { boxes })!;
    expect(sel.blocks).toEqual(['note', 'flow']);
    expect(sel.strokes).toContain('s-near');
    expect(sel.strokes).not.toContain('s-far');
    expect(sel.bounds.x).toBeCloseTo(50, 0);
    expect(sel.bounds.y).toBeCloseTo(100, 0);
    expect(sel.bounds.x + sel.bounds.w).toBeGreaterThanOrEqual(310);
    expect(sel.crop).toEqual({
      x: sel.bounds.x - 12,
      y: sel.bounds.y - 12,
      w: sel.bounds.w + 24,
      h: sel.bounds.h + 24,
    });
    expect(sel.clip).toBeNull();
  });

  it('selects nothing from empty space or from a lasso with fewer than three points', () => {
    expect(selectArea(page, square(900, 20, 50, 50), { boxes })).toBeNull();
    expect(selectArea(page, [p(0, 0), p(10, 10)])).toBeNull();
  });

  it('leaves out ink on a skipped layer', () => {
    const sel = selectArea(page, square(100, 380, 200, 80), { skip: new Set(['ink2']) })!;
    expect(sel.strokes).toEqual(['s-near']);
    expect(selectArea(page, square(100, 380, 200, 80))!.strokes).toEqual(['s-near', 's-hidden']);
  });

  it('needs a measured box to select a flowing block', () => {
    expect(selectArea(page, square(60, 300, 20, 20))).toBeNull();
    expect(selectArea(page, square(60, 300, 20, 20), { boxes })!.blocks).toEqual(['flow']);
  });

  it('makes a small selection at least an inch in each direction, around the same center', () => {
    const sel = selectArea(page, square(120, 110, 10, 10), { padding: 4 })!;
    expect(sel.crop.w).toBeGreaterThanOrEqual(96);
    expect(sel.crop.h).toBeGreaterThanOrEqual(96);
    const mid = { x: sel.bounds.x + sel.bounds.w / 2, y: sel.bounds.y + sel.bounds.h / 2 };
    expect(sel.crop.x + sel.crop.w / 2).toBeCloseTo(mid.x, 1);
    expect(cropOf({ x: 0, y: 0, w: 10, h: 10 }, 2, 50)).toEqual({ x: -20, y: -20, w: 50, h: 50 });
  });
});

describe('exact select', () => {
  const { page } = sample();

  it('keeps the lasso box and the lasso itself for clipping', () => {
    const lasso = square(250, 120, 100, 50);
    const sel = selectArea(page, lasso, { mode: 'exact' })!;
    expect(sel.blocks).toEqual(['note']);
    expect(sel.bounds).toEqual({ x: 250, y: 120, w: 100, h: 50 });
    expect(sel.clip).toBe(lasso);
  });
});

describe('a selection as a page', () => {
  const { page, boxes } = sample();
  const sel = selectArea(page, square(40, 90, 500, 340), { boxes })!;
  const cropped = cropPage(page, sel, { boxes, inkAlt: 'A sketch' });

  it('is one custom sheet the size of the crop', () => {
    const layout = pageLayout(cropped.view);
    expect(layout.sheet.width).toBe(sel.crop.w);
    expect(layout.sheet.height).toBe(sel.crop.h);
    expect(cropped.view.layout).toBe('freeform');
    expect(cropped.view.background.pattern).toBe('plain');
  });

  it('moves every block and stroke so the crop corner is the origin', () => {
    const note = cropped.blocks.find((b) => b.id === 'note')!;
    expect(note.frame).toMatchObject({ x: 100 - sel.crop.x, y: 100 - sel.crop.y, w: 200, h: 60 });
    const original = page.strokes.find((s) => s.id === 's-near')!;
    const stroke = cropped.strokes.find((s) => s.id === 's-near')!;
    expect(stroke.x[0]).toBeCloseTo(original.x[0] - sel.crop.x, 1);
    expect(stroke.y[0]).toBeCloseTo(original.y[0] - sel.crop.y, 1);
    expect(stroke.transform).toBeNull();
    expect(stroke.block).toBe(CROP_INK);
  });

  it('makes a flowing block a floating one where it was laid out', () => {
    const flow = cropped.blocks.find((b) => b.id === 'flow')!;
    expect(flow.frame).toMatchObject({ x: 50 - sel.crop.x, y: 300 - sel.crop.y, w: 300 });
  });

  it('puts the strokes in one ink block with the description, and keeps only the assets it uses', () => {
    const ink = cropped.blocks.find((b) => b.id === CROP_INK);
    expect(ink).toMatchObject({ type: 'ink', alt: 'A sketch', decorative: false, strokeCount: cropped.strokes.length });
    expect(Object.keys(cropped.assets)).toEqual(['a1']);
    expect(cropped.blocks.map((b) => b.id)).not.toContain('far');
  });

  it('folds a stroke transform into its points and width', () => {
    const scaled = { ...page.strokes[0], id: 's-scaled', transform: [2, 0, 0, 2, 10, 0] as const };
    const only = { ...page, strokes: [scaled] };
    const s = selectArea(only, square(100, 700, 600, 200))!;
    const out = cropPage(only, s).strokes[0];
    expect(out.width).toBeCloseTo(scaled.width * 2, 1);
    expect(out.x[0]).toBeCloseTo(2 * scaled.x[0] + 10 - s.crop.x, 1);
  });

  it('fits on one sheet', () => {
    const layout = pageLayout(cropped.view);
    const bottoms = cropped.blocks.map((b) => (b.frame?.y ?? 0) + (b.frame?.h ?? 0));
    expect(sheetCount(layout.sheet, bottoms)).toBe(1);
  });
});

describe('a selection as a picture', () => {
  const { page, boxes } = sample();
  const sel = selectArea(page, square(40, 90, 500, 340), { boxes })!;
  const options = {
    boxes,
    assetUrl: () => 'data:image/png;base64,AAAA',
    background: 'var(--color-surface-page)',
    label: 'Selection',
  };

  it('holds ink as paths, images as images, and text as embedded HTML', () => {
    const svg = selectionSvg(page, sel, options);
    expect(svg).toContain(`viewBox="0 0 ${sel.crop.w} ${sel.crop.h}"`);
    expect(svg).toContain('<image href="data:image/png;base64,AAAA"');
    expect(svg).toContain('aria-label="A leaf"');
    expect(svg).toContain('<foreignObject');
    expect(svg).toContain('Selected words');
    expect(svg).toContain('<path d="M');
    expect(svg).toContain('role="img" aria-label="Selection"');
    expect(svg).not.toContain('Far away text');
    expect(svg).not.toContain('clipPath');
  });

  it('leaves out text when asked, and hides a picture that has no description', () => {
    const svg = selectionSvg(page, sel, { ...options, text: 'omit', label: undefined });
    expect(svg).not.toContain('foreignObject');
    expect(svg).toContain('aria-hidden="true"');
  });

  it('clips an exact selection to the lasso', () => {
    const lasso: Lasso = [p(260, 110), p(420, 130), p(300, 200)];
    const exact = selectArea(page, lasso, { mode: 'exact' })!;
    const svg = selectionSvg(page, exact, options);
    expect(svg).toContain('<clipPath id="selection-clip"><polygon points="');
    expect(svg).toContain('clip-path="url(#selection-clip)"');
  });

  it('keeps embedded styles in a CDATA section so any rule is safe', () => {
    const svg = selectionSvg(page, sel, { ...options, css: 'p > a { margin: 0 } /* ]]> */' });
    expect(svg).toContain('<style><![CDATA[p > a { margin: 0 } /* ]] > */]]></style>');
  });
});
