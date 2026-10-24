// What the wireframes and the social preview draw, checked by the numbers (docs/BRAND.md section 8). Like the app's
// drawing tests, these check that things stand on the line under them and never below it. A leaf grows from the
// stem it touches. Every arrow ends in a head whose tip is the end of its line. Nothing is cut off by its picture
// or sits on a label. Run with: npm run test:design

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DESK, PLANT, WINDOW } from '../../../app/src/ui/illustrations/shapes.ts';
import { deskScene, plantPot } from '../lib/drawings.ts';
import { palette } from '../lib/svg.ts';
import { allScreens } from '../screens/all.ts';
import { socialPreview } from '../social-preview.ts';
import {
  type El,
  type Pt,
  densify,
  dist,
  flatten,
  gapBetween,
  within,
  lowest,
  named,
  outlineOf,
  parseSvg,
  pointsUnder,
  scaleOf,
  textBox,
  toPicture,
  walk,
} from './geometry.ts';

const SOCIAL = 'social-preview.svg';
const pictures = [
  ...allScreens().map((s) => ({ name: s.file, root: parseSvg(s.svg) })),
  { name: SOCIAL, root: parseSvg(socialPreview()) },
];
const picture = (name: string) => pictures.find((p) => p.name === name)?.root as El;

const only = (root: El, part: string): El => {
  const found = named(root, part);
  assert.equal(found.length, 1, `one "${part}"`);
  return found[0];
};

/** Things stand on a line: no point dips below it, and the lowest one is within a unit of it, so nothing floats. */
function expectStandsOn(points: Pt[], line: number, unit = 1) {
  const gap = line - lowest(points);
  assert.ok(gap >= -0.01 * unit, `dips ${-gap} below the line`);
  assert.ok(gap < unit, `floats ${gap} above the line`);
}

describe('where the things on the desk stand', () => {
  const scenes = [
    { sky: 'day', theme: 'light', scale: 1.3 },
    { sky: 'night', theme: 'dark', scale: 1 },
    { sky: 'day', theme: 'light', scale: 1.5 },
  ] as const;

  for (const { sky, theme, scale } of scenes) {
    const root = parseSvg(deskScene(palette(theme), 17, 29, scale));
    const desk = pointsUnder(only(root, 'desk'));
    const deskTop = Math.min(...desk.map((p) => p.y));
    const [left, right] = [Math.min(...desk.map((p) => p.x)), Math.max(...desk.map((p) => p.x))];

    it(`puts the desk line at its y in the ${sky} scene at ${scale} times`, () => {
      assert.ok(Math.abs(deskTop - (29 + DESK.top * scale)) < 1e-9);
    });

    for (const name of ['books', 'notebook', 'candle', 'short-candle']) {
      it(`stands the ${name} on the desk line, none of it below, at ${scale} times`, () => {
        const points = pointsUnder(only(root, name));
        assert.ok(Math.min(...points.map((p) => p.x)) >= left && Math.max(...points.map((p) => p.x)) <= right);
        expectStandsOn(points, deskTop, scale);
      });
    }

    it(`sets each candle's flame above its dish, and the short candle's lower than the tall one's`, () => {
      const flames = ['candle', 'short-candle'].map((name) => {
        const part = only(root, name);
        const flame = pointsUnder(only(part, 'flame'));
        assert.ok(lowest(flame) < Math.min(...pointsUnder(only(part, 'candle-body')).map((p) => p.y)), 'on its wick');
        return Math.min(...flame.map((p) => p.y));
      });
      assert.ok(flames[1] > flames[0]);
    });

    it(`stands the plant's pot on the window sill, not through it, at ${scale} times`, () => {
      const sillTop = Math.min(...pointsUnder(only(root, 'sill')).map((p) => p.y));
      expectStandsOn(pointsUnder(only(root, 'pot')), sillTop, scale);
      // The whole plant, vine tail included, stays above the sill.
      assert.ok(lowest(pointsUnder(only(root, 'plant'))) <= sillTop + 0.01 * scale);
    });

    it(`keeps every part of the desk inside its 240 by 150 box at ${scale} times`, () => {
      const all = pointsUnder(root);
      assert.ok(Math.min(...all.map((p) => p.x)) >= 17 - 1e-9 && Math.min(...all.map((p) => p.y)) >= 29 - 1e-9);
      assert.ok(Math.max(...all.map((p) => p.x)) <= 17 + 240 * scale && lowest(all) <= 29 + 150 * scale);
    });
  }

  it('keeps the sky in the window, with the sun or the moon, and nothing below the sill', () => {
    for (const theme of ['light', 'dark'] as const) {
      const window = only(parseSvg(deskScene(palette(theme), 0, 0, 1)), 'window');
      const sill = Math.min(...pointsUnder(only(window, 'sill')).map((p) => p.y));
      assert.ok(lowest(pointsUnder(only(window, 'sky'))) <= sill + 0.01);
    }
  });
});

