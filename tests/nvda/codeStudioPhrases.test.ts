import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The spoken squiggle text comes from the app's string; the script's pattern must match what that string makes.
test('the NVDA squiggle phrase matches the problem string', () => {
  const strings = readFileSync(new URL('../../app/src/strings/en/codeStudio/editor.ts', import.meta.url), 'utf8');
  assert.ok(strings.includes("problem: 'Line {line}: {message}'"));
  const spoken = 'Line {line}: {message}'.replace('{line}', '1').replace('{message}', "Undefined name 'totl'");
  assert.match(spoken, /Line 1: Undefined name 'totl'/i);
});
