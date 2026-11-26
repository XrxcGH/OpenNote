// Review marks under forced colors (text DESIGN.md 12, WCAG 1.4.3). The marks take CanvasText as it is. In a dark
// contrast theme CanvasText is light, so a light tint behind it would hide the text. The tint must go, and the dashed
// Highlight underline stays as the cue.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, 'review.module.css'), 'utf8');

/** The body of the `@media (forced-colors: active)` block. */
function forcedColors(source: string): string {
  const start = source.indexOf('@media (forced-colors: active)');
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

describe('review marks under forced colors', () => {
  it('drop the tint behind CanvasText and keep the dashed Highlight underline', () => {
    const block = forcedColors(css);
    expect(block).toContain('color: CanvasText');
    expect(block).toMatch(/background-color:\s*transparent/);
    expect(block).toContain('border-block-end: 1px dashed Highlight');
  });
});