describe('where the vine and its leaves meet', () => {
  const window = only(parseSvg(deskScene(palette('light'), 0, 0, 1)), 'window');
  const size = scaleOf(toPicture(window));
  const stem = pointsUnder(only(window, 'vine'));
  const leaves = named(window, 'leaf');

  it('grows all seven leaves, each from a point on the stem', () => {
    assert.equal(leaves.length, WINDOW.leaves.length);
    for (const leaf of leaves) {
      const base = outlineOf(leaf)[0].pts[0];
      assert.ok(Math.min(...stem.map((p) => dist(p, base))) / size < 0.05, 'the leaf starts on the stem');
    }
  });

  it("keeps the leaves clear of both of the window's bars and the sill", () => {
    // The upright bar with the crosspiece, each with the points along their straight lines.
    const bars = densify(outlineOf(only(window, 'window-bars')), 0.25);
    const sill = densify(outlineOf(only(window, 'sill')), 0.25);
    for (const leaf of leaves) {
      const points = outlineOf(leaf)[0].pts;
      assert.ok(gapBetween(points, bars) / size > 1.5);
      assert.ok(gapBetween(points, sill) / size > 1.5);
    }
  });
});

describe('how each leaf meets its stem, and the window frame', () => {
  // In the shapes' own units, where a line is 1.5 units wide at most. The app and the generator draw these strings.
  const LINE = 1.5;
  const angle = (u: Pt, v: Pt) =>
    (Math.acos((u.x * v.x + u.y * v.y) / Math.hypot(u.x, u.y) / Math.hypot(v.x, v.y)) * 180) / Math.PI;
  const vines = [
    { name: 'the window vine', stem: WINDOW.vine, leaves: WINDOW.leaves },
    { name: "the plant's trailing vine", stem: PLANT.trailing, leaves: PLANT.trailingLeaves },
  ];

  for (const { name, stem, leaves } of vines) {
    const line = densify(flatten(stem), 0.05);
    leaves.forEach((d, i) => {
      it(`grows leaf ${i} on ${name} from one point of its stem and away from it`, () => {
        const leaf = densify(flatten(d), 0.05);
        const base = leaf[0];
        const at = line.reduce((best, p, j) => (dist(p, base) < dist(line[best], base) ? j : best), 0);
        assert.ok(dist(line[at], base) < 0.1, 'its base is on the stem');
        // Past 3 units from the base, the stem neither runs inside the leaf nor comes within a line's width of its
        // edge, so the two meet at the base and nowhere else. A leaf lying along its stem fails here.
        const far = line.filter((p) => dist(p, base) > 3);
        assert.equal(far.filter((p) => within(p, leaf)).length, 0, 'the stem runs inside the leaf');
        assert.ok(gapBetween(far, leaf) > LINE, `the stem comes ${gapBetween(far, leaf).toFixed(2)} from the leaf`);
        // The leaf's midline turns at least 60 degrees from the stem, each way the stem goes from its base.
        const tip = leaf.reduce((a, b) => (dist(b, base) > dist(a, base) ? b : a));
        const midline = { x: tip.x - base.x, y: tip.y - base.y };
        for (const way of [-1, 1]) {
          let j = at;
          while (line[j + way] && dist(line[j], line[at]) < LINE) j += way;
          if (j === at) continue; // the stem ends at this leaf
          const along = { x: line[j].x - line[at].x, y: line[j].y - line[at].y };
          assert.ok(angle(midline, along) >= 60, `${angle(midline, along).toFixed(0)} degrees from the stem`);
        }
      });
    });
  }

  it('lays each window leaf clear of the frame, or across it like the vine, never along it or just touching it', () => {
    const frame = densify(flatten(WINDOW.sky), 0.05);
    WINDOW.leaves.forEach((d, i) => {
      const leaf = densify(flatten(d), 0.05);
      const under = frame.filter((p) => within(p, leaf));
      if (under.length === 0) {
        // Clear of it: two lines a line's width apart only just touch, so more than that.
        assert.ok(gapBetween(frame, leaf) > LINE, `leaf ${i} is ${gapBetween(frame, leaf).toFixed(2)} from the frame`);
        return;
      }
      // Across it: the frame under the leaf makes at least 35 degrees with the leaf's midline.
      const base = leaf[0];
      const tip = leaf.reduce((a, b) => (dist(b, base) > dist(a, base) ? b : a));
      const run = { x: (under.at(-1) as Pt).x - under[0].x, y: (under.at(-1) as Pt).y - under[0].y };
      const cross = angle({ x: tip.x - base.x, y: tip.y - base.y }, run);
      assert.ok(Math.min(cross, 180 - cross) >= 35, `leaf ${i} lies ${cross.toFixed(0)} degrees along the frame`);
    });
  });
});

