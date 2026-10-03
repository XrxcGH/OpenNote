import { fireEvent, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { userEvent } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installLayerEscape, layerStore } from '../state/layers';
import { expectFocus, expectNoAxeViolations, pressChord, renderUi } from '../test';
import { Button } from './Button';
import { openMenu } from './Menu';
import { Popover, useHoverOpen } from './Popover';

let stopEscape = () => {};
beforeEach(() => {
  stopEscape = installLayerEscape();
});
afterEach(() => stopEscape());

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => null)));
const popover = () => screen.queryByRole('dialog', { name: 'Release notes' });

function Chip({ hover = false, placement }: { hover?: boolean; placement?: 'block-end' | 'inline-end' }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useHoverOpen(anchor, hover ? setOpen : () => {});
  return (
    <main style={{ padding: 48 }}>
      <header style={{ display: 'flex', gap: 16 }}>
        <button ref={anchor} type="button" aria-expanded={open} onClick={() => setOpen(true)}>
          Update ready
        </button>
        <Popover anchor={anchor} label="Release notes" open={open} onClose={() => setOpen(false)} placement={placement}>
          <p>Faster start-up and a new dark theme.</p>
          <Button variant="primary">Restart to update</Button>
        </Popover>
        <button type="button">Settings</button>
      </header>
    </main>
  );
}

async function openChip(options: { placement?: 'block-end' | 'inline-end'; theme?: 'light' | 'dark' } = {}) {
  renderUi(<Chip placement={options.placement} />, { theme: options.theme });
  const chip = screen.getByRole('button', { name: 'Update ready' });
  chip.focus();
  await pressChord('Enter');
  const surface = await screen.findByRole('dialog', { name: 'Release notes' });
  return { chip, surface };
}

describe('popover rendering', () => {
  it('is a named, non-modal dialog in the top layer below its control', async () => {
    const { chip, surface } = await openChip();
    expect(surface.getAttribute('aria-modal')).toBeNull();
    expect(surface.matches(':popover-open')).toBe(true);
    expect(layerStore.get().map((layer) => [layer.kind, layer.modal])).toEqual([['popover', false]]);
    await settle();
    expect(surface.getBoundingClientRect().top).toBeGreaterThanOrEqual(chip.getBoundingClientRect().bottom);
  });

  it('opens at the control’s end side', async () => {
    const { chip, surface } = await openChip({ placement: 'inline-end' });
    await settle();
    expect(surface.getBoundingClientRect().left).toBeGreaterThanOrEqual(chip.getBoundingClientRect().right);
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`passes axe in the ${theme} theme`, async () => {
      await openChip({ theme });
      await settle();
      await expectNoAxeViolations(document.body);
    });
  }
});

describe('popover keyboard', () => {
  it('keeps focus on its control, and Tab moves into it', async () => {
    const { chip } = await openChip();
    await expectFocus(chip);
    await pressChord('Tab');
    await expectFocus(screen.getByRole('button', { name: 'Restart to update' }));
  });

  it('closes with Escape and returns focus to its control', async () => {
    const { chip } = await openChip();
    await pressChord('Tab');
    await pressChord('Escape');
    expect(popover()).toBeNull();
    await expectFocus(chip);
  });

  it('closes when focus moves elsewhere', async () => {
    await openChip();
    await pressChord('Tab');
    await pressChord('Tab');
    await expectFocus(screen.getByRole('button', { name: 'Settings' }));
    expect(popover()).toBeNull();
  });

  it('closes only its menu with Escape when a menu opened from it is on top', async () => {
    await openChip();
    await pressChord('Tab');
    void openMenu({ label: 'Choices', items: [{ id: 'later', label: 'Remind me later' }], anchor: { x: 10, y: 10 } });
    await screen.findByRole('menu');
    await pressChord('Escape');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(popover()).not.toBeNull();
  });
});

describe('popover pointer', () => {
  it('closes on a press outside it and its control, but not inside', async () => {
    const { surface } = await openChip();
    fireEvent.pointerDown(surface);
    expect(popover()).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(popover()).toBeNull();
  });

  it('opens on hover after the delay and closes after the pointer leaves both', async () => {
    renderUi(<Chip hover />);
    const chip = screen.getByRole('button', { name: 'Update ready' });
    await userEvent.hover(chip);
    await wait(250);
    expect(popover()).toBeNull();
    const surface = await screen.findByRole('dialog', { name: 'Release notes' }, { timeout: 2000 });
    await settle();
    await userEvent.hover(surface);
    await wait(500);
    expect(popover()).not.toBeNull();
    await userEvent.hover(screen.getByRole('button', { name: 'Settings' }));
    await expect.poll(popover, { timeout: 2000 }).toBeNull();
  });

  it('never opens on hover for touch, and a press keeps it open', async () => {
    renderUi(<Chip hover />);
    const chip = screen.getByRole('button', { name: 'Update ready' });
    fireEvent.pointerEnter(chip, { pointerType: 'touch' });
    await wait(700);
    expect(popover()).toBeNull();
    await userEvent.click(chip);
    await screen.findByRole('dialog', { name: 'Release notes' });
    await userEvent.hover(screen.getByRole('button', { name: 'Settings' }));
    await wait(500);
    expect(popover()).not.toBeNull();
  });
});
