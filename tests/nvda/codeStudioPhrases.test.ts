import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CODE_EDITOR_PHRASES, CONSOLE_PHRASES, PROBLEMS_PHRASES, SQUIGGLE_PHRASES } from './phrases.ts';

// The spoken squiggle text comes from the app's string; the script's pattern must match what that string makes.
test('the NVDA squiggle phrase matches the problem string', () => {
  const strings = readFileSync(new URL('../../app/src/strings/en/codeStudio/editor.ts', import.meta.url), 'utf8');
  assert.ok(strings.includes("problem: 'Line {line}: {message}'"));
  const spoken = 'Line {line}: {message}'.replace('{line}', '1').replace('{message}', "Undefined name 'totl'");
  for (const phrase of SQUIGGLE_PHRASES) assert.match(spoken, phrase);
  // NVDA's speech drops the quote before a word, as the nightly run of 2026-11-27 recorded.
  for (const phrase of SQUIGGLE_PHRASES) assert.match("Line 1: Undefined name totl' (test)", phrase);
});

// The suggestion script expects what the app's announcement strings make, with the default Accept chord.
test('the NVDA suggestion phrases match the announcement strings', () => {
  const strings = readFileSync(new URL('../../app/src/strings/en/codeStudio/editor.ts', import.meta.url), 'utf8');
  assert.ok(strings.includes("suggestion: 'Suggestion: {text}. {keys} to accept.'"));
  assert.ok(strings.includes("inserted: 'Inserted: {text}'"));
  const [suggested, inserted] = CODE_EDITOR_PHRASES;
  assert.match('Suggestion: nt(total). Ctrl+Tab to accept.', suggested!);
  assert.match('Inserted: nt(total)', inserted!);
});

// The console and Problems scripts expect what these strings make, so a reworded string fails here first.
test('the NVDA console and Problems phrases match the studio strings', () => {
  const strings = readFileSync(new URL('../../app/src/strings/en/codeStudio/studio.ts', import.meta.url), 'utf8');
  assert.ok(strings.includes("openAt: 'Open {file} at line {line}'"));
  assert.ok(strings.includes("where: 'Line {line}, column {column}'"));
  const link = 'Open {file} at line {line}'.replace('{file}', 'main.py').replace('{line}', '3');
  for (const phrase of CONSOLE_PHRASES) assert.match(link, phrase);
  const row = 'Error boom Line {line}, column {column} · ValueError'.replace('{line}', '3').replace('{column}', '1');
  for (const phrase of PROBLEMS_PHRASES) assert.match(row, phrase);
});