describe('arrows', () => {
  const arrows = pictures.flatMap(({ name, root }) => named(root, 'arrow').map((el) => ({ name, root, el })));

  it('finds the arrows in the social preview, the page editor, the organize view, and the recording', () => {
    const where = new Set(arrows.map((a) => a.name));
    assert.ok(where.has(SOCIAL));
    assert.ok(arrows.length >= 4, `only ${arrows.length} arrows`);
  });

  it('ends every arrow in a head of two strokes that start at the tip, which is the end of the arrow line', () => {
    for (const { name, el } of arrows) {
      const runs = outlineOf(el);
      assert.equal(runs.length, 3, `${name}: a line and two strokes`);
      const [shaft, ...barbs] = runs;
      const tip = shaft.pts.at(-1) as Pt;
      const before = shaft.pts.at(-4) as Pt;
      const back = Math.atan2(before.y - tip.y, before.x - tip.x);
      const sides: number[] = [];
      for (const { pts } of barbs) {
        assert.ok(dist(pts[0], tip) < 0.01, `${name}: a head stroke starts at the tip`);
        const end = pts.at(-1) as Pt;
        assert.ok(dist(end, tip) > 8 && dist(end, tip) < 14, `${name}: a head stroke is 8 to 14 long`);
        let lean = Math.atan2(end.y - tip.y, end.x - tip.x) - back;
        lean = Math.atan2(Math.sin(lean), Math.cos(lean));
        assert.ok(Math.abs(lean) > 0.35 && Math.abs(lean) < 0.65, `${name}: leans 20 to 37 degrees off the line`);
        sides.push(Math.sign(lean));
      }
      assert.deepEqual(sides.toSorted(), [-1, 1], `${name}: one stroke on each side`);
    }
  });

  it('starts every arrow that comes from a circled mark on the mark and leaves it outward, not floating or inside', () => {
    let drawn = 0;
    for (const { name, root, el } of arrows) {
      const circles = named(root, 'circled');
      if (circles.length === 0) continue;
      const mark = outlineOf(circles[0])[0].pts;
      const [x0, x1] = [Math.min(...mark.map((p) => p.x)), Math.max(...mark.map((p) => p.x))];
      const [y0, y1] = [Math.min(...mark.map((p) => p.y)), Math.max(...mark.map((p) => p.y))];
      const inside = (p: Pt) =>
        (((p.x - (x0 + x1) / 2) / (x1 - x0)) * 2) ** 2 + (((p.y - (y0 + y1) / 2) / (y1 - y0)) * 2) ** 2;
      const shaft = outlineOf(el)[0].pts;
      assert.ok(
        Math.abs(inside(shaft[0]) - 1) < 0.01,
        `${name}: starts on the edge of the ellipse (${inside(shaft[0])})`,
      );
      // The mark's own line and the arrow's line meet there, so the arrow may not enter the ellipse after it.
      for (const p of shaft.slice(1)) assert.ok(inside(p) >= 1 - 1e-6, `${name}: stays outside the ellipse`);
      drawn += 1;
    }
    assert.ok(drawn >= 2, 'the social preview and the page editor');
  });

  it("points the nucleus label's arrow at the nucleus, with its tip on the edge", () => {
    const sample = arrows.filter((a) => named(a.root, 'nucleus').length > 0);
    assert.ok(sample.length >= 1);
    for (const { el, root } of sample) {
      const tip = outlineOf(el)[0].pts.at(-1) as Pt;
      const nucleus = outlineOf(only(root, 'nucleus'))[0].pts;
      assert.ok(Math.min(...nucleus.map((p) => dist(p, tip))) < 0.5);
    }
  });

  it('keeps every arrow clear of the labels and bullets around it', () => {
    for (const { name, root, el } of arrows) {
      const points = outlineOf(el).flatMap((r) => r.pts);
      for (const label of [...walk(root)].filter((e) => e.tag === 'text' && e.text.trim() !== '')) {
        const box = textBox(label);
        for (const p of points) {
          const hit = p.x > box.x0 - 2 && p.x < box.x1 + 2 && p.y > box.y0 - 2 && p.y < box.y1 + 2;
          assert.ok(!hit, `${name}: the arrow passes through "${label.text}" at ${p.x.toFixed(0)},${p.y.toFixed(0)}`);
        }
      }
    }
  });
});

