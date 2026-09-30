import { fireEvent, screen } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLayerEscape, pushLayer } from '../state/layers';
import { expectNoAxeViolations, pressChord, renderUi } from '../test';
import { Tooltip, tooltipText } from './Tooltip';

let stopEscape = () => {};
beforeEach(() => {
  stopEscape = installLayerEscape();
});
afterEach(() => stopEscape());

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => null)));
const tooltip = () => screen.queryByRole('tooltip');
const findTooltip = () => screen.findByRole('tooltip', {}, { timeout: 2000 });

function renderButtons(theme?: 'light' | 'dark') {
  renderUi(
    <main style={{ display: 'flex', gap: 48, padding: 48 }}>
      <button type="button">Before</button>
      <Tooltip label="Dark mode" shortcut="Ctrl+Shift+D">
        <button type="button" aria-label="Dark mode" aria-keyshortcuts="Control+Shift+D" />
      </Tooltip>
      <Tooltip label="Settings">
        <button type="button" aria-label="Settings" />
      </Tooltip>
    </main>,
    { theme },
  );
  return {
    dark: screen.getByRole('button', { name: 'Dark mode' }),
    settings: screen.getByRole('button', { name: 'Settings' }),
  };
}

describe('tooltip rendering', () => {
  it('reads "Name (Shortcut)", or the name alone', () => {
    expect(tooltipText('Dark mode', 'Ctrl+Shift+D')).toBe('Dark mode (Ctrl+Shift+D)');
    expect(tooltipText('Settings', null)).toBe('Settings');
  });

  it('adds nothing to the layout and shows below its control in the top layer', async () => {
    const { dark } = renderButtons();
    expect(dark.parentElement && getComputedStyle(dark.parentElement).display).toBe('contents');
    await userEvent.hover(dark);
    const tip = await findTooltip();
    expect(tip.matches(':popover-open')).toBe(true);
    await settle();
    expect(tip.getBoundingClientRect().top).toBeGreaterThanOrEqual(dark.getBoundingClientRect().bottom);
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`passes axe in the ${theme} theme`, async () => {
      const { dark } = renderButtons(theme);
      await userEvent.hover(dark);
      await findTooltip();
      await settle();
      await expectNoAxeViolations(document.body);
    });
  }
});

describe('tooltip keyboard', () => {
  it('shows after keyboard focus and hides when focus leaves', async () => {
    renderButtons();
    screen.getByRole('button', { name: 'Before' }).focus();
    await pressChord('Tab');
    expect((await findTooltip()).textContent).toBe('Dark mode (Ctrl+Shift+D)');
    await pressChord('Tab');
    await expect.poll(() => tooltip()?.textContent).toBe('Settings');
    await pressChord('Tab');
    await expect.poll(tooltip).toBeNull();
  });

  it('hides with Escape and closes nothing else', async () => {
    renderButtons();
    const close = vi.fn();
    pushLayer({ id: 'menu', kind: 'popover', modal: false, close });
    screen.getByRole('button', { name: 'Before' }).focus();
    await pressChord('Tab');
    await findTooltip();
    await pressChord('Escape');
    expect(tooltip()).toBeNull();
    expect(close).not.toHaveBeenCalled();
    await pressChord('Escape');
    expect(close).toHaveBeenCalledWith('escape');
  });

  it('doesn’t show for focus from a click', async () => {
    const { settings } = renderButtons();
    await userEvent.click(settings);
    await wait(700);
    expect(tooltip()).toBeNull();
  });
});

describe('tooltip pointer', () => {
  it('waits 500 ms of hover before it shows', async () => {
    const { dark } = renderButtons();
    await wait(400);
    await userEvent.hover(dark);
    await wait(300);
    expect(tooltip()).toBeNull();
    await findTooltip();
  });

  it('stays while the pointer is over the tooltip, and hides after the pointer leaves both', async () => {
    const { dark } = renderButtons();
    await userEvent.hover(dark);
    const tip = await findTooltip();
    await settle();
    await userEvent.hover(tip);
    await wait(300);
    expect(tooltip()).toBe(tip);
    await userEvent.hover(screen.getByRole('button', { name: 'Before' }));
    await expect.poll(tooltip).toBeNull();
  });

  it('shows the next control’s tooltip at once', async () => {
    const { dark, settings } = renderButtons();
    await userEvent.hover(dark);
    await findTooltip();
    await userEvent.hover(settings);
    await expect.poll(() => tooltip()?.textContent, { timeout: 300 }).toBe('Settings');
  });

  it('hides on a press and stays hidden until the pointer leaves', async () => {
    const { dark } = renderButtons();
    await userEvent.hover(dark);
    await findTooltip();
    fireEvent.pointerDown(dark);
    expect(tooltip()).toBeNull();
    await userEvent.hover(dark);
    await wait(700);
    expect(tooltip()).toBeNull();
  });

  it('never shows for touch', async () => {
    const { dark } = renderButtons();
    await userEvent.hover(screen.getByRole('button', { name: 'Before' }));
    fireEvent.pointerOver(dark, { pointerType: 'touch' });
    await wait(700);
    expect(tooltip()).toBeNull();
  });

  it('doesn’t show while the control’s menu is open', async () => {
    renderUi(
      <Tooltip label="More actions">
        <button type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded="true" />
      </Tooltip>,
    );
    await userEvent.hover(screen.getByRole('button', { name: 'More actions' }));
    await wait(700);
    expect(tooltip()).toBeNull();
  });
});

describe('tooltip name and role', () => {
  it('leaves the control’s accessible name as its label', async () => {
    const { dark } = renderButtons();
    await userEvent.hover(dark);
    await findTooltip();
    expect(screen.getByRole('button', { name: 'Dark mode' })).toBe(dark);
    expect(dark.getAttribute('aria-keyshortcuts')).toBe('Control+Shift+D');
    expect(dark.hasAttribute('title')).toBe(false);
  });
});
