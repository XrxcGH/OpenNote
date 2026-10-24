import { describe, expect, it } from 'vitest';
import { collinear, perspectiveGrid, perspectiveSvg } from './perspective';
import { areaFactor, cutList, drawn, enlargement, METERS, parseScale, readFraction, real, volumeFactor } from './scale';
import { DENSITIES, glaze, lossOnIgnition, parseMaterial, scaleBatch, shapeVolume, yardage } from './materials';
import type { Material } from './materials';

const material = (line: string): Material => {
  const m = parseMaterial(line);
  if (!m) throw new Error(`not a material: ${line}`);
  return m;
};

describe('scales', () => {
  it('draws 3.5 m at 1:50 as 70 mm', () => {
    const scale = parseScale('1:50')!;
    expect(scale.ratio).toBe(50);
    expect(drawn(3.5, scale) / METERS.mm!).toBeCloseTo(70, 9);
  });
  it('draws 12 ft at 1/4 in = 1 ft as 3 in', () => {
    const scale = parseScale('1/4 in = 1 ft')!;
    expect(scale.ratio).toBeCloseTo(48, 9);
    expect(drawn(12 * METERS.ft!, scale) / METERS.in!).toBeCloseTo(3, 9);
  });
  it('reads architectural marks and engineering scales', () => {
    expect(parseScale(`1/4" = 1'-0"`)!.ratio).toBeCloseTo(48, 9);
    expect(parseScale('1 in = 20 ft')!.ratio).toBeCloseTo(240, 9);
    expect(parseScale('1 cm = 2 m')!.ratio).toBeCloseTo(200, 9);
    expect(parseScale('1:0.5')!.ratio).toBe(0.5);
  });
  it('rejects text that is not a scale', () => {
    for (const text of ['', 'big', '1:0', '0 in = 1 ft', '1 in = 1 parsec', '1/0 in = 1 ft']) {
      expect(parseScale(text), text).toBeNull();
    }
  });
  it('goes back from paper to real size and scales area and volume', () => {
    const scale = parseScale('1:50')!;
    expect(real(0.07, scale)).toBeCloseTo(3.5, 12);
    expect(areaFactor(scale)).toBeCloseTo(1 / 2500, 12);
    expect(volumeFactor(scale)).toBeCloseTo(1 / 125000, 15);
  });
  it('reads fractions', () => {
    expect(readFraction('3/16')).toBeCloseTo(0.1875, 12);
    expect(readFraction('1 1/2')).toBe(1.5);
    expect(readFraction('2.5')).toBe(2.5);
    expect(readFraction('1/0')).toBeNull();
    expect(readFraction('x')).toBeNull();
  });
});

describe('enlarging a sketch', () => {
  it('takes 8 x 10 in to 4 x 5 ft at a factor of 6', () => {
    const e = enlargement(8, 10, 48, 60);
    expect(e.widthFactor).toBe(6);
    expect(e.heightFactor).toBe(6);
    expect(e.uniform).toBe(true);
  });
  it('says when the shapes differ and gives the factor that fits', () => {
    const e = enlargement(8, 10, 48, 48);
    expect(e.uniform).toBe(false);
    expect(e.fit).toBeCloseTo(4.8, 12);
  });
});

describe('cut lists', () => {
  it('needs two boards when the kerf pushes two halves past the stock length', () => {
    expect(cutList(96, 0, [{ length: 48, quantity: 2 }]).boards).toHaveLength(1);
    expect(cutList(96, 0.125, [{ length: 48, quantity: 2 }]).boards).toHaveLength(2);
  });
  it('packs longest first and reports the waste', () => {
    const plan = cutList(96, 0.125, [
      { length: 48, quantity: 2 },
      { length: 30, quantity: 3 },
      { length: 24, quantity: 1 },
    ]);
    expect(plan.boards.map((b) => b.cuts)).toEqual([
      [48, 30],
      [48, 30],
      [30, 24],
    ]);
    expect(plan.wasteFraction).toBeCloseTo(1 - 210 / 288, 12);
    expect(plan.boards[0]!.leftover).toBeCloseTo(96 - 78.125, 12);
  });
  it('reports pieces longer than the board', () => {
    const plan = cutList(96, 0.125, [{ length: 100, quantity: 1 }]);
    expect(plan.tooLong).toEqual([100]);
    expect(plan.boards).toEqual([]);
  });
});

describe('perspective grids', () => {
  const options = { width: 600, height: 400, horizon: 0.4, lines: 6 };
  it('runs every one-point line to the single vanishing point on the horizon', () => {
    const grid = perspectiveGrid({ kind: 'one', ...options });
    expect(grid.points).toEqual([{ x: 300, y: 160 }]);
    const lines = grid.segments.filter((s) => s.point === 0);
    expect(lines).toHaveLength(24);
    for (const s of lines) expect(collinear({ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }, grid.points[0]!)).toBe(true);
  });
  it('puts two points on the horizon and draws verticals', () => {
    const grid = perspectiveGrid({ kind: 'two', ...options });
    expect(grid.points).toHaveLength(2);
    expect(grid.points.every((p) => p.y === grid.horizon)).toBe(true);
    expect(grid.segments.some((s) => s.x1 === s.x2 && s.point === -1)).toBe(true);
  });
  it('adds a third point far below the picture', () => {
    const grid = perspectiveGrid({ kind: 'three', ...options });
    expect(grid.points).toHaveLength(3);
    expect(grid.points[2]!.y).toBeGreaterThan(grid.height);
  });
  it('draws SVG with a line for each segment', () => {
    const grid = perspectiveGrid({ kind: 'one', ...options });
    const svg = perspectiveSvg(grid, 'One-point grid');
    expect(svg.match(/<line /g)).toHaveLength(grid.segments.length);
    expect(svg).toContain('viewBox="0 0 600 400"');
  });
  it('tells a straight line from a bent one', () => {
    expect(collinear({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 5, y: 5 })).toBe(true);
    expect(collinear({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 5, y: 6 })).toBe(false);
  });
});