describe('the plant in the notebooks pane', () => {
  it('stands the pot on the line it is given, in every wireframe with a pane and in the social preview', () => {
    const root = parseSvg(plantPot(palette('light'), 100, 700));
    expectStandsOn(pointsUnder(only(root, 'pot')), 700);
    const withPane = pictures.filter((p) => named(p.root, 'plant-pot').length > 0);
    assert.ok(withPane.length >= 15, `${withPane.length} pictures`);
    for (const { name, root: tree } of withPane) {
      const pot = pointsUnder(only(only(tree, 'plant-pot'), 'pot'));
      // The window's foot is the picture's height less its 44 px legend, or the window's own bottom edge in the preview.
      const height = name === SOCIAL ? 568 : Number(tree.children[0].attrs.height) - 44;
      // The pane's foot: the pot stands 8 to 16 above the bottom of the window, never touching its edge.
      assert.ok(
        height - lowest(pot) >= 8 && height - lowest(pot) <= 16,
        `${name}: base ${height - lowest(pot)} from the foot`,
      );
    }
  });
});

describe('the social preview', () => {
  const root = picture(SOCIAL);

  it('keeps the desk clear of the words beside it and inside the 40 px margin', () => {
    const desk = pointsUnder(only(root, 'desk-scene'));
    for (const label of [...walk(root)].filter((e) => e.tag === 'text' && e.text.trim() !== '')) {
      const box = textBox(label);
      if (box.x0 > 590) continue;
      const hit = desk.some((p) => p.x > box.x0 && p.x < box.x1 && p.y > box.y0 && p.y < box.y1);
      assert.ok(!hit, `"${label.text}" is over the desk`);
    }
    assert.ok(Math.min(...desk.map((p) => p.x)) >= 40 && lowest(desk) <= 640 - 40);
  });
});

