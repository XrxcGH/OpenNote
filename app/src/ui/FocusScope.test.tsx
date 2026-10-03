import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { expectFocus, pressChord, renderUi } from '../test';
import { FocusScope, wrapTarget } from './FocusScope';

function Panel({ contain = true }: { contain?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open panel
      </button>
      {open && (
        <FocusScope contain={contain} autoFocus restoreFocus>
          <section aria-label="Panel">
            <button type="button">First</button>
            <button type="button" disabled>
              Unavailable
            </button>
            <input aria-label="Middle" />
            <button type="button" onClick={() => setOpen(false)}>
              Done
            </button>
          </section>
        </FocusScope>
      )}
      <button type="button">After</button>
    </>
  );
}

function openPanel(contain = true) {
  renderUi(<Panel contain={contain} />);
  const opener = screen.getByRole('button', { name: 'Open panel' });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe('FocusScope', () => {
  it('focuses the first control when it mounts', async () => {
    openPanel();
    await expectFocus(screen.getByRole('button', { name: 'First' }));
  });

  it('wraps Tab and Shift+Tab, skipping disabled controls', async () => {
    openPanel();
    await pressChord('Shift+Tab');
    await expectFocus(screen.getByRole('button', { name: 'Done' }));
    await pressChord('Tab');
    await expectFocus(screen.getByRole('button', { name: 'First' }));
    await pressChord('Tab');
    await expectFocus(screen.getByRole('textbox', { name: 'Middle' }));
  });

  it('lets Tab leave when it doesn’t contain', async () => {
    openPanel(false);
    await pressChord('Shift+Tab');
    await expectFocus(screen.getByRole('button', { name: 'Open panel' }));
  });

  it('returns focus when it closes with focus inside', async () => {
    const opener = openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await expectFocus(opener);
  });
});

describe('wrapTarget', () => {
  const [a, b, c] = ['a', 'b', 'c'].map(() => document.createElement('button'));
  it('wraps at the ends and when focus is outside the list', () => {
    expect(wrapTarget([a, b, c], c, false)).toBe(a);
    expect(wrapTarget([a, b, c], a, true)).toBe(c);
    expect(wrapTarget([a, b, c], document.body, false)).toBe(a);
    expect(wrapTarget([a, b, c], document.body, true)).toBe(c);
  });

  it('leaves moves in the middle to the browser', () => {
    expect(wrapTarget([a, b, c], b, false)).toBeNull();
    expect(wrapTarget([a, b, c], b, true)).toBeNull();
    expect(wrapTarget([], null, false)).toBeNull();
  });
});