describe('fabric yardage', () => {
  it('fits two 20 x 30 in pieces across 45 in cloth in two rows for 60 in', () => {
    const y = yardage([{ width: 20, length: 30, quantity: 4 }], 45, false)!;
    expect(y.length).toBe(60);
    expect(y.across).toEqual([2, 2]);
    expect(y.length / 36).toBeCloseTo(1.667, 3);
  });
  it('keeps the direction when there is nap, and refuses a piece wider than the cloth', () => {
    expect(yardage([{ width: 20, length: 30, quantity: 4 }], 45, true)!.length).toBe(60);
    expect(yardage([{ width: 50, length: 10, quantity: 1 }], 45, true)).toBeNull();
    expect(yardage([{ width: 50, length: 10, quantity: 1 }], 45, false)!.length).toBe(50);
  });
  it('lets a piece turn to save cloth when there is no nap', () => {
    const turned = yardage([{ width: 40, length: 20, quantity: 2 }], 45, false)!;
    expect(turned.length).toBe(40);
    const kept = yardage([{ width: 40, length: 20, quantity: 2 }], 45, true)!;
    expect(kept.length).toBe(40);
  });
  it('rounds the length up to a whole pattern repeat', () => {
    expect(yardage([{ width: 20, length: 30, quantity: 4 }], 45, false, 25)!.length).toBe(75);
  });
});

describe('sculpture weight', () => {
  it('weighs a 10 cm marble cube at 2.7 kg', () => {
    expect(shapeVolume('block', 10, 10, 10) * DENSITIES.marble!).toBeCloseTo(2700, 9);
  });
  it('finds the volume of a cylinder, a sphere, and a typed volume', () => {
    expect(shapeVolume('cylinder', 10, 20, 0)).toBeCloseTo(1570.796, 3);
    expect(shapeVolume('sphere', 10, 0, 0)).toBeCloseTo(523.599, 3);
    expect(shapeVolume('volume', 42, 0, 0)).toBe(42);
  });
});

describe('glaze recipes', () => {
  it('loses 43.97 percent of whiting (CaCO3 to CaO) on ignition', () => {
    expect(lossOnIgnition(material('CaO.CO2 100')) * 100).toBeCloseTo(43.97, 2);
  });
  it('loses 13.96 percent of kaolin as water', () => {
    expect(lossOnIgnition(material('Al2O3.2SiO2.2H2O 100')) * 100).toBeCloseTo(13.96, 2);
  });
  it('takes oxide weights back to the unity formula they were built from', () => {
    // 0.3 K2O, 0.7 CaO, 0.4 Al2O3, 3.0 SiO2 in moles, weighed with handbook molar masses.
    const grams = { K2O: 0.3 * 94.196, CaO: 0.7 * 56.077, Al2O3: 0.4 * 101.961, SiO2: 3 * 60.083 };
    const g = glaze(Object.entries(grams).map(([oxide, g]) => material(`${oxide} ${g}`)))!;
    expect(g.unity.get('K2O')).toBeCloseTo(0.3, 3);
    expect(g.unity.get('CaO')).toBeCloseTo(0.7, 3);
    expect(g.unity.get('Al2O3')).toBeCloseTo(0.4, 3);
    expect(g.unity.get('SiO2')).toBeCloseTo(3, 3);
    expect(g.alkali).toBeCloseTo(0.3, 3);
    expect(g.alkalineEarth).toBeCloseTo(0.7, 3);
    expect(g.silicaAlumina).toBeCloseTo(7.5, 2);
    expect(g.loi).toBe(0);
  });
  it('fires the carbon dioxide and water out of a batch of raw materials', () => {
    // 1 mol whiting (100.087 g) + 1 mol K-spar (K2O.Al2O3.6SiO2, 556.67 g): flux 2 mol, loss is the CO2 only.
    const g = glaze([material('CaO.CO2 100.0869'), material('K2O.Al2O3.6SiO2 556.6718')])!;
    expect(g.fluxMoles).toBeCloseTo(2, 3);
    expect(g.unity.get('SiO2')).toBeCloseTo(3, 3);
    expect(g.loi).toBeCloseTo(44.0095 / 656.7587, 4);
  });
  it('has no unity formula without a flux', () => {
    expect(glaze([material('SiO2 50')])).toBeNull();
  });
  it('scales a batch to a new total', () => {
    expect(scaleBatch([material('SiO2 30'), material('Al2O3 10')], 400)).toEqual([300, 100]);
  });
  it('reads labels, hydrates, and rejects what is not a material', () => {
    const named = parseMaterial('Whiting: CaO.CO2 20')!;
    expect(named.label).toBe('Whiting');
    expect(named.grams).toBe(20);
    expect(parseMaterial('Xx2O 5')).toBeNull();
    expect(parseMaterial('CaO')).toBeNull();
    expect(parseMaterial('')).toBeNull();
  });
});
