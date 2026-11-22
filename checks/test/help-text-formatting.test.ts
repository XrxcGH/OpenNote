import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('the text formatting help page exists and is linked', () => {
  const page = read('docs/help/text-formatting.md');
  for (const word of ['Format pane', 'ruler', 'Ctrl+D', 'Ctrl+Shift+E', 'Alt+X', 'Paste Options']) {
    assert.ok(page.includes(word), word);
  }
  assert.ok(read('docs/help/README.md').includes('(text-formatting.md)'));
  assert.ok(read('README.md').includes('docs/help/text-formatting.md'));
});

test('import and export has Word and paste text formatting sections', () => {
  const page = read('docs/help/import-and-export.md');
  assert.ok(page.includes('### Word files and text formatting'));
  assert.ok(page.includes('### Paste and text formatting'));
});
