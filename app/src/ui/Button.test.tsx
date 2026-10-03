import { GearIcon } from '@phosphor-icons/react/dist/csr/Gear';
import { fireEvent, screen } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chord, defineCommand } from '../commands/registry';
import { commands } from '../registries';
import { expectFocus, expectNoAxeViolations, pressChord, renderUi } from '../test';
import { Button, IconButton, pressFrom } from './Button';

let unregister = () => {};
beforeAll(() => {
  unregister = commands.register(
    defineCommand({
      id: 'test.settings',
      title: 'common.close',
      category: 'general',
      keys: [chord('Ctrl+,')],
      run() {},
    }),
  );
});
afterAll(() => unregister());

const settle = () => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => null)));

function Variants({ onClick = () => {} }: { onClick?(): void }) {
  return (
    <main style={{ display: 'flex', gap: 8, padding: 16 }}>
      <Button variant="primary" onClick={onClick}>
        Save
      </Button>
      <Button onClick={onClick}>Choose folder</Button>
      <Button variant="quiet" onClick={onClick}>
        Back to notes
      </Button>
      <Button variant="danger" onClick={onClick}>
        Delete notebook
      </Button>
      <Button variant="danger" data-fill="" onClick={onClick}>
        Delete
      </Button>
      <Button disabled onClick={onClick}>
        Unavailable
      </Button>
      <Button aria-disabled="true" onClick={onClick}>
        Explained
      </Button>
    </main>
  );
}

describe('Button rendering', () => {
  it('is a type="button" button unless it submits', () => {
    renderUi(
      <form>
        <Button>Cancel</Button>
        <Button type="submit" variant="primary">
          Create
        </Button>
      </form>,
    );
    expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('type')).toBe('button');
    expect(screen.getByRole('button', { name: 'Create' }).getAttribute('type')).toBe('submit');
  });

  it('meets the target size for each density', () => {
    renderUi(<Variants />, { density: 'mouse' });
    expect(screen.getByRole('button', { name: 'Save' }).getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
  });

  it('grows to 44 px targets with touch density', () => {
    renderUi(<Variants />, { density: 'touch' });
    document.documentElement.dataset.density = 'touch';
    expect(screen.getByRole('button', { name: 'Save' }).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    delete document.documentElement.dataset.density;
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`passes axe in the ${theme} theme`, async () => {
      renderUi(<Variants />, { theme });
      await expectNoAxeViolations(document.body);
    });
  }
});

describe('Button keyboard', () => {
  it('activates with Enter and Space', async () => {
    const onClick = vi.fn();
    renderUi(<Variants onClick={onClick} />);
    screen.getByRole('button', { name: 'Save' }).focus();
    await pressChord('Enter');
    await pressChord('Space');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('skips a disabled button but keeps an aria-disabled one in the tab order', async () => {
    renderUi(<Variants />);
    screen.getByRole('button', { name: 'Delete' }).focus();
    await pressChord('Tab');
    await expectFocus(screen.getByRole('button', { name: 'Explained' }));
  });
});

describe('IconButton', () => {
  function Toolbar({ onPress = vi.fn(), pressed = false }: { onPress?(): void; pressed?: boolean }) {
    return (
      <main>
        <IconButton label="Settings" icon={GearIcon} command="test.settings" onPress={onPress} pressed={pressed} />
        <IconButton label="More actions" icon={GearIcon} hasPopup="menu" onPress={onPress} />
        <IconButton label="Unavailable" icon={GearIcon} disabled="aria" onPress={onPress} />
      </main>
    );
  }

  it('draws no box around a disabled icon button, as around an enabled one', () => {
    renderUi(
      <>
        <Toolbar />
        <Button disabled>Bordered</Button>
      </>,
    );
    const border = (name: string) => getComputedStyle(screen.getByRole('button', { name })).borderTopColor;
    expect(border('Unavailable')).toBe(border('Settings'));
    // A disabled secondary button keeps a faint border, so the enabled icon button's is the transparent one.
    expect(border('Bordered')).not.toBe(border('Settings'));
  });

  it('is named by its label and gives its command’s shortcut to assistive technology', () => {
    renderUi(<Toolbar />);
    const button = screen.getByRole('button', { name: 'Settings' });
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Control+,');
    expect(screen.getByRole('button', { name: 'More actions' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: 'More actions' }).getAttribute('aria-haspopup')).toBe('menu');
  });

  it('shows "Name (Shortcut)" in its tooltip', async () => {
    renderUi(<Toolbar />);
    await userEvent.hover(screen.getByRole('button', { name: 'Settings' }));
    const tip = await screen.findByRole('tooltip', {}, { timeout: 2000 });
    expect(tip.textContent).toBe('Settings (Ctrl+,)');
  });

  it('shows its pressed state and fills its icon', () => {
    renderUi(<Toolbar pressed />);
    const button = screen.getByRole('button', { name: 'Settings', pressed: true });
    expect(button.querySelector('svg')?.getAttribute('fill')).toBeTruthy();
  });

  it('reports how it was pressed', async () => {
    const onPress = vi.fn();
    renderUi(<Toolbar onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Settings' });
    button.focus();
    await pressChord('Enter');
    await userEvent.click(button);
    expect(onPress.mock.calls.map(([event]) => event.pointerType)).toEqual(['keyboard', 'mouse']);
  });

  it('stays focusable but does nothing when aria-disabled', async () => {
    const onPress = vi.fn();
    renderUi(<Toolbar onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Unavailable' });
    button.focus();
    await pressChord('Enter');
    fireEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('meets 32 px with the mouse and 44 px with touch', () => {
    renderUi(<Toolbar />);
    const button = screen.getByRole('button', { name: 'Settings' });
    expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(32);
    document.documentElement.dataset.density = 'touch';
    expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    delete document.documentElement.dataset.density;
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`passes axe with its tooltip in the ${theme} theme`, async () => {
      renderUi(<Toolbar pressed />, { theme });
      await userEvent.hover(screen.getByRole('button', { name: 'Settings' }));
      await screen.findByRole('tooltip', {}, { timeout: 2000 });
      await settle();
      await expectNoAxeViolations(document.body);
    });
  }
});

describe('pressFrom', () => {
  it('tells keyboard clicks from pointer clicks', () => {
    const click = (detail: number, pointerType = 'mouse') =>
      pressFrom({ detail, nativeEvent: { pointerType } } as unknown as Parameters<typeof pressFrom>[0]);
    expect(click(0)).toEqual({ pointerType: 'keyboard' });
    expect(click(1, 'pen')).toEqual({ pointerType: 'pen' });
    expect(click(1, 'touch')).toEqual({ pointerType: 'touch' });
    expect(click(1, 'mouse')).toEqual({ pointerType: 'mouse' });
  });
});
