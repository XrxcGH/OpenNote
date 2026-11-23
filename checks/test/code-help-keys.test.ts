import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const PAGES = ['docs/help/code-cells.md', 'docs/help/code-studio.md'];
/** Wordings such as "Press Tab to accept"; a Ctrl+ prefix is allowed. */
const WRONG_TAB_WORDING =
  /(^|[^+\w])Tab to (accept|complete|take)|(^|[^+\w])press(es)? Tab\b[^.|]*\b(accept|complete|take)/i;

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
        /(^|[^+\w])Tab (accepts|takes|completes)/i.test(line) ||
        /accept[^.|]*\bwith Tab\b/i.test(line) ||
        WRONG_TAB_WORDING.test(line);
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

test('the negative check catches "Press Tab to accept" and spares Ctrl+Tab', () => {
  assert.ok(WRONG_TAB_WORDING.test('Press Tab to accept the suggestion.'));
  assert.ok(WRONG_TAB_WORDING.test('Press Tab and it will complete the word.'));
  assert.ok(!WRONG_TAB_WORDING.test('Press Ctrl+Tab to accept the suggestion.'));
});

test('the code studio help gives one answer on typed input, the same as the Python page', () => {
  const studio = read('docs/help/code-studio.md');
  assert.ok(read('docs/help/python-projects.md').includes('A program cannot wait for typing yet'));
  assert.ok(!/while the program waits/i.test(studio), 'the studio page says a program can wait for typing');
  assert.ok(/Python \(Quick\)[^\n]*type the input before the run/.test(studio), 'the Quick Python row is unclear');
  assert.ok(!studio.includes('JSON reader'), 'the Lua row is cryptic');
});

test('the keys section has a heading over each of its tables', () => {
  const keys = read('docs/help/code-studio.md').split('\n## Keys')[1]!.split('\n## ')[0]!;
  const lines = keys.split('\n');
  const tables = lines.filter((line, at) => line.startsWith('| Key') && !lines[at - 1]?.startsWith('|'));
  assert.equal(tables.length, 2);
  assert.equal(lines.filter((line) => line.startsWith('### ')).length, 2);
});
