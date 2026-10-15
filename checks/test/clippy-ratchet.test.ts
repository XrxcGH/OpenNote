// The counting and comparing of the clippy ratchet (checks/clippy-ratchet.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, countMessages, inScope, readBaseline, tidy } from '../clippy-ratchet.ts';

function message(code: string, file: string, primary = true, line = 1): string {
  return JSON.stringify({
    reason: 'compiler-message',
    message: { code: { code }, spans: [{ file_name: file, is_primary: primary, line_start: line }] },
  });
}

test('counts the three lints in shipped code by file', () => {
  const counts = countMessages([
    message('clippy::unwrap_used', 'crates/core/src/a.rs', true, 1),
    message('clippy::unwrap_used', 'crates/core/src/a.rs', true, 2),
    message('clippy::expect_used', 'crates\\core\\src\\a.rs', true, 3),
    message('clippy::panic', 'app/src-tauri/src/b.rs'),
    message('clippy::needless_return', 'crates/core/src/a.rs'),
    'not json',
  ]);
  assert.deepEqual(counts, {
    'crates/core/src/a.rs': { unwrap_used: 2, expect_used: 1 },
    'app/src-tauri/src/b.rs': { panic: 1 },
  });
});

test('leaves out tests, fuzz targets, and code outside crates and the app', () => {
  assert.equal(inScope('crates/core/src/a.rs'), true);
  assert.equal(inScope('crates/core/tests/a.rs'), false);
  assert.equal(inScope('crates/core/fuzz/fuzz_targets/a.rs'), false);
  assert.equal(inScope('tests/crash/src/main.rs'), false);
  assert.equal(inScope('spikes/harness/src/main.rs'), false);
  assert.equal(inScope('app/src-tauri/build.rs'), false);
});

test('a count that goes up, or a new file with a use, is worse', () => {
  const baseline = { 'crates/a.rs': { unwrap_used: 2 } };
  const result = compare({ 'crates/a.rs': { unwrap_used: 3 }, 'crates/b.rs': { panic: 1 } }, baseline);
  assert.equal(result.worse.length, 2);
  assert.deepEqual(result.better, []);
});

test('a count that goes down is better, and an equal count passes', () => {
  const baseline = { 'crates/a.rs': { unwrap_used: 2, panic: 1 } };
  const result = compare({ 'crates/a.rs': { unwrap_used: 1, panic: 1 } }, baseline);
  assert.deepEqual(result.worse, []);
  assert.equal(result.better.length, 1);
});

test('tidy drops zeros and sorts files', () => {
  assert.deepEqual(tidy({ 'b.rs': { panic: 0 }, 'a.rs': { expect_used: 2, panic: 0 } }), {
    'a.rs': { expect_used: 2 },
  });
});

test('the baseline file is readable and covers only shipped code', () => {
  for (const file of Object.keys(readBaseline())) assert.equal(inScope(file), true, file);
});
