import { act, fireEvent, screen } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pushLayer } from '../state/layers';
import { announcements, expectNoAxeViolations, renderUi } from '../test';
import { Announcer } from './announce';
import { showToast, Toaster } from './toast';
import type { ToastSpec } from './toast';

function Page() {
  return (
    <>
      <main>
        <button type="button">Page button</button>
      </main>
      <Toaster />
      <Announcer />
    </>
  );
}

const region = () => screen.getByRole('status', { name: 'Notifications' });
const toastText = () => region().textContent ?? '';
const cardOf = (text: string) => screen.getByText(text).parentElement as HTMLElement;
const close = () => act(() => screen.getByRole('button', { name: 'Close' }).click());
const settle = () => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => null)));

function show(spec: ToastSpec) {
  let handle!: ReturnType<typeof showToast>;
  act(() => {
    handle = showToast(spec);
  });
  return handle;
}

describe('toasts over time', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] }));
  afterEach(() => vi.useRealTimers());
  const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  it('closes a toast after 6 seconds', () => {
    renderUi(<Page />);
    show({ message: 'Notebook created.' });
    expect(toastText()).toContain('Notebook created.');
    advance(5999);
    expect(toastText()).toContain('Notebook created.');
    advance(1);
    expect(toastText()).toBe('');
  });

  it('keeps a toast with an action longer, then closes it', () => {
    renderUi(<Page />);
    show({ message: 'Moved to Trash.', action: { label: 'Undo', run() {} } });
    advance(8000);
    expect(toastText()).toContain('Moved to Trash.');
    advance(5000);
    expect(toastText()).toBe('');
  });

  it('waits while the pointer is on the toast, then runs out the rest of its time', () => {
    renderUi(<Page />);
    show({ message: 'Saved.' });
    advance(4000);
    fireEvent.pointerEnter(cardOf('Saved.'));
    advance(10_000);
    expect(toastText()).toContain('Saved.');
    fireEvent.pointerLeave(cardOf('Saved.'));
    advance(1999);
    expect(toastText()).toContain('Saved.');
    advance(1);
    expect(toastText()).toBe('');
  });

  it('waits while focus is inside the toast', () => {
    renderUi(<Page />);
    show({ message: 'Saved.' });
    act(() => screen.getByRole('button', { name: 'Close' }).focus());
    advance(20_000);
    expect(toastText()).toContain('Saved.');
    act(() => screen.getByRole('button', { name: 'Page button' }).focus());
    advance(6000);
    expect(toastText()).toBe('');
  });

  it('starts the full time again when a toast with the same id replaces it', () => {
    renderUi(<Page />);
    show({ id: 'erase', message: 'Erased 1 stroke.' });
    advance(5000);
    show({ id: 'erase', message: 'Erased 4 strokes.' });
    advance(5000);
    expect(toastText()).toContain('Erased 4 strokes.');
    advance(1000);
    expect(toastText()).toBe('');
  });
});

describe('the toast queue', () => {
  it('shows one toast at a time, and the next when it goes', () => {
    renderUi(<Page />);
    const first = show({ message: 'First.' });
    show({ message: 'Second.' });
    expect(toastText()).toContain('First.');
    expect(toastText()).not.toContain('Second.');
    act(() => first.dismiss());
    expect(toastText()).toContain('Second.');
  });

  it('replaces the showing toast that has the same id, and does not queue another', () => {
    renderUi(<Page />);
    show({ id: 'erase', message: 'Erased 1 stroke.' });
    show({ id: 'erase', message: 'Erased 4 strokes.' });
    expect(toastText()).toContain('Erased 4 strokes.');
    expect(toastText()).not.toContain('Erased 1 stroke.');
    close();
    expect(toastText()).toBe('');
  });

  it('replaces a waiting toast that has the same id', () => {
    renderUi(<Page />);
    const first = show({ message: 'First.' });
    show({ id: 'erase', message: 'Erased 1 stroke.' });
    show({ id: 'erase', message: 'Erased 4 strokes.' });
    act(() => first.dismiss());
    expect(toastText()).toContain('Erased 4 strokes.');
    close();
    expect(toastText()).toBe('');
  });

  it('gives every call for one id a handle that dismisses that toast', () => {
    renderUi(<Page />);
    const first = show({ id: 'erase', message: 'Erased 1 stroke.' });
    show({ id: 'erase', message: 'Erased 4 strokes.' });
    act(() => first.dismiss());
    expect(toastText()).toBe('');
  });

  it('shows a new toast for an id whose toast has gone', () => {
    renderUi(<Page />);
    const first = show({ id: 'erase', message: 'Erased 1 stroke.' });
    act(() => first.dismiss());
    show({ id: 'erase', message: 'Erased 2 strokes.' });
    expect(toastText()).toContain('Erased 2 strokes.');
  });
});

