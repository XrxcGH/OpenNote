import { cdp } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { renderUi } from '../../test';
import { Books, Candle, DeskScene, EmptyArt, Glint, InkStroke, Notebook, Plant, StarField, Window } from './index';

const MOTIFS = {
  'Window by day': <Window sky="day" />,
  'Window by night': <Window sky="night" />,
  Plant: <Plant />,
  Candle: <Candle />,
  Books: <Books />,
  Notebook: <Notebook />,
  'Ink stroke': <InkStroke />,
  'Star field': <StarField />,
  'Desk scene by day': <DeskScene sky="day" />,
  'Desk scene by night': <DeskScene sky="night" />,
  'Notebooks shelf': <EmptyArt kind="notebooks" />,
  'Open notebook with a candle': <EmptyArt kind="page" />,
  'Candle beside a stack': <EmptyArt kind="trash" />,
  'Sun glint': <Glint kind="sun" />,
  'Moon glint': <Glint kind="moon" />,
} as const;

/** A color as the browser computes it, from a token or a system color, for comparing with what a drawing paints. */
function colorOf(value: string): string {
  const probe = document.body.appendChild(document.createElement('div'));
  probe.style.color = value.startsWith('--') ? `var(${value})` : value;
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return computed;
}

const drawn = (container: HTMLElement) => container.querySelector('svg') as SVGSVGElement;

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

