// Plain Node tests of the screenshot matrix plan. Run with: npm run test:matrix

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SIZES,
  THEMES,
  cellName,
  describeMatrix,
  matchesScreen,
  matrixCells,
  parseFilter,
  skipWithoutBaseline,
} from './matrix.ts';
import { VIEWPORTS } from './screens.ts';
import type { ScreenState } from './screens.ts';

const screen = (id: string, over: Partial<ScreenState> = {}): ScreenState => ({ id, description: id, ...over });

describe('the matrix', () => {
  it('crosses every screen with every size and both themes', () => {
    const cells = matrixCells([screen('a.one'), screen('b.two')]);
    assert.equal(cells.length, 2 * SIZES.length * THEMES.length);
    assert.deepEqual(cells[0]?.name, 'a.one.compact.light');
    assert.deepEqual(cells.at(-1)?.name, 'b.two.wide.dark');
  });

  it('keeps a screen to the sizes and themes it asks for', () => {
    const cells = matrixCells([screen('phone.only', { sizes: ['compact'], themes: ['dark'] })]);
    assert.deepEqual(
      cells.map((c) => c.name),
      ['phone.only.compact.dark'],
    );
  });

  it('is empty with no screens, which is how it starts', () => {
    assert.deepEqual(matrixCells([]), []);
    assert.equal(describeMatrix([]), '0 pictures from 0 screen states');
  });

  it('refuses two screens with the same id, so two pictures never share a baseline', () => {
    assert.throws(() => matrixCells([screen('same'), screen('same')]), /same name/);
  });

  it('describes itself for the report', () => {
    assert.equal(describeMatrix(matrixCells([screen('x')])), '8 pictures from 1 screen state');
    assert.equal(describeMatrix(matrixCells([screen('x'), screen('y')])), '16 pictures from 2 screen states');
  });

  it('names a picture from its screen, size, and theme', () => {
    assert.equal(cellName('settings.general', 'wide', 'dark'), 'settings.general.wide.dark');
  });
});

describe('narrowing a run', () => {
  const screens = [screen('settings.general'), screen('settings.about'), screen('palette.commands')];

  it('matches a whole id or a prefix that ends in a dot', () => {
    assert.ok(matchesScreen('settings.general', 'settings.'));
    assert.ok(matchesScreen('settings.general', 'settings.general'));
    assert.ok(!matchesScreen('settings.general', 'settings'));
    assert.ok(!matchesScreen('settings.general', 'settings.gen'));
  });

  it('filters by screen, size, and theme', () => {
    const cells = matrixCells(screens, { screens: ['settings.'], sizes: ['compact', 'wide'], themes: ['dark'] });
    assert.deepEqual(
      cells.map((c) => c.name),
      [
        'settings.general.compact.dark',
        'settings.general.wide.dark',
        'settings.about.compact.dark',
        'settings.about.wide.dark',
      ],
    );
  });

  it('reads the filter from the environment', () => {
    assert.deepEqual(parseFilter({}), { screens: undefined, sizes: undefined, themes: undefined });
    assert.deepEqual(
      parseFilter({
        OPENNOTE_MATRIX_SCREENS: 'settings., palette.commands ',
        OPENNOTE_MATRIX_SIZES: 'compact,wide',
        OPENNOTE_MATRIX_THEMES: 'dark',
      }),
      { screens: ['settings.', 'palette.commands'], sizes: ['compact', 'wide'], themes: ['dark'] },
    );
  });

  it('refuses a size or theme that does not exist, so a typo never hides a screen', () => {
    assert.throws(() => parseFilter({ OPENNOTE_MATRIX_SIZES: 'huge' }), /"huge" is not one of/);
    assert.throws(() => parseFilter({ OPENNOTE_MATRIX_THEMES: 'sepia' }), /"sepia" is not one of/);
  });
});

describe('baselines', () => {
  it('skips a picture without a baseline in a normal run, and never when updating', () => {
    assert.equal(skipWithoutBaseline('missing', false), true);
    assert.equal(skipWithoutBaseline('none', false), true);
    assert.equal(skipWithoutBaseline('missing', true), false);
    assert.equal(skipWithoutBaseline('changed', false), false);
    assert.equal(skipWithoutBaseline('all', false), false);
  });
});

describe('the size classes', () => {
  it('each have a viewport, so no cell is left without a window size', () => {
    for (const size of SIZES) assert.ok(VIEWPORTS[size].width > 0 && VIEWPORTS[size].height > 0, size);
  });
});