describe('inside their pictures', () => {
  it('keeps every line, circle, box and label of every wireframe inside the picture, never cut off by its edge', () => {
    for (const { name, root } of pictures) {
      const svg = root.children[0];
      const [width, height] = [Number(svg.attrs.width), Number(svg.attrs.height)];
      // A shape cut off on purpose, by a clip on it or around it, is left out; so is a clip's own outline.
      const cut = (e: El): boolean =>
        Boolean(e.attrs['clip-path']) || e.tag === 'clipPath' || (e.parent !== undefined && cut(e.parent));
      const clipped = [...walk(svg)].filter((e) => !cut(e) && ['path', 'circle', 'rect'].includes(e.tag));
      for (const el of clipped) {
        for (const p of outlineOf(el).flatMap((r) => r.pts)) {
          // A line is as wide as its stroke; half of it reaches past the path, so a shape may sit on the edge.
          assert.ok(
            p.x >= -0.01 && p.x <= width + 0.01 && p.y >= -0.01 && p.y <= height + 0.01,
            `${name}: ${el.tag} at ${p.x},${p.y}`,
          );
        }
      }
    }
  });
});

const lines = (root: El) =>
  [...walk(root)].filter((e) => e.tag === 'text').map((e) => ({ e, box: textBox(e), y: Number(e.attrs.y) }));

describe('lines of text', () => {
  it('sets the pieces of a line one after another in one text, never as pieces that crowd or overlap', () => {
    for (const { name, root } of pictures) {
      const all = lines(root).filter((t) => (t.e.attrs['text-anchor'] ?? 'start') === 'start');
      for (const a of all) {
        for (const b of all) {
          if (a === b || Math.abs(a.y - b.y) > 0.5 || b.box.x0 <= a.box.x0) continue;
          // Pieces of one line share its size and font; a menu over a chip does not.
          const same = (k: string) => a.e.attrs[k] === b.e.attrs[k];
          if (!same('font-size') || !same('font-family')) continue;
          const gap = b.box.x0 - a.box.x1;
          // Two texts on one line either stand apart or are one line of runs, which the browser spaces itself.
          assert.ok(gap >= 6 || gap < -3, `${name}: "${a.e.text}" and "${b.e.text}" are ${gap.toFixed(1)} px apart`);
        }
      }
    }
  });

  it('fits each highlight to the words it marks, as far past one end as the other', () => {
    const p = palette('light');
    const highlighters = new Set(['Honey', 'Mint'].map((name) => p.highlighter(name)));
    let checked = 0;
    for (const { name, root } of pictures) {
      const texts = lines(root);
      for (const band of [...walk(root)].filter((e) => e.tag === 'rect' && highlighters.has(e.attrs.fill ?? ''))) {
        const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => Number(band.attrs[k]));
        // The words it marks start just inside it and sit on a baseline within it.
        const words = texts.find((t) => t.box.x0 >= x && t.box.x0 <= x + 8 && t.y > y && t.y <= y + h);
        if (!words) continue;
        const [before, after] = [words.box.x0 - x, x + w - words.box.x1];
        assert.ok(
          Math.abs(before - after) <= 1.5,
          `${name}: "${words.e.text}" has ${before} and ${after.toFixed(1)} px`,
        );
        checked++;
      }
    }
    assert.ok(checked >= 3, `${checked} highlights over words`);
  });
});

