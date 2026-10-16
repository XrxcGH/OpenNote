import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pseudoize } from '../../app/src/strings/pseudo.ts';
import { loose } from './pseudoName.ts';

describe('names that match in English and in the pseudo-locale', () => {
  it('matches the English name and the pseudo name', () => {
    for (const text of ['Export…', 'Choose a folder…', 'Add timer', 'Open the graph view']) {
      assert.match(text, loose(text));
      assert.match(pseudoize(text), loose(text));
    }
  });

  it('does not match a different name', () => {
    assert.doesNotMatch('Export', loose('Import'));
    assert.doesNotMatch(pseudoize('Exports'), loose('Export'));
    assert.doesNotMatch('Add timer now', loose('Add timer'));
  });

  it('matches a start, or a part, when asked', () => {
    assert.match('Export "Lectures" as a file', loose('Export "Lectures"', { prefix: true }));
    assert.match(pseudoize('Export "Lectures"'), loose('Export "Lectures"', { prefix: true }));
    assert.match('4 pages will come into a new notebook', loose('pages will come', { contains: true }));
  });

  it('treats punctuation as text', () => {
    assert.doesNotMatch('Exportx', loose('Export.'));
  });
});
