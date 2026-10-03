import { act, fireEvent, screen } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initFlags } from '../../app/flags';
import type { CaptionState, WindowClient } from '../../platform/types';
import type { WebWindow } from '../../platform/web/window';
import { createTestPlatform, expectNoAxeViolations, renderUi } from '../../test';
import { CaptionButtons, DragRegion, captionLayout } from '.';

function flags(customFrame: boolean, snapLayouts = false) {
  initFlags('dev', { 'shell.customFrame': customFrame, 'window.snapLayouts': snapLayouts });
}

/** A web window whose caption state the test sends, as Rust does for the overlay. */
function testWindow(): { client: WebWindow; sendState(state: CaptionState): void } {
  const base = createTestPlatform().window;
  const listeners = new Set<(state: CaptionState) => void>();
  const client: WebWindow = {
    ...base,
    minimize: vi.fn(),
    close: vi.fn(),
    onCaptionState(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return { client, sendState: (state) => act(() => listeners.forEach((listener) => listener(state))) };
}

/** A title bar row of the mouse density's height, as the title bar gives the buttons. */
function Bar({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', blockSize: 'var(--size-title-bar)' }}>{children}</div>;
}

function renderButtons(client: WindowClient, density?: 'mouse' | 'touch') {
  return renderUi(
    <Bar>
      <DragRegion />
      <CaptionButtons client={client} />
    </Bar>,
    { density },
  );
}

const button = (name: string) => screen.getByRole('button', { name });
const width = (element: Element) => element.getBoundingClientRect().width;

afterEach(() => {
  document.documentElement.style.removeProperty('--zoom');
});

describe('CaptionButtons with the flag off', () => {
  it('renders nothing and gives the window back its native frame', () => {
    flags(false);
    const { client } = testWindow();
    renderButtons(client);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(client.calls.captionLayout).toEqual([null]);
    expect(document.querySelector('[data-app-region]')).toBeNull();
  });
});

describe('CaptionButtons', () => {
  it('names the three buttons as Windows does, outside the tab order, in a named group', async () => {
    flags(true);
    renderButtons(testWindow().client);
    expect(screen.getByRole('group', { name: 'Window controls' })).toBeTruthy();
    for (const name of ['Minimize', 'Maximize', 'Close']) {
      expect(button(name).tabIndex).toBe(-1);
    }
    // Hovering a button shows its name in a tooltip, as the native caption buttons do.
    await userEvent.hover(button('Close'));
    expect((await screen.findByRole('tooltip', {}, { timeout: 2000 })).textContent).toBe('Close');
  });

  it("reports the Maximize button's rectangle in physical pixels", () => {
    flags(true);
    const { client } = testWindow();
    renderButtons(client);
    const labels = { maximize: 'Maximize', restore: 'Restore' };
    const expected = captionLayout(button('Maximize').getBoundingClientRect(), devicePixelRatio, labels, false);
    expect(client.calls.captionLayout.at(-1)).toEqual(expected);
  });

  it('reports again when a resize moves the button, and never repeats a report', () => {
    flags(true);
    const { client } = testWindow();
    const { container } = renderButtons(client);
    const reports = client.calls.captionLayout.length;
    (container.firstElementChild as HTMLElement).style.inlineSize = '600px';
    window.dispatchEvent(new Event('resize'));
    const labels = { maximize: 'Maximize', restore: 'Restore' };
    const moved = captionLayout(button('Maximize').getBoundingClientRect(), devicePixelRatio, labels, false);
    expect(client.calls.captionLayout.slice(reports)).toEqual([moved]);
    window.dispatchEvent(new Event('resize'));
    expect(client.calls.captionLayout).toHaveLength(reports + 1);
  });
});

describe('CaptionButtons actions', () => {
  it('minimizes, maximizes and restores, and closes the window', () => {
    flags(true);
    const { client } = testWindow();
    renderButtons(client);
    fireEvent.click(button('Minimize'));
    expect(client.minimize).toHaveBeenCalledOnce();
    fireEvent.click(button('Maximize'));
    expect(button('Restore').querySelector('[data-glyph]')?.getAttribute('data-glyph')).toBe('restore');
    fireEvent.click(button('Restore'));
    expect(button('Maximize')).toBeTruthy();
    fireEvent.click(button('Close'));
    expect(client.close).toHaveBeenCalledOnce();
  });

  it('lets the Snap Layouts overlay stand in for Maximize and draws its state', () => {
    flags(true, true);
    const { client, sendState } = testWindow();
    renderButtons(client);
    expect(screen.queryByRole('button', { name: 'Maximize' })).toBeNull();
    expect(screen.getAllByRole('button').map((element) => element.getAttribute('aria-label'))).toEqual([
      'Minimize',
      'Close',
    ]);
    expect(client.calls.captionLayout.at(-1)?.snapLayouts).toBe(true);
    const maximize = document.querySelector<HTMLElement>('[data-caption=maximize]');
    sendState({ hovered: true, pressed: false });
    expect(maximize?.dataset.hovered).toBe('true');
    sendState({ hovered: true, pressed: true });
    expect(maximize?.dataset.pressed).toBe('true');
    sendState({ hovered: false, pressed: false });
    expect(maximize?.dataset.hovered).toBeUndefined();
  });
});

describe('CaptionButtons geometry and accessibility', () => {
  it("keeps Windows' 46-DIP buttons, the 138-DIP keep-out, and a 200-DIP drag area at 200% text", () => {
    flags(true);
    renderButtons(testWindow().client);
    const group = screen.getByRole('group');
    const drag = document.querySelector('[data-app-region=drag]');
    expect(width(button('Minimize'))).toBe(46);
    expect(width(group)).toBe(138);
    document.documentElement.style.setProperty('--zoom', '2');
    expect(width(button('Close'))).toBe(23);
    expect(width(group) * 2).toBe(138);
    expect(drag && getComputedStyle(drag).minInlineSize).toBe('100px');
  });

  it('gives touch targets of at least 44 by 44 with touch density', () => {
    flags(true);
    renderButtons(testWindow().client, 'touch');
    const box = button('Close').getBoundingClientRect();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });

  it('has no accessibility violations, with and without the overlay', async () => {
    flags(true);
    const { container } = renderButtons(testWindow().client);
    await expectNoAxeViolations(container);
    flags(true, true);
    await expectNoAxeViolations(container);
  });
});