describe('toast announcements', () => {
  it('is an always-present status landmark named Notifications', () => {
    renderUi(<Page />);
    expect(region().getAttribute('data-region')).toBe('notifications');
    expect(toastText()).toBe('');
  });

  it('announces a toast once, through the Notifications region alone', () => {
    renderUi(<Page />);
    show({ message: 'Notebook created.' });
    expect(announcements()).toEqual(['Notebook created.']);
    const live = [...document.querySelectorAll('[aria-live]:not([role])')];
    expect(live.map((node) => node.textContent)).toEqual(['', '']);
  });

  it('speaks the announce text instead of the message, and hides the message from assistive technology', () => {
    renderUi(<Page />);
    show({ message: 'Moved “Mitosis” to Trash.', announce: 'Moved “Mitosis” to Trash. Press Ctrl+Z to undo.' });
    expect(announcements()).toEqual(['Moved “Mitosis” to Trash. Press Ctrl+Z to undo.']);
    expect(screen.getByText('Moved “Mitosis” to Trash.').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('Moved “Mitosis” to Trash. Press Ctrl+Z to undo.')).toBeTruthy();
  });

  it('goes through the announcer while a dialog makes the region inert', () => {
    renderUi(<Page />);
    const pop = pushLayer({ id: 'd', kind: 'dialog', modal: true, close() {} });
    show({ message: 'Couldn’t save.' });
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('Couldn’t save.');
    expect(announcements()).toEqual(['Couldn’t save.']);
    pop();
  });
});

describe('toasts and focus', () => {
  it('never takes focus, even when pressed', async () => {
    const run = vi.fn();
    renderUi(<Page />);
    const page = screen.getByRole('button', { name: 'Page button' });
    page.focus();
    show({ message: 'Moved to Trash.', action: { label: 'Undo', run } });
    expect(document.activeElement).toBe(page);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(toastText()).toBe('');
    expect(document.activeElement).toBe(page);
  });

  it('dismisses on Escape when focus is in it, and gives focus back', async () => {
    renderUi(<Page />);
    const page = screen.getByRole('button', { name: 'Page button' });
    page.focus();
    show({ message: 'Moved to Trash.', action: { label: 'Undo', run() {} } });
    screen.getByRole('button', { name: 'Undo' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(toastText()).toBe('');
    expect(document.activeElement).toBe(page);
  });

  it('gives focus back when the toast goes while focus is in it', () => {
    renderUi(<Page />);
    const page = screen.getByRole('button', { name: 'Page button' });
    page.focus();
    const handle = show({ message: 'Saved.' });
    screen.getByRole('button', { name: 'Close' }).focus();
    act(() => handle.dismiss());
    expect(document.activeElement).toBe(page);
  });

  it('keeps --toast-height as tall as the toast and the gap under it', async () => {
    renderUi(<Page />);
    const handle = show({ message: 'Saved.' });
    const height = () => parseFloat(document.documentElement.style.getPropertyValue('--toast-height'));
    await expect.poll(height).toBeGreaterThan(cardOf('Saved.').getBoundingClientRect().height);
    act(() => handle.dismiss());
    expect(document.documentElement.style.getPropertyValue('--toast-height')).toBe('');
  });

  it('never covers the element that has focus', async () => {
    // The button starts half below the window's bottom edge, so focusing it scrolls it into view.
    renderUi(
      <>
        <main>
          <div style={{ blockSize: window.innerHeight - 20 }} />
          <button type="button">Low button</button>
          <div style={{ blockSize: 1500 }} />
        </main>
        <Toaster />
      </>,
    );
    show({ message: 'Moved to Trash.', action: { label: 'Undo', run() {} } });
    const low = screen.getByRole('button', { name: 'Low button' });
    await expect.poll(() => document.documentElement.style.getPropertyValue('--toast-height')).not.toBe('');
    low.focus();
    const toast = screen.getByText('Moved to Trash.').parentElement as HTMLElement;
    await expect.poll(() => window.scrollY).toBeGreaterThan(0);
    expect(low.getBoundingClientRect().bottom).toBeLessThanOrEqual(toast.getBoundingClientRect().top);
    const box = low.getBoundingClientRect();
    expect(document.elementFromPoint(box.x + 4, box.y + 4)).toBe(low);
  });
});

describe('toast rendering', () => {
  it('sits fixed at the bottom and ignores the pointer outside the toast', () => {
    renderUi(<Page />);
    show({ message: 'Saved.' });
    const style = getComputedStyle(region());
    expect(style.position).toBe('fixed');
    expect(style.pointerEvents).toBe('none');
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`passes axe in the ${theme} theme, with an action and a danger toast`, async () => {
      renderUi(<Page />, { theme });
      show({ message: 'Couldn’t move the page.', tone: 'danger', action: { label: 'Try again', run() {} } });
      await settle();
      await expectNoAxeViolations(document.body);
    });
  }
});
