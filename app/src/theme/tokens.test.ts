// @vitest-environment node
// checks-disable-file brand-consistency: the tests read the token values and compare them with expected colors
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tokens } from './tokens';

describe('layout tokens', () => {
  it('names each breakpoint after the lower edge of its size class', () => {
    expect(tokens.breakpoint).toEqual({ medium: 600, expanded: 840, wide: 1200 });
  });

  it('keeps each pane default between its limits', () => {
    const { size } = tokens;
    expect(size.sidebarMin).toBeLessThan(size.sidebar);
    expect(size.sidebar).toBeLessThan(size.sidebarMax);
    expect(size.pageListMin).toBeLessThan(size.pageList);
    expect(size.pageList).toBeLessThan(size.pageListMax);
  });

  it('fits three panes at their minimums in the narrowest wide window', () => {
    const { size, breakpoint } = tokens;
    expect(size.sidebarMin + size.pageListMin + size.editorMin).toBeLessThanOrEqual(breakpoint.wide);
  });

  it('keeps the minimum window wider than the narrowest content', () => {
    expect(tokens.size.windowMin).toBeGreaterThan(tokens.size.contentMin);
    expect(tokens.size.dragMin + 3 * tokens.size.captionButton).toBeLessThanOrEqual(tokens.size.windowMin);
  });

  it('gives touch density larger targets than mouse density', () => {
    const { size } = tokens;
    expect(size.rowTouch).toBeGreaterThan(size.rowPointer);
    expect(size.splitterHitTouch).toBeGreaterThan(size.splitterHit);
    expect(size.titleBarTouch).toBeGreaterThan(size.titleBar);
  });

  it('holds interaction timings in milliseconds for code, not CSS', () => {
    expect(tokens.interaction.typeaheadMs).toBe(700);
    const css = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');
    expect(css).not.toContain('--interaction');
  });
});

describe('page and ink tokens for Phases 4 and 5', () => {
  it('stacks ink above the page scroller and below the page chrome, the formatting bar, and menus', () => {
    const { layer } = tokens;
    const order = [
      layer.base,
      layer.inkTiles,
      layer.inkSelection,
      layer.inkLive,
      layer.pageChrome,
      layer.sticky,
      layer.formattingBar,
      layer.dropdown,
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(new Set(order).size).toBe(order.length);
  });

  it('gives touch sizes to the pen palette and page chrome', () => {
    const { size } = tokens;
    expect(size.penPaletteTouch).toBe(size.targetTouch + 12);
    expect(size.chromeHitTouch).toBe(size.targetTouch);
    expect(size.chromeHit).toBe(size.targetPointer);
  });

  it('defines a syntax color for each kind of code in both themes, and forced colors for each', () => {
    const kinds = Object.keys(tokens.color.light.code);
    expect(kinds).toHaveLength(8);
    expect(Object.keys(tokens.color.dark.code)).toEqual(kinds);
    kinds.forEach((kind) => expect(tokens.forcedColors).toHaveProperty([`code.${kind}`], 'CanvasText'));
  });

  it('defines the warm accents and the ambient sky in both themes, with forced colors for each', () => {
    const accents = ['candle', 'candleSubtle', 'dusk', 'duskSubtle', 'night', 'nightSubtle'];
    const ambient = ['canvasTop', 'canvasBottom', 'glow', 'spark'];
    accents.forEach((key) => {
      expect(tokens.color.light.accent).toHaveProperty(key);
      expect(tokens.color.dark.accent).toHaveProperty(key);
      expect(tokens.forcedColors).toHaveProperty([`accent.${key}`], key.endsWith('Subtle') ? 'Canvas' : 'CanvasText');
    });
    expect(Object.keys(tokens.color.light.ambient)).toEqual(ambient);
    expect(Object.keys(tokens.color.dark.ambient)).toEqual(ambient);
    ambient.forEach((key) => expect(tokens.forcedColors).toHaveProperty([`ambient.${key}`], 'Canvas'));
  });

  it('keeps palm rejection and shape timings in milliseconds for code', () => {
    const { interaction } = tokens;
    expect(interaction.palmWatchdogMs).toBeGreaterThan(interaction.palmGraceMs);
    expect(interaction.shapeHoldMs).toBe(interaction.longPressMs);
  });
});

describe('cascade layers', () => {
  it('declares the layer order once, lowest first', () => {
    const css = readFileSync(join(import.meta.dirname, '..', 'styles', 'layers.css'), 'utf8');
    expect(css).toContain('@layer tokens, base, components, states, forced;');
  });
});

describe('drawing tints', () => {
  it('defines the five drawing tints in both themes, and flattens them to the canvas in forced colors', () => {
    const tints = ['moss', 'clay', 'candle', 'dusk', 'night'];
    expect(Object.keys(tokens.color.light.art)).toEqual(tints);
    expect(Object.keys(tokens.color.dark.art)).toEqual(tints);
    tints.forEach((key) => expect(tokens.forcedColors).toHaveProperty([`art.${key}`], 'Canvas'));
  });
});

describe('the ambient canvas', () => {
  it('keeps the ambient wash close to the canvas, so it never competes with the page', () => {
    const ceilings = tokens.contrast.filter((pair) => 'max' in pair);
    expect(ceilings.map((pair) => pair.fg)).toEqual(['ambient.canvasTop', 'ambient.canvasBottom', 'ambient.glow']);
    // The sunset band is the strongest tone, and the ceiling sits just above it.
    ceilings.forEach((pair) => expect(pair).toMatchObject({ bg: 'surface.sunken', max: 1.5 }));
  });

  it('holds text on every ambient tone to the same targets as on the canvas', () => {
    const on = (bg: string) =>
      tokens.contrast.flatMap((pair) => (pair.bg === bg && 'min' in pair ? [[pair.fg, pair.min]] : []));
    expect(on('ambient.glow')).toEqual(on('ambient.canvasTop'));
    expect(on('ambient.canvasBottom')).toEqual(on('ambient.canvasTop'));
  });
});

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function hue([r, g, b]: [number, number, number]): number {
  const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)];
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function luminance(hex: string): number {
  const lin = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('the plum evening glow', () => {
  it('is plum, not brown or maroon, and still visible against the evening sky', () => {
    const { glow, canvasBottom } = tokens.color.dark.ambient;
    const [r, g, b] = rgb(glow);
    expect(hue([r, g, b])).toBeGreaterThanOrEqual(280);
    expect(hue([r, g, b])).toBeLessThanOrEqual(340);
    expect(b).toBeGreaterThanOrEqual(g);
    expect(r - b).toBeLessThanOrEqual(8);
    expect(ratio(glow, canvasBottom)).toBeGreaterThanOrEqual(1.15);
  });

  it('is drawn in the regenerated design image', () => {
    const svg = readFileSync(join(__dirname, '../../../docs/design/images/03-new-page-dark.svg'), 'utf8');
    expect(svg).toContain('#40303A');
    expect(svg).not.toContain('#45302C');
  });
});

describe('notebook pens on the page', () => {
  it('measures each of the seven pens against the page color', () => {
    const pens = ['Ink', 'Indigo', 'Brick', 'Fern', 'Plum', 'Amber', 'Walnut'];
    for (const pen of pens) {
      expect(tokens.contrast).toContainEqual({ fg: `ink.pens.${pen}`, bg: 'surface.page', min: 3 });
    }
  });
});
