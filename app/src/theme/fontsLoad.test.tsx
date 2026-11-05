// The metric stand-ins in a real browser: start-up fetches no file of theirs, and a Calibri run that falls back
// to Carlito measures like Carlito.
import { describe, expect, it, vi } from 'vitest';
import { loadStandIn } from './fonts';

vi.setConfig({ testTimeout: 30_000 });

function fetched(): string[] {
  return performance.getEntriesByType('resource').map((entry) => entry.name);
}

/** The advance width of text in a font stack, in CSS pixels, from a canvas. */
function advance(text: string, stack: string): number {
  const context = document.createElement('canvas').getContext('2d');
  if (context === null) throw new Error('No canvas context');
  context.font = ['400', '100px', stack].join(' ');
  return context.measureText(text).width;
}

describe('metric stand-in fonts in the browser', () => {
  it('loads no Carlito or Caladea file at start-up', () => {
    expect(fetched().filter((url) => /carlito|caladea/i.test(url))).toEqual([]);
  });

  it('draws a Calibri run with Carlito widths when Calibri is missing', async () => {
    await loadStandIn('Calibri');
    await document.fonts.load("400 100px 'Carlito'", 'Hello');
    // A device with Calibri draws Calibri, which has Carlito's widths. One without it draws Carlito.
    // The 0.5 px bound is taken at 16 px: a 100 px measurement is scaled by 0.16.
    const stack = advance('Hello', "'Calibri', 'Carlito', sans-serif");
    const carlito = advance('Hello', "'Carlito', sans-serif");
    expect(Math.abs(stack - carlito) * 0.16).toBeLessThanOrEqual(0.5);
    // The stand-in is not the default sans font: the widths differ from a plain sans-serif.
    expect(advance('Hello', "'NoSuchFont', 'Carlito', sans-serif")).toBeCloseTo(carlito, 1);
    expect(Math.abs(carlito - advance('Hello', 'sans-serif'))).toBeGreaterThan(1);
    const faces = [...document.fonts].filter((face) => face.family.replace(/['"]/g, '') === 'Carlito');
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.some((face) => face.status === 'loaded')).toBe(true);
  });

  it('loads the Caladea rules on request and only once', async () => {
    const first = loadStandIn('Cambria');
    expect(loadStandIn('cambria')).toBe(first);
    await first;
    await document.fonts.load("400 100px 'Caladea'", 'Hello');
    expect(document.fonts.check("400 100px 'Caladea'", 'Hello')).toBe(true);
  });
});
