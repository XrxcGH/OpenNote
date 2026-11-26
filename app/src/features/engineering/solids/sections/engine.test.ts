import '../text';
import { describe, expect, it } from 'vitest';
import { SolidsError } from '../kit/types';
import { firstMoment, sectionProperties, shearCenter, type Placed } from './engine';
import { readChain, readParts, shapeParts, wallParts, type Dims } from './shapes';

const rel = (a: number | undefined, b: number, tol: number) =>
  expect(Math.abs((a ?? NaN) - b) / Math.max(Math.abs(b), 1e-300), `${a} vs ${b}`).toBeLessThanOrEqual(tol);
const mm = 1e-3;
const mm4 = 1e-12;
const dims = (d: Partial<Dims>): Dims => ({ b: NaN, h: NaN, d: NaN, t: NaN, tf: NaN, tw: NaN, ...d });
const id = (value: number) => value * mm;
const code = (f: () => unknown) => {
  try {
    f();
  } catch (error) {
    return error instanceof SolidsError ? error.code : 'other';
  }
  return 'none';
};

describe('composite sections', () => {
  it('gives the centroid and Ix of the T-section validation case', () => {
    const t = shapeParts('T', dims({ b: 100 * mm, h: 120 * mm, tf: 20 * mm, tw: 20 * mm }));
    const r = sectionProperties(t.parts);
    rel(r.yBar, 80 * mm, 1e-9);
    rel(r.Ix, 5.33333e6 * mm4, 1e-6);
    // By hand: flange 100·20³/12 + 2000·30², web 20·100³/12 + 2000·30².
    rel(r.Ix / mm4, (100 * 20 ** 3) / 12 + 2000 * 900 + (20 * 100 ** 3) / 12 + 2000 * 900, 1e-12);
    rel(r.Iy / mm4, (20 * 100 ** 3) / 12 + (100 * 20 ** 3) / 12, 1e-12);
    expect(r.Ixy).toBe(0);
    rel(r.Stop / mm ** 3, r.Ix / mm4 / 40, 1e-12);
    rel(r.Sbottom / mm ** 3, r.Ix / mm4 / 80, 1e-12);
    // Q at the neutral axis: the web below it, 20·80·40.
    const na = firstMoment(t.parts, r.yBar, r.yBar);
    rel(na.Q / mm ** 3, 20 * 80 * 40, 1e-12);
    rel(na.width, 20 * mm, 1e-12);
    expect(t.center).toEqual({ x: 50 * mm, y: 110 * mm });
    // At the joint of flange and web, y = 100 mm: Q is the flange, 100·20·(110 − 80) = 60 000 mm³, and t is the
    // web's 20 mm (just below), not 0; the flange's 100 mm is just above.
    const joint = firstMoment(t.parts, 100 * mm, r.yBar);
    rel(joint.Q / mm ** 3, 60000, 1e-12);
    rel(joint.width, 20 * mm, 1e-12);
    rel(joint.below, 20 * mm, 1e-12);
    rel(joint.above, 100 * mm, 1e-12);
  });

  it('gives the width of two stacked plates where they meet, on the neutral axis', () => {
    const plates: Placed[] = [
      { kind: 'rect', b: 100 * mm, h: 20 * mm, x: 0, y: 10 * mm },
      { kind: 'rect', b: 100 * mm, h: 20 * mm, x: 0, y: 30 * mm },
    ];
    const na = firstMoment(plates, 20 * mm, 20 * mm);
    rel(na.width, 100 * mm, 1e-12);
    rel(na.Q / mm ** 3, 100 * 20 * 10, 1e-12);
  });

  it('agrees with the closed forms of a rectangle, circle, tube, box, and I', () => {
    const rect = sectionProperties(shapeParts('rect', dims({ b: 60 * mm, h: 90 * mm })).parts);
    rel(rect.Ix / mm4, (60 * 90 ** 3) / 12, 1e-12);
    rel(
      firstMoment(shapeParts('rect', dims({ b: 60 * mm, h: 90 * mm })).parts, 45 * mm, 45 * mm).Q / mm ** 3,
      (60 * 90 ** 2) / 8,
      1e-12,
    );
    const circle = shapeParts('circle', dims({ d: 50 * mm }));
    const c = sectionProperties(circle.parts);
    rel(c.Ix / mm4, (Math.PI * 50 ** 4) / 64, 1e-12);
    rel(c.rx / mm, 50 / 4, 1e-12);
    const cq = firstMoment(circle.parts, c.yBar, c.yBar);
    rel(cq.Q / mm ** 3, 50 ** 3 / 12, 1e-12);
    rel(cq.width / mm, 50, 1e-12);
    const tube = sectionProperties(shapeParts('tube', dims({ d: 50 * mm, t: 5 * mm })).parts);
    rel(tube.Ix / mm4, (Math.PI * (50 ** 4 - 40 ** 4)) / 64, 1e-12);
    const box = sectionProperties(shapeParts('box', dims({ b: 100 * mm, h: 50 * mm, t: 2 * mm })).parts);
    rel(box.Ix / mm4, (100 * 50 ** 3 - 96 * 46 ** 3) / 12, 1e-12);
    const I = sectionProperties(shapeParts('I', dims({ b: 100 * mm, h: 200 * mm, tf: 10 * mm, tw: 6 * mm })).parts);
    rel(I.Ix / mm4, (100 * 200 ** 3 - 94 * 180 ** 3) / 12, 1e-12);
    rel(I.yBar / mm, 100, 1e-12);
  });

  it('subtracts a hole and finds Q at a cut through it', () => {
    const parts = readParts('rect 200 100 0 0\nhole circle 40 50 0', id);
    const r = sectionProperties(parts);
    const hole = (Math.PI * 40 ** 2) / 4;
    rel(r.A / mm ** 2, 20000 - hole, 1e-12);
    rel(r.xBar / mm, (-hole * 50) / (20000 - hole), 1e-12);
    rel(r.Ix / mm4, (200 * 100 ** 3) / 12 - (Math.PI * 40 ** 4) / 64, 1e-12);
    // Through the hole's center: the solid half less the half-circle, whose centroid is 4r/(3π) up.
    const half = firstMoment(parts, 0, 0);
    rel(half.Q / mm ** 3, 200 * 50 * 25 - (hole / 2) * ((4 * 20) / (3 * Math.PI)), 1e-12);
    rel(half.width / mm, 160, 1e-12);
    rel(firstMoment(parts, 20 * mm, 0).Q / mm ** 3, 200 * 30 * 35, 1e-12);
  });

  it('scales from tiny to huge sections', () => {
    for (const k of [1e-6, 1, 1e4]) {
      const r = sectionProperties(shapeParts('rect', dims({ b: 2 * k, h: 3 * k })).parts);
      rel(r.Ix, (2 * k * (3 * k) ** 3) / 12, 1e-12);
    }
  });
});

