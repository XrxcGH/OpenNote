// Where the drawings' things stand and meet, and that every line stays inside its box (docs/BRAND.md section 8).

import { afterEach, describe, expect, it } from 'vitest';
import { renderUi } from '../../test';
import { along, drawn, expectStandsOn, outline, pointsOf, shelfOf, surface } from '../../test/drawing';
import { Books, Candle, DeskScene, EmptyArt, Glint, InkStroke, Notebook, Plant, StarField, Window } from './index';

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

describe('how books rest', () => {
  it('stacks each book on the one below it, neither floating above it nor sinking into it', () => {
    const books = [...drawn(renderUi(<Books />).container).querySelectorAll<SVGGeometryElement>('path[class]')];
    const stack = books.slice(0, 4);
    for (let i = 1; i < stack.length; i++) {
      const below = surface(stack[i - 1]);
      const gaps = outline(stack[i]).map((p) => below(p.x) - p.y);
      // The two edges share a line, so they may meet within half a 1.5 unit stroke of each other.
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(-0.75);
      expect(Math.min(...gaps)).toBeLessThan(0.75);
    }
  });

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
});

describe('where things stand', () => {
  it.each(['notebooks', 'page', 'trash'] as const)('stands everything in the %s drawing on the shelf', (kind) => {
    const svg = drawn(renderUi(<EmptyArt kind={kind} />).container);
    const shelf = surface(shelfOf(svg));
    // The shelf drawing's objects are single shapes; the others are a drawing and a candle, each in a group.
    const things = svg.querySelectorAll(kind === 'notebooks' ? 'g > path:not(:first-child)' : 'g g');
    // Each object near the shelf (a book, the pot, the plant's tendril, the notebook, the stack, the candle) stands
    // on it, never below it.
    const near = [...things].map(pointsOf).filter((points) => points.some((p) => shelf(p.x) - p.y < 1));
    for (const points of near) expectStandsOn(points, shelf);
    expect(near).toHaveLength(kind === 'notebooks' ? 5 : 2);
  });

  it('stands the books, notebook and both candles on the desk, and the plant on the window sill', () => {
    const svg = drawn(renderUi(<DeskScene sky="day" />).container);
    const [frame, plant, books, notebook, candle, shortCandle] = [...svg.querySelectorAll(':scope > g')];
    const desk = surface(svg.querySelector(':scope > path') as SVGGeometryElement);
    for (const thing of [books, notebook, candle, shortCandle]) expectStandsOn(pointsOf(thing), desk);
    // The second candle is the shorter one, and the two dishes don't overlap.
    const extent = (thing: Element) => {
      const points = pointsOf(thing.querySelector('path:nth-of-type(5)') as Element);
      return [Math.min(...points.map((p) => p.x)), Math.max(...points.map((p) => p.x))];
    };
    expect(shortCandle.getBoundingClientRect().height).toBeLessThan(candle.getBoundingClientRect().height);
    expect(extent(shortCandle)[0]).toBeGreaterThan(extent(candle)[1]);
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

  it("keeps the window vine's leaves clear of the stars and the moon", () => {
    const paths = [...drawn(renderUi(<Window sky="night" />).container).querySelectorAll<SVGGeometryElement>('path')];
    const [stars, moon, vine, leaves] = [paths[1], paths[2], paths[5], paths[6]];
    const sky = [...outline(stars, 600), ...outline(moon)];
    let gap = Infinity;
    for (const a of [...outline(vine), ...outline(leaves, 800)]) {
      for (const b of sky) gap = Math.min(gap, Math.hypot(a.x - b.x, a.y - b.y));
    }
    expect(gap).toBeGreaterThan(4);
  });

  it("sets the candle's body down in its dish, not above it", () => {
    const paths = drawn(renderUi(<Candle />).container).querySelectorAll<SVGGeometryElement>('path');
    const [body, saucer] = [paths[2], paths[4]];
    expectStandsOn(outline(body), surface(saucer));
  });
});

describe('inside their boxes', () => {
  const drawings = {
    'the desk scene': <DeskScene sky="day" />,
    'the window at 64 px': <Window sky="day" height={64} />,
    'the window at 103 px': <Window sky="night" />,
    'the About window at 112 px': <Window sky="day" height={112} />,
    'the plant': <Plant />,
    'the books': <Books />,
    'the candle': <Candle />,
    'the notebook': <Notebook />,
    'the notebooks empty state': <EmptyArt kind="notebooks" />,
    'the page empty state': <EmptyArt kind="page" />,
    'the trash empty state': <EmptyArt kind="trash" />,
    'the sun glint': <Glint kind="sun" />,
    'the moon glint': <Glint kind="moon" />,
    'the ink stroke': <InkStroke />,
  };

  it.each(Object.entries(drawings))('keeps every line, stroke, glow and all, inside %s', (_, drawing) => {
    const svg = drawn(renderUi(drawing).container);
    const box = svg.getBoundingClientRect();
    for (const shape of svg.querySelectorAll<SVGGeometryElement>('path, circle')) {
      const style = getComputedStyle(shape);
      // Lines don't scale, so half of each one's width reaches past its path by the same number of pixels. A glow
      // has no line, and its circle is as far as it reaches.
      const half = style.stroke === 'none' ? 0 : parseFloat(style.strokeWidth) / 2;
      const edge = shape.getBoundingClientRect();
      const where = `${shape.tagName} ${shape.getAttribute('d')?.slice(0, 24) ?? shape.getAttribute('class')}`;
      expect(edge.left - half, where).toBeGreaterThanOrEqual(box.left - 0.01);
      expect(edge.top - half, where).toBeGreaterThanOrEqual(box.top - 0.01);
      expect(edge.right + half, where).toBeLessThanOrEqual(box.right + 0.01);
      expect(edge.bottom + half, where).toBeLessThanOrEqual(box.bottom + 0.01);
    }
  });

  it("keeps every star above the page card's top edge by at least 5 px, however wide the canvas", () => {
    document.documentElement.dataset.theme = 'dark';
    // The page card starts one --space-8 margin down the canvas.
    const card = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-8'));
    expect(card).toBe(32);
    for (const width of [600, 1280, 1920, 2560]) {
      const { container, unmount } = renderUi(
        <div style={{ inlineSize: width }}>
          <StarField />
        </div>,
      );
      const top = drawn(container).getBoundingClientRect().top;
      for (const star of container.querySelectorAll('circle')) {
        const dot = star.getBoundingClientRect();
        // Above the edge. A lower star could land on one of the card's side edges, which move with the canvas width.
        const clear = card - (dot.bottom - top);
        expect(clear, `the star at x ${star.getAttribute('cx')} on a ${width} px canvas`).toBeGreaterThanOrEqual(5);
      }
      unmount();
    }
  });
});
