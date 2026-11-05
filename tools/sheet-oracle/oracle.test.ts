// Tests of the LibreOffice oracle. The first ones need nothing installed. The last one runs LibreOffice on the
// two-case sample fixture and must reproduce its committed values; it is skipped when soffice is absent, and the
// nightly job installs LibreOffice and sets SHEET_ORACLE_REQUIRED, so there it fails instead.
// Run: node --test tools/sheet-oracle/oracle.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  cellIndex,
  changes,
  fodsFor,
  parseCsv,
  readValue,
  runOracle,
  same,
  sofficeVersion,
  type Fixture,
} from './oracle.ts';

const sample = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'sample.json'), 'utf8')) as Fixture;

test('writes one sheet per case and a results sheet first', () => {
  const xml = fodsFor(sample.cases);
  assert.ok(xml.indexOf('table:name="results"') < xml.indexOf('table:name="c1"'));
  assert.match(xml, /table:formula="msoxl:=c1!ZZ1"/);
  assert.match(xml, /table:formula="msoxl:=2\^3\^2"/);
  assert.match(xml, /table:formula="msoxl:=SUM\(A1:A2\)\/4"/);
  assert.match(xml, /office:value-type="float" office:value="7"/);
  assert.match(fodsFor([{ formula: '="a<b"&"&"', source: 'hand' }]), /msoxl:=&quot;a&lt;b&quot;&amp;&quot;&amp;&quot;/);
});

test('reads cell names, CSV fields, and values', () => {
  assert.deepEqual(cellIndex('ZZ1'), { col: 701, row: 0 });
  assert.deepEqual(cellIndex('b3'), { col: 1, row: 2 });
  assert.deepEqual(parseCsv('1,"a,""b"""\r\n2,\n'), [
    ['1', 'a,"b"'],
    ['2', ''],
  ]);
  assert.equal(readValue('2.5'), 2.5);
  assert.equal(readValue('TRUE'), true);
  assert.equal(readValue('#DIV/0!'), '#DIV/0!');
  assert.equal(readValue(''), '');
});

test('reports only changed calc-oracle values', () => {
  const fixture: Fixture = {
    cases: [
      { formula: '=1', expected: 1, source: 'calc-oracle' },
      { formula: '=2', expected: 2, source: 'excel-doc' },
      { formula: '=3', expected: 3, source: 'calc-oracle', 'oracle-differs': true },
      { formula: '=0.1+0.2', expected: 0.3, source: 'calc-oracle' },
    ],
  };
  assert.deepEqual(changes(fixture, [1, 9, 9, 0.30000000000000004]), []);
  assert.deepEqual(changes(fixture, [5, 2, 3, 0.3]), ['=1: committed 1, LibreOffice 5']);
  assert.ok(same(1, 1.05, 0.1));
  assert.ok(!same('1', 1));
});

const required = process.env.SHEET_ORACLE_REQUIRED === '1';
const absent = sofficeVersion() === null;

test(
  'reproduces the committed values of the sample fixture',
  { skip: absent && !required && 'soffice is absent' },
  () => {
    assert.ok(!absent, 'LibreOffice is required here but did not run.');
    const values = runOracle(sample.cases);
    assert.deepEqual(changes(sample, values), []);
  },
);
