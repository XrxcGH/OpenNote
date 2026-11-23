import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const PAGES = ['docs/help/code-cells.md', 'docs/help/code-studio.md'];

test('both code help pages name the editor keys that move focus and switch tabs', () => {
  for (const path of PAGES) {
    const page = read(path);
    for (const phrase of [
      'Ctrl+Tab',
      'Escape, then Tab',
      'Ctrl+Shift+Tab',
      'Ctrl+PageDown',
      'Ctrl+PageUp',
      'Ctrl+M',
      'Ctrl+Right',
    ]) {
      assert.ok(page.includes(phrase), `${path} lacks ${phrase}`);
    }
    assert.ok(page.includes('Settings, then Shortcuts'), `${path} lacks the remap note`);
  }
});

test('neither code help page says Tab accepts a suggestion', () => {
  for (const path of PAGES) {
    for (const line of read(path).split('\n')) {
      const tabAccepts =
        /(^|[^+\w])Tab (accepts|takes|completes)/i.test(line) || /accept[^.|]*\bwith Tab\b/i.test(line);
      assert.ok(!tabAccepts, `${path}: ${line}`);
    }
  }
});

test('the code studio help covers languages, packs, tests, debugging, and privacy', () => {
  const page = read('docs/help/code-studio.md');
  for (const heading of [
    '## What each language can and cannot do',
    '## Runtime packs',
    '## Tests',
    '## Debugging',
    '## Suggestions and privacy',
  ]) {
    assert.ok(page.includes(heading), heading);
  }
});