describe('words and controls on cards', () => {
  it('keeps the words on a card or dialog inside it', () => {
    for (const { name, root } of pictures) {
      const order = [...walk(root)];
      const cards = order.filter((e) => e.tag === 'rect' && e.attrs.filter === 'url(#shadow)');
      for (const t of lines(root)) {
        const at = order.indexOf(t.e);
        const x = Number(t.e.attrs.x);
        // The card it is written on is the last one drawn before it under the point where it starts.
        const card = cards
          .filter((c) => order.indexOf(c) < at)
          .map((c) => ({
            x0: +c.attrs.x,
            y0: +c.attrs.y,
            x1: +c.attrs.x + +c.attrs.width,
            y1: +c.attrs.y + +c.attrs.height,
          }))
          .filter((c) => x > c.x0 && x < c.x1 && t.y > c.y0 && t.y < c.y1)
          .at(-1);
        if (!card) continue;
        assert.ok(t.box.x0 >= card.x0 && t.box.x1 <= card.x1, `${name}: "${t.e.text}" runs past its card's edge`);
      }
    }
  });

  it('keeps every button and field clear of the others', () => {
    for (const { name, root } of pictures) {
      const controls = [...walk(root)]
        .filter((e) => e.tag === 'rect' && e.attrs.height === '34')
        .map((e) => ({ x0: +e.attrs.x, y0: +e.attrs.y, x1: +e.attrs.x + +e.attrs.width, y1: +e.attrs.y + 34 }));
      for (let i = 0; i < controls.length; i++) {
        for (let j = i + 1; j < controls.length; j++) {
          const [a, b] = [controls[i], controls[j]];
          const apart = a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0;
          assert.ok(apart, `${name}: controls at ${a.x0},${a.y0} and ${b.x0},${b.y0} overlap`);
        }
      }
    }
  });
});

describe('keep-out zones', () => {
  it('draws no keep-out zone of the window over a card or dialog in front of it', () => {
    const over: string[] = [];
    for (const { name, root } of pictures) {
      const order = [...walk(root)];
      const box = (e: El) => ({
        x0: +e.attrs.x,
        y0: +e.attrs.y,
        x1: +e.attrs.x + +e.attrs.width,
        y1: +e.attrs.y + +e.attrs.height,
      });
      // A raised card, dialog, or menu has rounded corners; a sheet of paper, whose margins may be marked, has none.
      const cards = order.filter(
        (e) => e.tag === 'rect' && e.attrs.filter === 'url(#shadow)' && Number(e.attrs.rx) > 0,
      );
      for (const zone of order.filter((e) => e.tag === 'rect' && e.attrs.fill === 'url(#hatch)')) {
        const z = box(zone);
        for (const card of cards.filter((c) => order.indexOf(c) < order.indexOf(zone)).map(box)) {
          const apart = z.x1 <= card.x0 || card.x1 <= z.x0 || z.y1 <= card.y0 || card.y1 <= z.y0;
          if (!apart)
            over.push(`${name}: a keep-out zone at ${z.x0},${z.y0} is drawn over a card at ${card.x0},${card.y0}`);
        }
      }
    }
    assert.deepEqual(over, []);
  });
});

describe('ink marks', () => {
  it('circles something with every circled mark, never an empty patch of page', () => {
    let checked = 0;
    for (const { name, root } of pictures) {
      for (const ring of named(root, 'circled')) {
        const pts = outlineOf(ring).flatMap((run) => run.pts);
        const [x0, x1] = [Math.min(...pts.map((q) => q.x)), Math.max(...pts.map((q) => q.x))];
        const [y0, y1] = [Math.min(...pts.map((q) => q.y)), Math.max(...pts.map((q) => q.y))];
        // Some words lie inside the ring's box: the ring is round them.
        const inside = lines(root).some(
          (t) => t.box.x1 > x0 && t.box.x0 < x1 && (t.box.y0 + t.box.y1) / 2 > y0 && (t.box.y0 + t.box.y1) / 2 < y1,
        );
        assert.ok(inside, `${name}: the circled mark at ${x0.toFixed(0)},${y0.toFixed(0)} circles nothing`);
        checked++;
      }
    }
    assert.ok(checked >= 2);
  });

  it('keeps every handwritten label clear of the ink around it', () => {
    for (const { name, root } of pictures) {
      const strokes = [...walk(root)].filter(
        (e) => e.tag === 'path' && e.attrs['stroke-linecap'] === 'round' && e.attrs.fill === 'none' && e.attrs.d,
      );
      for (const label of lines(root).filter((t) => t.e.attrs['font-style'] === 'italic')) {
        for (const stroke of strokes) {
          const half = Number(stroke.attrs['stroke-width'] ?? 1.5) / 2;
          const { x0, x1, y0, y1 } = label.box;
          // The distance from the label's box to the nearest point of the stroke's line.
          const gap = Math.min(
            ...densify(outlineOf(stroke), 1).map((q) =>
              Math.hypot(Math.max(x0 - q.x, 0, q.x - x1), Math.max(y0 - q.y, 0, q.y - y1)),
            ),
          );
          assert.ok(gap - half >= 2, `${name}: "${label.e.text}" is ${(gap - half).toFixed(1)} px from a stroke`);
        }
      }
    }
  });
});

