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

describe('cascade layers', () => {
  it('declares the layer order once, lowest first', () => {
    const css = readFileSync(join(import.meta.dirname, '..', 'styles', 'layers.css'), 'utf8');
    expect(css).toContain('@layer tokens, base, components, states, forced;');
  });
});
