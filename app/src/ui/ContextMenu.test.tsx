import { fireEvent, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLayerEscape } from '../state/layers';
import { expectFocus, expectNoAxeViolations, pressChord, renderUi } from '../test';
import { Button } from './Button';
import { useContextMenu } from './ContextMenu';
import type { MenuAnchor } from './Menu';

/** Waits for opening motion to end, so axe measures final colors. */
const settle = () => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => null)));

let stopEscape = () => {};
beforeEach(() => {
  stopEscape = installLayerEscape();
});
afterEach(() => stopEscape());

function Rows({ onBuild, empty = false }: { onBuild(anchor: MenuAnchor): void; empty?: boolean }) {
  const ref = useRef<HTMLUListElement>(null);
  useContextMenu(ref, (anchor) => {
    onBuild(anchor);
    return empty ? null : { label: 'Page actions', items: [{ id: 'rename', label: 'Rename' }] };
  });
  return (
    <ul ref={ref} aria-label="Pages">
      <li>
        <Button>Mitosis</Button>
      </li>
      <li>
        <Button>Meiosis</Button>
      </li>
    </ul>
  );
}

/** Focuses a row and presses a menu key, as a keyboard user opens a context menu. */
async function pressMenuKey(chord: string, name: string) {
  const onBuild = vi.fn();
  renderUi(<Rows onBuild={onBuild} />);
  const row = screen.getByRole('button', { name });
  row.focus();
  await pressChord(chord);
  // Chromium fires contextmenu for the key itself; when the test browser doesn't, send the event it would.
  if (!onBuild.mock.calls.length) fireEvent.contextMenu(row, { button: 0, clientX: 0, clientY: 0 });
  return { row, onBuild };
}

describe('useContextMenu', () => {
  it('opens at the pointer on right-click, and keeps the browser menu away', async () => {
    const onBuild = vi.fn();
    renderUi(<Rows onBuild={onBuild} />);
    const row = screen.getByRole('button', { name: 'Meiosis' });
    const shown = fireEvent.contextMenu(row, { button: 2, clientX: 120, clientY: 90 });
    expect(shown).toBe(false);
    expect(onBuild).toHaveBeenCalledWith({ x: 120, y: 90 });
    await screen.findByRole('menu', { name: 'Page actions' });
  });

  it('opens below the focused row for Shift+F10, and focus returns to the row', async () => {
    const { row, onBuild } = await pressMenuKey('Shift+F10', 'Meiosis');
    expect(onBuild).toHaveBeenCalledWith(row);
    await expectFocus(await screen.findByRole('menuitem', { name: 'Rename' }));
    await pressChord('Escape');
    await expectFocus(row);
  });

  it('treats the Menu key the same way', async () => {
    const { row, onBuild } = await pressMenuKey('Menu', 'Mitosis');
    expect(onBuild).toHaveBeenCalledWith(row);
  });

  it('leaves the event alone when there is no menu', () => {
    renderUi(<Rows onBuild={() => {}} empty />);
    const shown = fireEvent.contextMenu(screen.getByRole('button', { name: 'Mitosis' }), { button: 2 });
    expect(shown).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('passes axe with the menu open', async () => {
    const { container } = renderUi(<Rows onBuild={() => {}} />, { theme: 'dark' });
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Mitosis' }), { button: 2, clientX: 10, clientY: 10 });
    await screen.findByRole('menu');
    await settle();
    await expectNoAxeViolations(container);
  });
});
