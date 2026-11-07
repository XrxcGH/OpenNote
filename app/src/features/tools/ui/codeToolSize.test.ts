// The code studio keeps one width in the app and in its own window. The panel in tools.ts and the Rust window in
// tool_windows.rs must agree, so the studio does not get narrower when it pops out.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOLS } from './tools';

const rustSource = readFileSync(
  join(import.meta.dirname, '..', '..', '..', '..', 'src-tauri', 'src', 'tool_windows.rs'),
  'utf8',
);

// Reads the width of one Rust `Tool` entry by its id.
const rustWidth = (id: string): number | undefined => {
  const match = new RegExp(`id:\\s*"${id}",[^}]*?width:\\s*([\\d.]+)`, 's').exec(rustSource);
  return match ? Number(match[1]) : undefined;
};

describe('the code studio window size', () => {
  it('has a Rust tool window', () => {
    expect(rustWidth('code')).toBeDefined();
  });

  it('is as wide in the app as in its own window', () => {
    const panel = TOOLS.find((tool) => tool.id === 'code');
    expect(panel?.width).toBe(rustWidth('code'));
  });
});
