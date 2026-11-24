// Walk fix VA-23 and VB-151: controls in the code studio and its settings keep the touch target size.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const studio = readFileSync(join(import.meta.dirname, 'studio.module.css'), 'utf8');
const settings = readFileSync(join(import.meta.dirname, '..', 'settings', 'settings.module.css'), 'utf8');

/** The declaration block of the first rule whose selector list contains `selector`. */
function rule(source: string, selector: string): string {
  const at = [`${selector} {`, `${selector},`].map((s) => source.indexOf(s)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? -1;
  expect(at, selector).toBeGreaterThan(-1);
  return source.slice(source.indexOf('{', at), source.indexOf('}', at));
}

describe('code studio target size', () => {
  it.each(['.picker select', '.tabButton', '.panelTab', '.statusButton'])('%s uses the target size', (sel) => {
    expect(rule(studio, sel)).toMatch(/min-block-size:\s*var\(--target-size\)/);
  });
  it('settings fields use the target size', () => {
    expect(rule(settings, '.field select')).toMatch(/min-block-size:\s*var\(--target-size\)/);
  });
});
