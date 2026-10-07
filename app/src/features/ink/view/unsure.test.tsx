// The words the recognizer was unsure of: where a word sits in its text box, the marks the writing pen and Convert
// to text leave, and the button over each amber line that offers the other readings and swaps one in as one step.
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { InkWord } from '../../../services/intel';
import type { BlockJson, EditBatch } from '../../../services/pages/types';
import type { InkHost } from './host';
import type { InkSurface } from './surface';
import { chooseUnsure, marksFor, replaceWord, showUnsure, wordAt } from './unsure';

const word = (text: string, alternates: string[], x = 0): InkWord => ({
  text,
  alternates,
  strokes: [],
  bounds: { x, y: 100, width: 40, height: 20 },
});

const tidy = (text: string) => text.replace(/->/g, '→').replace(/H2O/g, 'H₂O');

describe('a word in its text box', () => {
  it('is found as a whole word, by which match it is', () => {
    expect(wordAt('cell wall cell', 'cell', 0)).toBe(0);
    expect(wordAt('cell wall cell', 'cell', 1)).toBe(10);
    expect(wordAt('cells cell', 'cell', 0)).toBe(6);
    expect(wordAt('cell', 'wall', 0)).toBe(-1);
  });

  it('is replaced in place, or not at all when it is gone', () => {
    expect(replaceWord('sell wall sell', 'sell', 1, 'cell')).toBe('sell wall cell');
    expect(replaceWord('wall', 'sell', 0, 'cell')).toBeNull();
  });

  it('gets a mark for each underlined word, read through the tidy rules the text box used', () => {
    const words = [word('H2O', ['HzO', 'H20']), word('->', []), word('sell', ['cell', 'self'], 60)];
    const strokes = new Map([
      [words[0], 'u1'],
      [words[2], 'u2'],
    ]);
    const marks = marksFor(words, 'box', 'H₂O → sell', strokes, {
      tidy,
      alternatives: (w) => w.alternates,
    });
    expect(marks.map((m) => [m.stroke, m.word, m.occurrence, m.alternatives])).toEqual([
      ['u1', 'H₂O', 0, ['HzO', 'H20']],
      ['u2', 'sell', 0, ['cell', 'self']],
    ]);
  });
});

describe('the button over an amber line', () => {
  let chrome: HTMLDivElement;
  afterEach(() => chrome?.remove());

  function setup(markdown: string) {
    chrome = document.body.appendChild(document.createElement('div'));
    chrome.setAttribute('role', 'region');
    chrome.setAttribute('aria-label', 'Ink');
    const strokes = new Set(['u1']);
    const sent: EditBatch[] = [];
    const block = { id: 'box', type: 'text', data: { markdown } } as unknown as BlockJson;
    const surface = {
      chrome,
      cameraNow: () => ({ zoom: 1, scrollX: 0, scrollY: 0 }),
      onChange: () => () => undefined,
      index: { has: (id: string) => strokes.has(id) },
      hide: (ids: readonly string[]) => {
        ids.forEach((id) => strokes.delete(id));
        return [];
      },
      show: () => undefined,
      send: async (batch: EditBatch) => {
        sent.push(batch);
        return true;
      },
    } as unknown as InkSurface;
    const host = {
      queue: { get: () => ({ undo: async () => undefined }) },
      layer: { get: () => ({ block: (id: string) => (id === 'box' ? block : null) }) },
    } as unknown as InkHost;
    showUnsure(host, surface, [
      {
        stroke: 'u1',
        block: 'box',
        word: 'sell',
        occurrence: 0,
        alternatives: ['cell', 'self'],
        bounds: { x: 10, y: 10, width: 40, height: 20 },
      },
    ]);
    return { surface, sent, strokes };
  }

  it('opens the other readings on a tap and swaps the chosen one in, with the line gone, as one step', async () => {
    const { sent, strokes } = setup('A sell wall');
    const button = screen.getByRole('button', { name: 'Unsure word: sell. Choose another reading' });
    await userEvent.click(button);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'cell' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].edits).toEqual([
      { edit: 'setText', block: 'box', markdown: 'A cell wall' },
      { edit: 'removeStrokes', strokes: ['u1'] },
    ]);
    expect(strokes.has('u1')).toBe(false);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Unsure word/ })).toBeNull());
  });

  it('opens from the keyboard with Enter, and Keep removes only the line', async () => {
    const { surface, sent } = setup('A sell wall');
    const button = screen.getByRole('button', { name: 'Unsure word: sell. Choose another reading' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Keep "sell"' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].edits).toEqual([{ edit: 'removeStrokes', strokes: ['u1'] }]);
    // Asking again for a line that is gone does nothing.
    await chooseUnsure(surface, 'u1');
    expect(sent).toHaveLength(1);
  });
});
