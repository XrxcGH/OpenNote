// The Layers dialog: every control is a named button, and each change goes to the page as one view patch.
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { showLayers } from './LayersDialog';
import { activeLayer, BASE_LAYER, inkLayers, noLayers } from './layers';
import type { InkSurface } from './surface';

afterEach(() => {
  inkLayers.set(noLayers());
  activeLayer.set(BASE_LAYER);
});

describe('the Layers dialog', () => {
  it('adds, hides, locks, activates and deletes layers, and describes each change as a view patch', async () => {
    const send = vi.fn(async () => true);
    const closed = showLayers({ send } as unknown as InkSurface);
    const dialog = await screen.findByRole('dialog', { name: 'Layers' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add a layer' }));
    const rows = await within(dialog).findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(inkLayers.get().order).toHaveLength(2);
    expect(send).toHaveBeenLastCalledWith(
      {
        edits: [
          expect.objectContaining({
            edit: 'setPage',
            view: { inkLayers: expect.objectContaining({ order: expect.any(Array) }) },
          }),
        ],
      },
      expect.any(Function),
    );
    // The new layer is on top; the base layer is last.
    const top = rows[0];
    await userEvent.click(within(top).getByRole('button', { name: 'Hide' }));
    const added = inkLayers.get().order[1];
    expect(inkLayers.get().defs.get(added)?.hidden).toBe(true);
    await userEvent.click(within(top).getByRole('button', { name: 'Lock' }));
    expect(inkLayers.get().defs.get(added)?.locked).toBe(true);
    await userEvent.click(within(top).getByRole('button', { name: 'Make active' }));
    expect(activeLayer.get()).toBe(added);
    expect(within(rows[1]).queryByRole('button', { name: 'Delete' })).toBeNull();
    await userEvent.click(within(top).getByRole('button', { name: 'Delete' }));
    expect(inkLayers.get().order).toEqual([BASE_LAYER]);
    expect(activeLayer.get()).toBe(BASE_LAYER);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await closed;
  });
});