describe('thin-walled sections', () => {
  it('gives the Z-section validation case, with its principal axes', () => {
    const walls = readChain('50 50\n0 50\n0 -50\n-50 -50', 5 * mm, id);
    const r = sectionProperties(wallParts(walls));
    rel(r.Ix / mm4, 1.66771e6, 1e-5);
    rel(r.Iy / mm4, 4.17708e5, 1e-5);
    rel(r.Ixy / mm4, 6.25e5, 1e-5);
    rel(r.I1 / mm4, 1.92659e6, 1e-5);
    rel(r.I2 / mm4, 1.58825e5, 1e-5);
    rel((r.thetaP * 180) / Math.PI, -22.5, 1e-9);
    // By hand: web 5·100³/12, each flange 50·5³/12 + 250·50² about x, 5·50³/12 + 250·25² about y.
    rel(r.Ix / mm4, (5 * 100 ** 3) / 12 + 2 * ((50 * 125) / 12 + 250 * 2500), 1e-12);
    rel(r.Iy / mm4, (100 * 125) / 12 + 2 * ((5 * 50 ** 3) / 12 + 250 * 625), 1e-12);
    // A Z is point-symmetric, so its shear center is its centroid.
    const sc = shearCenter(walls);
    expect(Math.abs(sc.x) + Math.abs(sc.y)).toBeLessThan(1e-12);
  });

  it('puts the channel shear center 3b²/(h + 6b) behind the web, whatever the thickness', () => {
    for (const t of [0.5, 2, 5]) {
      const walls = readChain('50 100\n0 100\n0 0\n50 0', t * mm, id);
      const sc = shearCenter(walls);
      rel(sc.x / mm, -18.75, 1e-9);
      rel(sc.y / mm, 50, 1e-9);
    }
    // Turning the channel by 90 degrees turns its shear center with it.
    const turned = shearCenter(readChain('-100 50\n-100 0\n0 0\n0 50', 2 * mm, id));
    rel(turned.y / mm, -18.75, 1e-9);
    rel(turned.x / mm, -50, 1e-9);
  });

  it('gives the library channel the formula with flange and web thicknesses', () => {
    const [b, h, tf, tw] = [80, 200, 10, 6];
    const built = shapeParts('C', dims({ b: b * mm, h: h * mm, tf: tf * mm, tw: tw * mm }));
    const sc = shearCenter(built.chain ?? []);
    const [bb, hh] = [b - tw / 2, h - tf];
    rel(sc.x / mm, tw / 2 - (3 * bb ** 2 * tf) / (6 * bb * tf + hh * tw), 1e-9);
    rel(sc.y / mm, h / 2, 1e-9);
  });

  it('puts the angle shear center at the corner and the Z at its centroid', () => {
    const L = shapeParts('L', dims({ b: 80 * mm, h: 60 * mm, t: 6 * mm }));
    const sc = shearCenter(L.chain ?? []);
    rel(sc.x / mm, 3, 1e-9);
    rel(sc.y / mm, 3, 1e-9);
    const Z = shapeParts('Z', dims({ b: 50 * mm, h: 100 * mm, tf: 5 * mm, tw: 5 * mm }));
    const zc = shearCenter(Z.chain ?? []);
    rel(zc.x / mm, 47.5, 1e-9);
    rel(zc.y / mm, 50, 1e-9);
  });

  it('keeps the polar moment of a turned wall', () => {
    const L = 0.1;
    const t = 0.004;
    const wall: Placed = {
      kind: 'wall',
      x1: 0,
      y1: 0,
      x2: L * Math.cos(Math.PI / 6),
      y2: L * Math.sin(Math.PI / 6),
      t,
    };
    const r = sectionProperties([wall]);
    rel(r.Ix + r.Iy, (t * L ** 3) / 12 + (L * t ** 3) / 12, 1e-12);
    // The largest moment is about the axis across the wall, at 30° + 90°, which is −60°.
    rel(r.I1, (t * L ** 3) / 12, 1e-12);
    rel((r.thetaP * 180) / Math.PI, -60, 1e-9);
  });

  it('finds Q of a thin channel at its neutral axis', () => {
    const walls = readChain('50 100\n0 100\n0 0\n50 0', 2 * mm, id);
    const parts = wallParts(walls);
    const r = sectionProperties(parts);
    const na = firstMoment(parts, r.yBar, r.yBar);
    rel(na.Q / mm ** 3, 2 * 50 * 50 + (2 * 50 ** 2) / 2, 1e-12);
    rel(na.width / mm, 2, 1e-12);
  });
});

