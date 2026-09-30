// @vitest-environment node
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
