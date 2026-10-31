// @vitest-environment jsdom
// The kit foundation's plain parts. Quantity fields read into SI. Plots and sketches come out as SVG. The page gets
// insert requests in its shape. A live calculation block keeps its data and reopens its tool with saved inputs.
import { afterEach, describe, expect, it } from 'vitest';
import { INSERT_EVENT } from '../flags';
import { INPUT_LIMIT, kitCalcData, kitCalcFallback, readKitCalc } from './block/model';
import {
  followKitForm,
  openKitTool,
  onKitInputs,
  readFormInputs,
  registerFormKit,
  registerKit,
  resetKits,
  selectKitTab,
  savedKitTab,
  takeKitInputs,
} from './registry';
import { arrowHead, diagramSvg, dimension, label } from './ui/diagram';
import { insertAnswer, insertEquation, insertLiveBlock, insertPicture, insertSteps, insertTable } from './ui/insert';
import { PAPER } from './ui/palette';
import { escapeXml, fitView, niceTicks, plotSvg, tickText, zoomView } from './ui/plot';
import type { PlotSpec } from './ui/plot';
import { inSystem, quantity, readNumber, readQuantity, showQuantity } from './ui/quantity';
import { stepsText } from './ui/words';

afterEach(() => resetKits());

describe('quantity fields', () => {
  it('reads plain numbers, spaced digits, minus signs, and math, and nothing else', () => {
    expect(readNumber('2.5')).toBe(2.5);
    expect(readNumber(' -1.2e-3 ')).toBe(-0.0012);
    expect(readNumber('−4')).toBe(-4);
    expect(readNumber('1 000')).toBe(1000);
    expect(readNumber('pi/2')).toBeCloseTo(Math.PI / 2, 12);
    expect(readNumber('2*sqrt(3)')).toBeCloseTo(2 * Math.sqrt(3), 12);
    expect(Number.isNaN(readNumber(''))).toBe(true);
    expect(Number.isNaN(readNumber('abc'))).toBe(true);
    expect(Number.isNaN(readNumber('1/0'))).toBe(true);
  });

  it('converts to SI and checks limits in the field’s own unit', () => {
    const p = readQuantity(quantity(14.6959, 'psi'), 'pressure');
    expect(p.ok && p.si).toBeCloseTo(101325, 0);
    const t = readQuantity(quantity(32, '°F'), 'temperature', { min: 0 });
    expect(t.ok && t.si).toBeCloseTo(273.15, 9);
    expect(readQuantity(quantity('', 'K'), 'temperature')).toEqual({ ok: false, key: 'kits.field.required' });
    expect(readQuantity(quantity('x', 'K'), 'temperature')).toEqual({ ok: false, key: 'kits.field.notNumber' });
    expect(readQuantity(quantity(0, 'kPa'), 'pressure', { positive: true })).toEqual({
      ok: false,
      key: 'kits.field.positive',
    });
    // −300 °C is below absolute zero; the limit is said in °C.
    expect(readQuantity(quantity(-300, '°C'), 'temperature', { min: 0 })).toEqual({
      ok: false,
      key: 'kits.field.atLeast',
      vars: { min: '−273.1 °C' },
    });
    expect(readQuantity(quantity(2, 'MPa'), 'pressure', { max: 1e6 })).toMatchObject({ key: 'kits.field.atMost' });
  });

  it('switches a field between systems by converting, and shows results in a system', () => {
    expect(inSystem(quantity(100, 'kPa'), 'pressure', 'SI')).toEqual(quantity(100, 'kPa'));
    const us = inSystem(quantity(101.325, 'kPa'), 'pressure', 'US');
    expect(us.unit).toBe('psi');
    expect(Number(us.text)).toBeCloseTo(14.6959, 4);
    expect(inSystem(quantity('oops', 'kPa'), 'pressure', 'US')).toEqual(quantity('oops', 'psi'));
    expect(showQuantity(101325, 'pressure', 'US')).toEqual({ value: '14.7', unit: 'psi' });
    expect(showQuantity(1, 'amount', 'US').unit).toBe('lbmol');
    expect(Number(showQuantity(453.59237, 'amount', 'US').value)).toBeCloseTo(1, 9);
  });
});

const SPEC: PlotSpec = {
  title: 'Cooling <curve>',
  x: { label: 'Time (s)' },
  y: { label: 'Temperature (K)' },
  series: [
    {
      name: 'T',
      points: [
        [0, 400],
        [10, 350],
        [NaN, NaN],
        [20, 320],
      ],
    },
    {
      name: 'Ambient',
      points: [
        [0, 300],
        [20, 300],
      ],
      dashed: true,
    },
  ],
  regions: [{ x0: 5, x1: 15, label: 'Fan on' }],
  notes: [{ at: [10, 350], text: 'Half way', marker: true }],
  lines: [{ y: 300 }],
};