describe('the social preview', () => {
  it('charts "Sales, Cost by Month" as a Sales bar and a Cost bar for each month', () => {
    const p = palette('light');
    const [sales, cost] = [p.pen('Indigo'), p.pen('Amber')];
    const bars = [...walk(picture(SOCIAL))]
      // The bars, not the small colored squares of the notebooks in the tree.
      .filter((e) => e.tag === 'rect' && [sales, cost].includes(e.attrs.fill ?? '') && Number(e.attrs.height) > 12)
      .sort((a, b) => Number(a.attrs.x) - Number(b.attrs.x));
    assert.ok(bars.length >= 4 && bars.length % 2 === 0, `${bars.length} bars`);
    bars.forEach((bar, i) => assert.equal(bar.attrs.fill, i % 2 === 0 ? sales : cost));
  });
});

describe('lined paper', () => {
  it('sets every typed line 3 px above a rule, and runs no rule through the letters', () => {
    const root = picture('19-view-tab.svg');
    const rules = [...walk(root)]
      // The rules run across the page, 36 px short of its right edge.
      .filter(
        (e) => e.tag === 'line' && e.attrs.y1 === e.attrs.y2 && Number(e.attrs.x2) - Number(e.attrs.x1) === 832 - 36,
      )
      .map((e) => Number(e.attrs.y1));
    assert.ok(rules.length > 20);
    const typed = [...walk(root)].filter(
      (e) => e.tag === 'text' && (e.attrs['font-family'] ?? '').includes('Literata') && Number(e.attrs.y) > rules[0],
    );
    assert.ok(typed.length >= 7);
    for (const line of typed) {
      const baseline = Number(line.attrs.y);
      const below = Math.min(...rules.filter((r) => r >= baseline).map((r) => r - baseline));
      assert.ok(Math.abs(below - 3) <= 0.5, `"${line.text}" is ${below} px above the rule beneath it`);
      // The letters rise about 0.7 of their size above the baseline; no rule crosses them.
      const size = Number(line.attrs['font-size']);
      const through = rules.filter((r) => r < baseline && r > baseline - size * 0.7);
      assert.deepEqual(through, [], `a rule runs through "${line.text}"`);
    }
  });
});