describe('every drawing', () => {
  for (const [name, element] of Object.entries(MOTIFS)) {
    it(`${name} is hidden from screen readers, can't take focus, and uses only tokens`, () => {
      const { container } = renderUi(element);
      const svg = drawn(container);
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('focusable')).toBe('false');
      expect(svg.textContent).toBe('');
      const markup = svg.outerHTML;
      expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b(?![^<]*>.*url)/i);
      expect(markup.replace(/url\(#[^)]*\)/g, '')).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(markup).not.toMatch(/rgba?\(|hsla?\(/i);
      expect(markup).not.toContain('style=');
      expect(markup).not.toMatch(/<(filter|animate|animateTransform|image|foreignObject)/i);
    });

    it(`${name} is under 3 KB of markup`, () => {
      const { container } = renderUi(element);
      expect(drawn(container).outerHTML.length).toBeLessThan(3072);
    });
  }

  it('is never wider than the desk scene or taller than it', () => {
    const { container } = renderUi(<DeskScene sky="day" />);
    const box = drawn(container).getBoundingClientRect();
    expect(box.width).toBeLessThanOrEqual(240);
    expect(box.height).toBeLessThanOrEqual(150);
  });

  it('draws its lines 1.5 px wide at any size', () => {
    const { container } = renderUi(<Plant />);
    const line = container.querySelector('path') as SVGPathElement;
    expect(getComputedStyle(line).strokeWidth).toBe('1.5px');
    expect(getComputedStyle(line).vectorEffect).toBe('non-scaling-stroke');
  });
});

/** Points along a shape's outline in its own coordinates, before its own transform. */
const along = (shape: SVGGeometryElement, steps = 400) =>
  Array.from({ length: steps + 1 }, (_, i) =>
    DOMPoint.fromPoint(shape.getPointAtLength((i / steps) * shape.getTotalLength())),
  );

/** Points along a shape's outline in its drawing's own coordinates (the viewBox), after every transform. */
function outline(shape: SVGGeometryElement, steps = 400): DOMPoint[] {
  const svg = shape.ownerSVGElement as SVGSVGElement;
  const toDrawing = (svg.getScreenCTM() as DOMMatrix).inverse().multiply(shape.getScreenCTM() as DOMMatrix);
  return along(shape, steps).map((p) => p.matrixTransform(toDrawing));
}

/** The outline of one shape, or of every shape in a group. */
const pointsOf = (thing: Element) =>
  (thing instanceof SVGGeometryElement
    ? [thing]
    : [...thing.querySelectorAll<SVGGeometryElement>('path, circle')]
  ).flatMap((shape) => outline(shape));

/** An empty state's shelf is the first line in its drawing. */
const shelfOf = (svg: SVGSVGElement) => svg.querySelector('g > path') as SVGGeometryElement;

/** The top of a shelf or desk at a given x, from its outline. */
function surface(line: SVGGeometryElement): (x: number) => number {
  const points = outline(line, 1000);
  return (x) => Math.min(...points.filter((p) => Math.abs(p.x - x) <= 0.5).map((p) => p.y));
}

/** Things stand on a line: no point dips below it, and the lowest one is within a unit of it, so nothing floats. */
function expectStandsOn(points: DOMPoint[], at: (x: number) => number) {
  const gaps = points.map((p) => at(p.x) - p.y);
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(-0.01);
  expect(Math.min(...gaps)).toBeLessThan(1);
}

describe('where things stand', () => {
  it('leans the third book on its bottom-left corner against the moss book, above the shelf', () => {
    const svg = drawn(renderUi(<EmptyArt kind="notebooks" />).container);
    const leaning = svg.querySelector('path[transform]') as SVGGeometryElement;
    const upright = leaning.previousElementSibling as SVGGeometryElement;
    const shelf = surface(shelfOf(svg));
    const lean = outline(leaning);
    expectStandsOn(lean, shelf);
    // Its lowest point is the bottom-left corner, and the bottom-right corner is lifted off the shelf.
    const lowest = lean.reduce((a, b) => (b.y > a.y ? b : a));
    expect([lowest.x, lowest.y]).toEqual([lean[0].x, lean[0].y]);
    // It rests on the moss book without passing into it: no outline point of one is inside the other. Both are
    // compared in their shared parent's coordinates, where the moss book has no transform of its own.
    const tilt = (leaning.transform.baseVal.consolidate() as SVGTransform).matrix;
    const leaningEdge = along(leaning).map((p) => p.matrixTransform(tilt));
    const uprightEdge = along(upright);
    expect(leaningEdge.filter((p) => upright.isPointInFill(p))).toEqual([]);
    expect(uprightEdge.filter((p) => leaning.isPointInFill(p.matrixTransform(tilt.inverse())))).toEqual([]);
    let touch = Infinity;
    for (const a of leaningEdge) for (const b of uprightEdge) touch = Math.min(touch, Math.hypot(a.x - b.x, a.y - b.y));
    expect(touch).toBeLessThan(0.3);
  });

  it.each(['notebooks', 'page', 'trash'] as const)('stands everything in the %s drawing on the shelf', (kind) => {
    const svg = drawn(renderUi(<EmptyArt kind={kind} />).container);
    const shelf = surface(shelfOf(svg));
    // The shelf drawing's objects are single shapes; the others are a drawing and a candle, each in a group.
    const things = svg.querySelectorAll(kind === 'notebooks' ? 'g > path:not(:first-child)' : 'g g');
    // Each object near the shelf (a book, the pot, the notebook, the stack, the candle) stands on it, never below it.
    const near = [...things].map(pointsOf).filter((points) => points.some((p) => shelf(p.x) - p.y < 1));
    for (const points of near) expectStandsOn(points, shelf);
    expect(near).toHaveLength(kind === 'notebooks' ? 4 : 2);
  });

  it('stands the books, notebook and candle on the desk, and the plant on the window sill', () => {
    const svg = drawn(renderUi(<DeskScene sky="day" />).container);
    const [frame, plant, books, notebook, candle] = [...svg.querySelectorAll(':scope > g')];
    const desk = surface(svg.querySelector(':scope > path') as SVGGeometryElement);
    for (const thing of [books, notebook, candle]) expectStandsOn(pointsOf(thing), desk);
    const sill = outline(frame.querySelector('path:last-child') as SVGGeometryElement);
    const sillTop = Math.min(...sill.map((p) => p.y));
    // Every part of the plant stands on the sill without passing into it. That includes the vine's tail.
    expectStandsOn(pointsOf(plant), () => sillTop);
  });
});

describe('where things meet', () => {
  it("keeps the plant's left leaf clear of the window's middle bar", () => {
    const svg = drawn(renderUi(<DeskScene sky="day" />).container);
    const [frame, plant] = [...svg.querySelectorAll(':scope > g')];
    const bars = outline(frame.querySelector('path[d^="M50"]') as SVGGeometryElement, 1000);
    const leftLeaf = outline(plant.querySelectorAll<SVGGeometryElement>('path')[4]);
    let gap = Infinity;
    for (const a of leftLeaf) for (const b of bars) gap = Math.min(gap, Math.hypot(a.x - b.x, a.y - b.y));
    // Two 1.5 px strokes meet at 1.5 units apart; 3 leaves a clear line of sky between them.
    expect(gap).toBeGreaterThan(3);
  });

  it("sets the candle's body down in its dish, not above it", () => {
    const paths = drawn(renderUi(<Candle />).container).querySelectorAll<SVGGeometryElement>('path');
    const [body, saucer] = [paths[2], paths[4]];
    expectStandsOn(outline(body), surface(saucer));
  });
});

describe('in both themes', () => {
  it.each(['light', 'dark'] as const)('paints the window with the %s theme tokens', (theme) => {
    document.documentElement.dataset.theme = theme;
    const day = renderUi(<Window sky="day" />);
    const [sky, sun] = [day.container.querySelector('path'), day.container.querySelector('circle')] as Element[];
    expect(getComputedStyle(sky).fill).toBe(colorOf('--color-accent-candle-subtle'));
    expect(getComputedStyle(sun).fill).toBe(colorOf('--color-ambient-spark'));
    expect(getComputedStyle(sun).stroke).toBe(colorOf('--color-accent-candle'));
    day.unmount();
    const night = renderUi(<Window sky="night" />);
    const [pane, stars, moon] = [...night.container.querySelectorAll('path')];
    expect(getComputedStyle(pane).fill).toBe(colorOf('--color-accent-night-subtle'));
    expect(getComputedStyle(stars).stroke).toBe(colorOf('--color-ambient-spark'));
    expect(getComputedStyle(moon).fill).toBe(colorOf('--color-ambient-spark'));
    expect(getComputedStyle(moon).stroke).toBe(colorOf('--color-accent-night'));
  });

  it('draws lines in the control border color, so they read below the text', () => {
    for (const theme of ['light', 'dark'] as const) {
      document.documentElement.dataset.theme = theme;
      const { container, unmount } = renderUi(<Books />);
      expect(getComputedStyle(container.querySelector('path') as Element).stroke).toBe(
        colorOf('--color-border-control'),
      );
      unmount();
    }
  });

  it('gives the two themes different sky colors', () => {
    document.documentElement.dataset.theme = 'light';
    const light = colorOf('--color-ambient-canvas-top');
    document.documentElement.dataset.theme = 'dark';
    expect(colorOf('--color-ambient-canvas-top')).not.toBe(light);
  });
});

describe('motion', () => {
  it('fades in once over the fast duration and never loops', () => {
    const { container } = renderUi(<DeskScene sky="day" />);
    const style = getComputedStyle(drawn(container));
    expect(style.animationIterationCount).toBe('1');
    expect(style.animationDuration).toBe('0.15s');
    expect(style.animationName).not.toBe('none');
  });

  it('does not fade in with reduced motion', () => {
    document.documentElement.dataset.motion = 'reduce';
    const { container } = renderUi(<Candle />);
    expect(getComputedStyle(drawn(container)).animationName).toBe('none');
    delete document.documentElement.dataset.motion;
  });

  it('stays behind the page and out of the way of the pointer', () => {
    const { container } = renderUi(<StarField />);
    const style = getComputedStyle(drawn(container));
    expect(style.pointerEvents).toBe('none');
    expect(Number(style.zIndex)).toBeLessThan(0);
  });
});

describe('under a Windows contrast theme', () => {
  const emulate = (value: 'active' | 'none') =>
    cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value }] });

  afterEach(() => emulate('none'));

  it('draws plain outlines in the text color, with no fills', async () => {
    await emulate('active');
    const { container } = renderUi(<DeskScene sky="day" />);
    const shapes = [...container.querySelectorAll('path, circle')];
    const text = colorOf('CanvasText');
    expect(shapes.length).toBeGreaterThan(10);
    for (const shape of shapes) {
      expect(getComputedStyle(shape).fill).toBe('none');
      expect(getComputedStyle(shape).stroke).toBe(text);
    }
  });

  it('hides the stars, which the evening theme otherwise shows', async () => {
    document.documentElement.dataset.theme = 'dark';
    const shown = renderUi(<StarField />);
    expect(getComputedStyle(drawn(shown.container)).display).toBe('block');
    shown.unmount();
    await emulate('active');
    const hidden = renderUi(<StarField />);
    expect(getComputedStyle(drawn(hidden.container)).display).toBe('none');
  });
});