describe('plots', () => {
  it('picks round ticks and labels them briefly', () => {
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(-0.3, 0.3, 6)).toEqual([-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3].map((v) => expect.closeTo(v, 12)));
    expect(niceTicks(5, 5)).toEqual([]);
    expect(tickText(-2.5)).toBe('−2.5');
    expect(tickText(1.5e6)).toBe('1.5e6');
    expect(tickText(3, true)).toBe('10³');
    expect(tickText(-2, true)).toBe('10⁻²');
  });

  it('fits the data with a margin, keeps equal axes equal, and zooms about the center', () => {
    const view = fitView(SPEC);
    expect(view.x0).toBeLessThan(0);
    expect(view.x1).toBeGreaterThan(20);
    expect(view.y0).toBeLessThan(300);
    const square = fitView({ ...SPEC, equalAxes: true }, 520, 320);
    const perPixelX = (square.x1 - square.x0) / (520 - 72);
    const perPixelY = (square.y1 - square.y0) / (320 - 72);
    expect(perPixelX).toBeCloseTo(perPixelY, 12);
    const zoomed = zoomView({ x0: 0, x1: 10, y0: 0, y1: 4 }, 0.5);
    expect(zoomed).toEqual({ x0: 2.5, x1: 7.5, y0: 1, y1: 3 });
    // A log axis drops values at or below zero and fits decades.
    const log = fitView({
      ...SPEC,
      y: { label: 'y', log: true },
      series: [
        {
          name: 'a',
          points: [
            [1, 0],
            [2, 10],
            [3, 1000],
          ],
        },
      ],
    });
    expect(log.y0).toBeCloseTo(1, 12);
    expect(log.y1).toBeCloseTo(3, 12);
  });

  it('draws series, breaks lines at gaps, escapes text, and uses fixed colors on paper', () => {
    const svg = plotSvg(SPEC);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('<title>Cooling &lt;curve&gt;</title>');
    expect(svg).not.toContain('<curve>');
    // The gap starts a new subpath: two M commands in the first series.
    const first = /<path d="([^"]+)"/.exec(svg)?.[1] ?? '';
    expect(first.match(/M/g)?.length).toBe(2);
    expect(svg).toContain('stroke-dasharray="6 4"');
    expect(svg).toContain('Fan on');
    expect(svg).toContain(PAPER.pens[0]);
    expect(svg).not.toContain('var(--');
    const screen = plotSvg(SPEC, { palette: 'screen' });
    expect(screen).toContain('var(--ink-indigo)');
    expect(escapeXml('a & "b"')).toBe('a &amp; &quot;b&quot;');
  });

  it('labels a category axis with its names and no numbers', () => {
    const svg = plotSvg({
      title: 'Means',
      x: { label: '', categories: ['A', 'B', 'C'], min: -0.6, max: 2.4 },
      y: { label: 'Mean', min: 10, max: 20 },
      series: [
        {
          name: 'm',
          style: 'markers',
          points: [
            [0, 12],
            [1, 15],
            [2, 18],
          ],
        },
      ],
    });
    const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    for (const name of ['A', 'B', 'C']) expect(texts).toContain(name);
    // The x ticks are only the names; the numbers left are the y ticks, all within 10 to 20.
    const numbers = texts.filter((t) => /^-?[\d.]+$/.test(t)).map(Number);
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers.every((n) => n >= 10 && n <= 20)).toBe(true);
  });
});

describe('sketches', () => {
  it('points arrowheads along the arrow and dimensions to the side', () => {
    const [tip, left, right] = arrowHead(100, 0, 1, 0, 10);
    expect(tip).toEqual([100, 0]);
    expect(left[0]).toBeCloseTo(90, 12);
    expect(right[0]).toBeCloseTo(90, 12);
    expect(left[1]).toBeCloseTo(-right[1], 12);
    const svg = diagramSvg([dimension(0, 50, 100, 50, 'L = 2 m'), label(5, 5, 'A < B')], {
      width: 120,
      height: 80,
      title: 'Beam',
    });
    expect(svg).toContain('L = 2 m');
    expect(svg).toContain('A &lt; B');
    expect(svg).not.toContain('{{');
    expect(svg).toContain(PAPER.muted);
  });
});

