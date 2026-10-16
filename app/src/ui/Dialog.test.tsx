import { fireEvent, screen, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLayerEscape, layerStore } from '../state/layers';
import { expectFocus, expectNoAxeViolations, pressChord, renderUi } from '../test';
import { confirm, Dialog } from './Dialog';
import type { DialogProps } from './Dialog';
import { openMenu } from './Menu';

let stopEscape = () => {};
beforeEach(() => {
  stopEscape = installLayerEscape();
});
afterEach(() => stopEscape());

const settle = () => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => null)));

type HarnessProps = Partial<DialogProps> & { withField?: boolean; onClosed?(): void };

/** A page with a caption button, an opener, and a dialog with Cancel and Delete. */
function Harness({ withField, onClosed = () => {}, ...props }: HarnessProps) {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
    onClosed();
  };
  return (
    <>
      <div data-modal-exempt="">
        <button type="button" tabIndex={-1} aria-label="Close window" />
      </div>
      <main>
        <button type="button" onClick={() => setOpen(true)}>
          Delete notebook
        </button>
        <a href="#elsewhere">Elsewhere</a>
      </main>
      {open && (
        <Dialog
          title="Delete the notebook?"
          description="Its 24 pages move to Trash, and you can restore them for 30 days."
          actions={[
            { id: 'cancel', label: 'Cancel', variant: 'secondary', leastDestructive: true, onPress: close },
            { id: 'delete', label: 'Delete notebook', variant: 'danger', onPress: close },
          ]}
          onDismiss={close}
          {...props}
        >
          {withField && <input aria-label="Notebook name" defaultValue="Biology 101" />}
        </Dialog>
      )}
    </>
  );
}

function openHarness(props: HarnessProps = {}, theme?: 'light' | 'dark') {
  const result = renderUi(<Harness {...props} />, { theme });
  const opener = screen.getByRole('button', { name: 'Delete notebook' });
  opener.focus();
  fireEvent.click(opener);
  return { ...result, opener, dialog: screen.getByRole('dialog', { name: 'Delete the notebook?' }) };
}

describe('dialog rendering', () => {
  it('is an open <dialog> with aria-modal, named by its title and described by its sentence', () => {
    const { dialog } = openHarness();
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('heading', { level: 2, name: 'Delete the notebook?' })).toBeTruthy();
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    const buttons = [...dialog.querySelectorAll('button')].map((button) => button.textContent);
    expect(buttons).toEqual(['Cancel', 'Delete notebook']);
    expect(layerStore.get().map((layer) => [layer.kind, layer.modal])).toEqual([['dialog', true]]);
  });

  it('wraps a long unbroken string instead of scrolling sideways', () => {
    const long = `opennote://page/${'a1b2c3d4'.repeat(40)}`;
    const { dialog } = openHarness({ description: long });
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  });

  it('keeps the palette title for assistive technology only', () => {
    renderUi(<Dialog title="Command palette" size="palette" placement="top" onDismiss={() => {}} />);
    const title = screen.getByRole('heading', { name: 'Command palette' });
    expect(title.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    expect(layerStore.get()[0]?.kind).toBe('palette');
  });

  it('slides the drawer in against the start edge', async () => {
    renderUi(<Dialog title="Notebooks" placement="start" onDismiss={() => {}} />);
    await settle();
    expect(screen.getByRole('dialog', { name: 'Notebooks' }).getBoundingClientRect().left).toBe(0);
    expect(layerStore.get()[0]?.kind).toBe('drawer');
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`passes axe in the ${theme} theme`, async () => {
      openHarness({ withField: true }, theme);
      await settle();
      await expectNoAxeViolations(document.body);
    });
  }
});

describe('dialog focus', () => {
  it('focuses the least destructive action in a confirmation', async () => {
    openHarness({ initialFocus: 'leastDestructive' });
    await expectFocus(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('focuses the first field in a form dialog', async () => {
    openHarness({ withField: true });
    await expectFocus(screen.getByRole('textbox', { name: 'Notebook name' }));
  });

  it('keeps Tab and Shift+Tab inside', async () => {
    const { dialog } = openHarness({ withField: true });
    await pressChord('Shift+Tab');
    await expectFocus(within(dialog).getByRole('button', { name: 'Delete notebook' }));
    await pressChord('Tab');
    await expectFocus(screen.getByRole('textbox', { name: 'Notebook name' }));
    await pressChord('Tab');
    await pressChord('Tab');
    await pressChord('Tab');
    await expectFocus(screen.getByRole('textbox', { name: 'Notebook name' }));
  });

  it('returns focus to the opener when it closes', async () => {
    const { opener, dialog } = openHarness();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await expectFocus(opener);
  });

  it('uses the fallback when the opener is gone', async () => {
    const fallback = () => screen.getByRole('link', { name: 'Elsewhere' });
    const { opener } = openHarness({ returnFocus: fallback });
    opener.remove();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await expectFocus(fallback());
  });

  it('leaves focus where it is when it is already outside the dialog', async () => {
    openHarness();
    const caption = screen.getByRole('button', { name: 'Close window' });
    caption.focus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await expectFocus(caption);
  });
});

describe('dialog modality', () => {
  it('makes everything but the dialog and the caption buttons inert, and undoes it', () => {
    const { container } = openHarness();
    expect(container.querySelector('main')?.inert).toBe(true);
    const caption = screen.getByRole('button', { name: 'Close window' });
    expect(caption.closest('[inert]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(container.querySelector('main')?.inert).toBe(false);
  });

  it('closes with Escape and a click on the scrim', () => {
    const onDismiss = vi.fn();
    renderUi(<Dialog title="Move to" onDismiss={onDismiss} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    const scrim = document.querySelector('[data-placement]:not([data-exiting]) > [aria-hidden="true"]');
    fireEvent.click(scrim as Element);
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('closes only the top layer with Escape: a menu over the dialog closes first', async () => {
    const onDismiss = vi.fn();
    renderUi(<Dialog title="Move to" onDismiss={onDismiss} />);
    void openMenu({ label: 'Choices', items: [{ id: 'a', label: 'First' }], anchor: { x: 10, y: 10 } });
    await screen.findByRole('menu', { name: 'Choices' });
    await pressChord('Escape');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();
    await pressChord('Escape');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('confirm', () => {
  function Opener({ onAnswer }: { onAnswer(answer: boolean): void }) {
    const ref = useRef<HTMLButtonElement>(null);
    const ask = async () =>
      onAnswer(
        await confirm({
          title: 'Delete 3 pages?',
          body: 'You can restore them.',
          confirmLabel: 'Delete',
          danger: true,
        }),
      );
    return (
      <button ref={ref} type="button" onClick={() => void ask()}>
        Delete pages
      </button>
    );
  }

  it('resolves true on confirm, focuses Cancel first, and returns focus', async () => {
    const onAnswer = vi.fn();
    renderUi(<Opener onAnswer={onAnswer} />);
    const opener = screen.getByRole('button', { name: 'Delete pages' });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole('dialog', { name: 'Delete 3 pages?' });
    await expectFocus(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await expect.poll(() => onAnswer.mock.calls).toEqual([[true]]);
    await expectFocus(opener);
  });

  it('resolves false on Escape', async () => {
    const onAnswer = vi.fn();
    renderUi(<Opener onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete pages' }));
    await screen.findByRole('dialog');
    await pressChord('Escape');
    await expect.poll(() => onAnswer.mock.calls).toEqual([[false]]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
