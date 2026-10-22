// The Draw tab's snap switches on plain and lined paper: on ruled, grid, or dot paper the grid switch is "Snap to paper
// lines", on by default and remembered, and the grid's own spacing is for plain paper only.
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { PaperLattice } from '../../../core/paperLattice';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { DrawSnap } from './DrawSnap';
import { paperNow, paperSnapNow } from './paperSnap';
import { inkPrefs, setPrefs } from './prefs';
import { geometryTool } from './snapTools';

const toolProps = { tabIndex: -1, 'data-tool': '' } as const;
const original = inkPrefs.get();
const grid: PaperLattice = {
  kind: 'grid',
  step: 20,
  origin: { x: 96, y: 72 },
  area: { x: 96, y: 72, w: 620, h: 900 },
  sheet: 1056,
  margin: null,
};

afterEach(() => {
  paperNow.set(null);
  setPrefs({ paperSnap: original.paperSnap, gridSnap: original.gridSnap });
});

const bar = () =>
  renderUi(
    <main>
      <div role="toolbar" aria-label="Draw">
        <DrawSnap toolProps={toolProps} />
      </div>
    </main>,
  );

describe('snapping in the Draw tab', () => {
  it('reads Snap to grid on plain paper, with its own grid size', async () => {
    bar();
    expect(screen.queryByRole('button', { name: 'Snap to paper lines' })).toBeNull();
    const snap = screen.getByRole('button', { name: 'Snap to grid' });
    await userEvent.click(snap);
    expect(screen.getByRole('button', { name: 'Grid size' })).toBeTruthy();
    expect(paperSnapNow(1)).toBeNull();
  });

  it('reads Snap to paper lines on lined paper, on by default, and turning it off is remembered', async () => {
    paperNow.set(grid);
    bar();
    const snap = await screen.findByRole('button', { name: 'Snap to paper lines' });
    expect(snap.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Snap to grid' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Grid size' })).toBeNull();
    expect(paperSnapNow(1)?.lattice).toBe(grid);
    // Alt turns it off for one stroke or drag.
    expect(paperSnapNow(1, true)).toBeNull();
    await userEvent.click(snap);
    expect(inkPrefs.get().paperSnap).toBe(false);
    expect(JSON.parse(localStorage.getItem('opennote.ink.prefs') ?? '{}')).toMatchObject({ paperSnap: false });
    expect(snap.getAttribute('aria-pressed')).toBe('false');
    expect(paperSnapNow(1)).toBeNull();
    await expectNoAxeViolations(document.body);
  });

  it('offers the measure, the compass, and the ruler units, one tool at a time', async () => {
    bar();
    const measure = screen.getByRole('button', { name: 'Measure' });
    const compass = screen.getByRole('button', { name: 'Compass' });
    await userEvent.click(measure);
    expect(measure.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(compass);
    expect(geometryTool.get()).toBe('compass');
    expect(measure.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(screen.getByRole('button', { name: 'Units' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Units: inches' }));
    expect(inkPrefs.get().rulerUnits).toBe('imperial');
    await expectNoAxeViolations(document.body);
    setPrefs({ rulerUnits: original.rulerUnits });
    geometryTool.set('none');
  });
});