describe('page inserts', () => {
  it('sends each kind of insert in the shape the page reads, and says whether a page took it', () => {
    const seen: Record<string, unknown>[] = [];
    const listen = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown> & { handled: boolean }>).detail;
      seen.push({ ...detail });
      detail.handled = true;
    };
    expect(insertAnswer('p = 1 kPa')).toBe(false);
    window.addEventListener(INSERT_EVENT, listen);
    try {
      expect(insertAnswer('p = 1 kPa')).toBe(true);
      insertEquation('p = 1');
      insertTable([{ id: 'p', label: 'Pressure', value: '1', unit: 'kPa', answer: true }]);
      insertSteps([{ key: 'kits.example.step.law', math: 'pV = nRT' }]);
      insertPicture('<svg/>', 'A plot');
      insertLiveBlock({
        kit: 'example',
        tool: 'idealGas',
        title: 'Ideal gas law',
        summary: 'V = 22.41 L',
        inputs: { a: 1 },
      });
    } finally {
      window.removeEventListener(INSERT_EVENT, listen);
    }
    expect(seen[0]).toMatchObject({ text: 'p = 1 kPa' });
    expect(seen[1]).toMatchObject({ math: { source: 'p = 1', display: true } });
    expect(seen[2]).toMatchObject({ table: { header: ['Quantity', 'Value'], rows: [['Pressure', '1 kPa']] } });
    expect(seen[3]).toMatchObject({
      text:
        '<p>Worked steps</p><ol><li><p>The ideal gas law relates pressure, volume, amount, and temperature.</p>' +
        '<div data-math-block="pV = nRT"></div></li></ol>',
    });
    const picture = seen[4].picture as { bytes: ArrayBuffer; mime: string; alt: string };
    expect(picture.mime).toBe('image/svg+xml');
    expect(new TextDecoder().decode(picture.bytes)).toBe('<svg/>');
    expect(seen[5]).toMatchObject({
      panel: { type: 'ext:org.opennote/kitcalc', fallback: 'Ideal gas law\nV = 22.41 L' },
    });
  });

  it('writes steps as numbered lines', () => {
    expect(stepsText([{ key: 'kits.example.step.result', vars: { value: 'V = 1 m³' } }], 'Steps')).toBe(
      'Steps\n1. The result is V = 1 m³.',
    );
  });
});

describe('live calculation blocks', () => {
  it('keeps the inputs and the key results, and reads its data back safely', () => {
    const data = kitCalcData({
      kit: 'thermo',
      tool: 'cycle',
      title: 'Rankine cycle',
      summary: 'η = 0.35',
      inputs: { p: 1 },
      rows: [{ label: 'Efficiency', value: '0.35', unit: '' }],
      latex: '\\eta = 0.35',
    });
    expect(readKitCalc({ ...data })).toEqual(data);
    expect(kitCalcFallback(data)).toBe('Rankine cycle\nη = 0.35\nEfficiency: 0.35');
    expect(readKitCalc({ kit: 'thermo' })).toBeNull();
    expect(readKitCalc({ kit: 'a', tool: 'b', rows: [null, 5, { label: 1 }] })?.rows).toEqual([
      { label: '', value: '', unit: '' },
    ]);
    // Inputs too large to keep, or that cannot be saved, are dropped; the results stay.
    const big = kitCalcData({ ...data, inputs: 'x'.repeat(INPUT_LIMIT + 1) });
    expect(big.inputs).toBeNull();
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(kitCalcData({ ...data, inputs: loop }).inputs).toBeNull();
  });

  it('reopens a registered tool with its inputs once, and says when the kit is missing', async () => {
    const opened: string[] = [];
    const arrived: string[] = [];
    registerKit('thermo', (tool) => void opened.push(tool));
    const stop = onKitInputs('thermo', (tool) => arrived.push(tool));
    expect(await openKitTool('nope', 'x', {})).toBe(false);
    expect(await openKitTool('thermo', 'cycle', { p: 2 })).toBe(true);
    stop();
    expect(opened).toEqual(['cycle']);
    expect(arrived).toEqual(['cycle']);
    expect(takeKitInputs('thermo', 'other')).toBeNull();
    expect(takeKitInputs('thermo', 'cycle')).toEqual({ p: 2 });
    expect(takeKitInputs('thermo', 'cycle')).toBeNull();
  });

  it('puts a form kit block back into the stored texts and unit system before opening the tool', async () => {
    const opened: string[] = [];
    const restored: string[] = [];
    registerFormKit('fluidheat', 'test.kit.', (tool) => void opened.push(tool));
    const stop = followKitForm('fluidheat', 'pipes', () => restored.push('pipes'));
    const inputs = { texts: { D: '0.1 m', n: 3 }, system: 'us' };
    expect(await openKitTool('fluidheat', 'pipes', inputs)).toBe(true);
    stop();
    expect(opened).toEqual(['pipes']);
    expect(restored).toEqual(['pipes']);
    expect(JSON.parse(localStorage.getItem('test.kit.pipes') ?? 'null')).toEqual({ D: '0.1 m' });
    expect(JSON.parse(localStorage.getItem('test.kit.system') ?? 'null')).toBe('us');
    expect(readFormInputs({ texts: {}, system: 'metric' })).toBeNull();
    expect(readFormInputs(null)).toBeNull();
  });

  it('remembers the tool a kit window shows', () => {
    expect(savedKitTab('thermo')).toBeNull();
    selectKitTab('thermo', 'cycle');
    expect(savedKitTab('thermo')).toBe('cycle');
  });
});
