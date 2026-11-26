// Reading mode (A2-29): the lock marks the shown page read-only, takes editing away from its title, says so, and
// gives everything back when it is lifted or the page goes.
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp } from '../../../test';
import type { MountedPage } from '../mount';
import { attachLock, toggleReadingLock } from './lock';
import { readingLock } from './stores';

function fakePage(flag: boolean) {
  const viewport = document.createElement('div');
  const title = document.createElement('div');
  title.setAttribute('contenteditable', 'plaintext-only');
  document.body.append(viewport, title);
  const mounted = {
    host: { flag: () => flag },
    viewport: { viewport },
    layer: { blocks: () => [] },
    pool: { editor: () => null },
    page: { readOnly: false },
    title: { textbox: title },
  } as unknown as MountedPage;
  return { mounted, viewport, title };
}

afterEach(() => {
  readingLock.set(false);
  document.querySelectorAll('body > div:not([id])').forEach((node) => node.childElementCount === 0 && node.remove());
});

describe('reading mode', () => {
  it('locks the shown page and its title, and unlocks them again', async () => {
    await renderApp();
    const { mounted, viewport, title } = fakePage(true);
    const stop = attachLock(mounted);
    toggleReadingLock();
    expect(viewport.hasAttribute('data-reading-lock')).toBe(true);
    expect(title.getAttribute('contenteditable')).toBe('false');
    toggleReadingLock();
    expect(viewport.hasAttribute('data-reading-lock')).toBe(false);
    expect(title.getAttribute('contenteditable')).toBe('plaintext-only');
    toggleReadingLock(true);
    stop();
    expect(viewport.hasAttribute('data-reading-lock')).toBe(false);
    expect(readingLock.get()).toBe(false);
  });

  it('keeps the focus on the page when the editor that had it is turned off, so the lock chord still works', async () => {
    await renderApp();
    const { mounted, viewport, title } = fakePage(true);
    viewport.tabIndex = -1;
    const stop = attachLock(mounted);
    title.focus();
    expect(document.activeElement).toBe(title);
    toggleReadingLock(true);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(document.activeElement).toBe(viewport);
    stop();
  });

  it('does nothing while its flag is off', async () => {
    await renderApp();
    const { mounted, viewport } = fakePage(false);
    attachLock(mounted)();
    toggleReadingLock(true);
    expect(viewport.hasAttribute('data-reading-lock')).toBe(false);
  });
});
