import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { failures, ITEMS, missingPhrases, result, table } from './checklist.ts';
import type { Run } from './checklist.ts';

describe('the NVDA checklist', () => {
  it('has items with distinct ids, a title, and at least one phrase to hear', () => {
    assert.ok(ITEMS.length >= 6);
    assert.equal(new Set(ITEMS.map((item) => item.id)).size, ITEMS.length);
    for (const item of ITEMS) {
      assert.ok(item.title.length > 0 && item.covers.length > 0, item.id);
      assert.ok(item.expect.length > 0, item.id);
    }
  });

  it('names only roles and names the app sets', () => {
    const roles = new Set(['tree', 'tab', 'textbox', 'page']);
    for (const item of ITEMS) assert.ok(roles.has(item.setup.role), item.id);
  });
});

describe('matching the spoken log', () => {
  const log = ['banner landmark', 'Notebooks navigation landmark', 'Pages navigation landmark', 'main landmark'];

  it('finds phrases in order, whatever the case', () => {
    assert.deepEqual(missingPhrases(log, ['notebooks', 'PAGES', 'Main']), []);
  });

  it('reports a phrase that was never said', () => {
    assert.deepEqual(missingPhrases(log, ['Notebooks', 'Sidebar']), ['Sidebar']);
  });

  it('reports a phrase said only before the one that must come first', () => {
    assert.deepEqual(missingPhrases(log, ['main', 'Notebooks']), ['Notebooks']);
  });

  it('lets two phrases come in the same line', () => {
    assert.deepEqual(missingPhrases(['Page text edit multi line'], ['Page text', 'edit']), []);
  });

  it('treats punctuation in a phrase as text, not a pattern', () => {
    assert.deepEqual(missingPhrases(['Import notes… button'], ['notes…']), []);
    assert.deepEqual(missingPhrases(['abc'], ['a.c']), ['a.c']);
  });
});

describe('recording a run', () => {
  const run: Run = {
    nvda: '2026.1',
    browser: 'msedge',
    date: '2026-10-07',
    results: [
      result(ITEMS[0], ['Notebooks', 'Pages', 'main landmark']),
      result(ITEMS[1], ['heading level 1 Membranes']),
    ],
  };

  it('puts one row in the table for each item, and says which failed and what was missing', () => {
    const text = table(run);
    assert.match(text, /NVDA 2026\.1 in msedge, 2026-10-07/);
    assert.equal(text.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Item')).length, 2);
    assert.match(text, /\| Pass \| None \|/);
    assert.match(text, /\| Fail \| Short note \|/);
  });

  it('lists a failure for each failing item', () => {
    assert.deepEqual(failures(run), ['headings: NVDA did not say Short note']);
  });
});