describe('impossible sections', () => {
  it('names what is wrong', () => {
    expect(code(() => shapeParts('tube', dims({ d: 10 * mm, t: 5 * mm })))).toBe('tooThick');
    expect(code(() => shapeParts('rect', dims({ b: 0, h: 1 })))).toBe('positive');
    expect(code(() => shapeParts('I', dims({ b: 0.1, h: 0.1, tf: 0.06, tw: 0.01 })))).toBe('tooThick');
    expect(code(() => sectionProperties([]))).toBe('noParts');
    expect(code(() => sectionProperties(readParts('rect 10 10 0 0\nhole rect 10 10 0 0', id)))).toBe('noArea');
    expect(code(() => readParts('rect 10 10 0', id))).toBe('partsLine');
    expect(code(() => readParts('# only a comment', id))).toBe('noParts');
    expect(code(() => readChain('0 0', 1, id))).toBe('fewPoints');
    expect(code(() => readChain('0 0\n0 0', 1, id).map((w) => ({ kind: 'wall' as const, ...w })))).toBe('none');
    expect(code(() => sectionProperties(wallParts(readChain('0 0\n0 0', 1, id))))).toBe('zeroWall');
    expect(
      code(() =>
        shearCenter([
          { x1: 0, y1: 0, x2: 1, y2: 0, t: 0.01 },
          { x1: 2, y1: 0, x2: 2, y2: 1, t: 0.01 },
        ]),
      ),
    ).toBe('notChain');
  });
});
