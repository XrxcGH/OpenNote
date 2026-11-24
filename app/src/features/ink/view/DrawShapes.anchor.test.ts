// @vitest-environment jsdom
// Where the shape library opens when More or the command palette opens it.
import { afterEach, describe, expect, it, vi } from 'vitest';

const opened: unknown[] = [];
vi.mock('../../../ui', () => ({
  openMenu: (spec: { anchor: unknown }) => {
    opened.push(spec.anchor);
    return Promise.resolve();
  },
}));

const { openShapeLibrary } = await import('./DrawShapes');

afterEach(() => {
  document.body.replaceChildren();
  opened.length = 0;
});

describe('the shape library anchor', () => {
  it('opens at the More button, not at the closing More menu item (walk 9, T1-D03-8)', async () => {
    const slot = document.createElement('span');
    slot.dataset.more = '';
    const more = document.createElement('button');
    slot.append(more);
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('button');
    item.setAttribute('role', 'menuitem');
    menu.append(item);
    document.body.append(slot, menu);
    item.focus();
    await openShapeLibrary();
    expect(opened[0]).toBe(more);
  });

  it('opens at a point when the focused control has left the page', async () => {
    await openShapeLibrary();
    expect(opened[0]).toEqual({ x: Math.round(window.innerWidth / 2), y: 96 });
  });
});
