// Every bundled asset and vendored crate has a row in docs/ATTRIBUTION.md (checks/attribution.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributionGaps, describeGaps, findGaps, parseRows } from '../attribution.ts';

const TABLE = [
  '| Path | Author | Source | License |',
  '|---|---|---|---|',
  '| `brand/**` | OpenNote | this repository | Apache-2.0 |',
  '| `crates/third_party/demo/**` | Someone | https://example.test | MIT |',
].join('\n');

test('the repository has an attribution row for every asset', () => {
  assert.deepEqual(describeGaps(attributionGaps()), []);
});

test('a font with no row is reported', () => {
  const gaps = findGaps(['brand/logo.svg', 'app/fonts/Inter.woff2'], TABLE);
  assert.deepEqual(gaps.uncovered, ['app/fonts/Inter.woff2']);
});

test('code and text files need no row', () => {
  assert.deepEqual(findGaps(['brand/a.svg', 'app/src/a.ts', 'README.md'], TABLE).uncovered, []);
});

test('a row that matches nothing is stale', () => {
  assert.deepEqual(findGaps(['README.md'], TABLE).stale, ['brand/**', 'crates/third_party/demo/**']);
});

test('a row without a license is incomplete', () => {
  const gaps = findGaps(['brand/a.svg'], '| `brand/**` | OpenNote | this repository |   |');
  assert.deepEqual(gaps.incomplete, ['brand/**']);
});

test('a vendored crate needs its license text and a row', () => {
  const none = findGaps(['crates/third_party/demo/src/lib.rs'], '');
  assert.equal(none.vendored.length, 2);
  const ok = findGaps(['crates/third_party/demo/src/lib.rs', 'crates/third_party/demo/LICENSE-APACHE'], TABLE);
  assert.deepEqual(ok.vendored, []);
});

test('rows are read from backticked paths only', () => {
  assert.equal(parseRows(TABLE).length, 2);
});

const FONT = '@fontsource/demo-font';
const FACTS = {
  dependencies: [FONT, 'react'],
  notices: 'Copyright 2020 The Demo Authors',
  copyrights: { [FONT]: 'Copyright 2020 The Demo Authors' },
};
const FONT_ROW = `| \`npm:${FONT}\` | The Demo Authors | https://example.test | OFL-1.1 |`;

test('a bundled font package needs an npm row', () => {
  assert.equal(findGaps([], '', FACTS).packages.length, 1);
  assert.deepEqual(findGaps([], FONT_ROW, FACTS).packages, []);
});

test('a bundled font package needs its copyright line in the notices', () => {
  const facts = { ...FACTS, notices: 'nothing here' };
  assert.equal(findGaps([], FONT_ROW, facts).packages.length, 1);
});

test('an npm row for a package that is not a dependency is stale', () => {
  assert.equal(findGaps([], FONT_ROW, { ...FACTS, dependencies: [] }).packages.length, 1);
});
