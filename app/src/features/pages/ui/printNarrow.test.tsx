// The Print dialog in a narrow window and at large text: nothing scrolls sideways, and touch targets hold (walk 9).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { createTestPlatform } from '../../../test';
import { pageOf, textBlock } from '../testing/build';
import type { PageSource } from '../host/source';
import { PrintDialog } from './PrintDialog';

afterEach(() => {
  cleanup();
  document.documentElement.style.fontSize = '';
  document.documentElement.removeAttribute('data-density');
  return page.viewport(1280, 800);
});

function printSource(): PageSource {
  const doc = pageOf([textBlock('# Plans\n\nA short page.')], { title: 'Plans' });
  return { pageId: 'p1', title: 'Plans', notebook: 'Work', section: 'Notes', page: doc, assetUrls: {} };
}

/** The scrolling elements of the dialog that run wider than they are. */
function sideways(): string[] {
  const dialog = document.querySelector('[role="dialog"]')!;
  return [dialog, ...dialog.querySelectorAll('*')]
    .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible')
    .map((el) => {
      const edge = el.getBoundingClientRect().left + el.clientWidth - parseFloat(getComputedStyle(el).paddingRight);
      const wide = [...el.querySelectorAll('*')]
        .filter((c) => c.getBoundingClientRect().right > edge + 1)
        .map(
          (c) => `${c.tagName}.${(c as HTMLElement).className}:${Math.round(c.getBoundingClientRect().right - edge)}`,
        );
      return `${el.tagName}.${(el as HTMLElement).className} ${el.scrollWidth}>${el.clientWidth} ${wide.slice(0, 6).join(' ')}`;
    });
}

describe('PrintDialog in a small window', () => {
  it.each([
    [406, 1],
    [600, 2],
  ])('does not scroll sideways at %i px with text at %i x (R-T1-C03-1)', async (width, scale) => {
    await page.viewport(width, 800);
    document.documentElement.style.fontSize = `${scale * 100}%`;
    render(<PrintDialog source={printSource()} platform={createTestPlatform()} mode="print" close={vi.fn()} />);
    await screen.findByRole('switch', { name: 'Include the page title' });
    expect(sideways()).toEqual([]);
  });

  it('gives the Printer list a full touch target and clears the buttons (W9-VA-12)', async () => {
    document.documentElement.setAttribute('data-density', 'touch');
    render(<PrintDialog source={printSource()} platform={createTestPlatform()} mode="print" close={vi.fn()} />);
    const printer = await screen.findByLabelText('Printer');
    expect((printer as HTMLElement).offsetHeight).toBeGreaterThanOrEqual(44);
    const actions = screen.getByRole('button', { name: 'Cancel' }).parentElement!;
    expect(getComputedStyle(actions).marginBlockStart).not.toBe('0px');
  });

  it('keeps Print unavailable while the page range is wrong (T2-D02-9)', async () => {
    render(<PrintDialog source={printSource()} platform={createTestPlatform()} mode="export" close={vi.fn()} />);
    const pages = await screen.findByLabelText(/Pages/);
    const { userEvent } = await import('vitest/browser');
    await userEvent.fill(pages, '5-2');
    const go = await screen.findByRole('button', { name: 'Export…' });
    await vi.waitFor(() =>
      expect(go.hasAttribute('disabled') || go.getAttribute('aria-disabled') === 'true').toBe(true),
    );
  });
});
