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

// The console and Problems scripts expect what these strings make, so a reworded string fails here first.
test('the NVDA console and Problems phrases match the studio strings', () => {
  const strings = readFileSync(new URL('../../app/src/strings/en/codeStudio/studio.ts', import.meta.url), 'utf8');
  assert.ok(strings.includes("openAt: 'Open {file} at line {line}'"));
  assert.ok(strings.includes("where: 'Line {line}, column {column}'"));
  assert.match(
    'Open {file} at line {line}'.replace('{file}', 'main.py').replace('{line}', '3'),
    /Open main\.py at line 3/i,
  );
  assert.match('Line {line}, column {column}'.replace('{line}', '3').replace('{column}', '1'), /Line 3, column 1/i);
});