describe('the phone', () => {
  it("keeps every keep-out zone on the phone inside its screen's rounded corners", () => {
    const root = picture('10-phone.svg');
    const screens = [...walk(root)].filter(
      (e) => e.tag === 'rect' && e.attrs.rx === '42' && !e.parent?.attrs['clip-path'],
    );
    const clips = new Map([...walk(root)].filter((e) => e.tag === 'clipPath').map((c) => [c.attrs.id, c.children[0]]));
    /** Whether a point is on a rounded rectangle's glass. */
    const onGlass = (s: El, q: Pt) => {
      const [x, y, w, h, r] = ['x', 'y', 'width', 'height', 'rx'].map((k) => Number(s.attrs[k]));
      const cx = Math.min(Math.max(q.x, x + r), x + w - r);
      const cy = Math.min(Math.max(q.y, y + r), y + h - r);
      return q.x >= x - 0.01 && q.x <= x + w + 0.01 && Math.hypot(q.x - cx, q.y - cy) <= r + 0.01;
    };
    const zones = [...walk(root)].filter((e) => e.tag === 'rect' && e.attrs.fill === 'url(#hatch)');
    let checked = 0;
    for (const zone of zones) {
      const corners = outlineOf(zone)[0].pts;
      const middle = { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 };
      const on = screens.find((s) => onGlass(s, middle));
      if (!on) continue;
      // Either every corner is on the glass, or the zone is cut by a clip that is the screen's own outline.
      let clip: El | undefined;
      for (let e: El | undefined = zone; e && !clip; e = e.parent) {
        const id = /url\(#([^)]+)\)/.exec(e.attrs['clip-path'] ?? '')?.[1];
        if (id) clip = clips.get(id);
      }
      const inside =
        corners.every((q) => onGlass(clip ?? on, q)) || (clip !== undefined && clip.attrs.rx === on.attrs.rx);
      assert.ok(inside, `a keep-out zone at ${corners[0].x},${corners[0].y} reaches past the screen's corner`);
      checked++;
    }
    assert.ok(checked >= 4);
  });
});

describe('annotation labels', () => {
  const pills = (root: El) =>
    [...walk(root)]
      .filter((e) => e.tag === 'g' && e.attrs['data-fit'] === '4')
      .map((g) => ({ g, box: g.children[0].attrs }))
      .map(({ g, box }) => ({ g, x0: +box.x, y0: +box.y, x1: +box.x + +box.width, y1: +box.y + +box.height }));

  it('keeps every label clear of every other label', () => {
    for (const { name, root } of pictures) {
      const all = pills(root);
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const [a, b] = [all[i], all[j]];
          const apart = a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0;
          assert.ok(apart, `${name}: "${a.g.children[1]?.text}" overlaps "${b.g.children[1]?.text}"`);
        }
      }
    }
  });

  it('keeps every label off the drawings: the desk, the plant, the ink and its arrows', () => {
    for (const { name, root } of pictures) {
      const drawings = ['desk-scene', 'plant-pot', 'arrow', 'circled', 'nucleus'].flatMap((part) => named(root, part));
      const points = drawings.flatMap(pointsUnder);
      for (const label of pills(root)) {
        const hit = points.find((p) => p.x > label.x0 && p.x < label.x1 && p.y > label.y0 && p.y < label.y1);
        assert.ok(
          !hit,
          `${name}: "${label.g.children[1]?.text}" covers a drawing at ${hit?.x.toFixed(0)},${hit?.y.toFixed(0)}`,
        );
      }
    }
  });
});

describe('the path flattener these tests rely on', () => {
  const box = (d: string) => {
    const pts = flatten(d).flatMap((r) => r.pts);
    return [
      Math.min(...pts.map((p) => p.x)),
      Math.max(...pts.map((p) => p.x)),
      Math.min(...pts.map((p) => p.y)),
      Math.max(...pts.map((p) => p.y)),
    ];
  };
  const near = (got: number[], want: number[]) =>
    got.forEach((g, i) => assert.ok(Math.abs(g - want[i]) < 0.05, `${got} vs ${want}`));

  it('follows lines and relative moves', () =>
    near(box('M10 128.4H230V135.4H10ZM22 136V148m196-12v12'), [10, 230, 128.4, 148]));
  it('follows a cubic as far as its curve goes, not as far as its handles', () =>
    near(box('M0 0C0 10 10 10 10 0'), [0, 10, 0, 7.5]));
  it('follows a full ellipse drawn as an arc with a one unit chord', () =>
    near(box('M540 185a22 18 0 1 0 1 0'), [518.5, 562.5, 185, 221]));
  it("follows the window's arch", () => near(box('M78 100V44a42 42 0 0 1 84 0v56z'), [78, 162, 2, 100]));
});
