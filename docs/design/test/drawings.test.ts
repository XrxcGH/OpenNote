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
    // Both bars (upright, crosspiece) with the points along their straight lines.
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
  it('keeps every line, circle and box of every wireframe inside the picture, never cut off by its edge', () => {
    for (const { name, root } of pictures) {
      const svg = root.children[0];
      const [width, height] = [Number(svg.attrs.width), Number(svg.attrs.height)];
      const clipped = [...walk(svg)].filter((e) => !e.attrs['clip-path'] && ['path', 'circle'].includes(e.tag));
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
