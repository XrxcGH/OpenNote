// Page zoom: the commands and Ctrl+wheel zoom the page view's viewport and leave the text size alone, each page
// keeps its zoom, and with page.editor off Phase 2's placeholder page still zooms.
import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { navigate } from '../../app/location';
import { executeCommand } from '../../commands/registry';
import type { NodeId } from '../../services/notes/types';
import { getSettings } from '../../state/settings';
import { announcements, renderApp } from '../../test';
import { shownViewport } from './viewport/shown';
import { steppedPageZoom } from './zoom';

const id = (value: string) => value as NodeId;

function show(pageId: string): void {
  act(() =>
    navigate({ view: 'workspace', notebookId: id('n-biology'), sectionId: id('s-lectures'), pageId: id(pageId) }),
  );
}

async function openPage(pageId: string, editor = true) {
  await renderApp(editor ? {} : { boot: { flagOverrides: { 'page.editor': false } } });
  show(pageId);
  await screen.findByRole('heading', { level: 1, name: 'Mitosis' });
}

async function shownZoom(): Promise<number> {
  await expect.poll(() => shownViewport.get(), { timeout: 10_000 }).toBeTruthy();
  return shownViewport.get()?.camera().zoom ?? Number.NaN;
}

const pageViewport = () => shownViewport.get()?.viewport as HTMLElement;

describe('page zoom', () => {
  it('steps through the command zooms and stops at 25 and 400 percent', () => {
    expect(steppedPageZoom(100, 1)).toBe(110);
    expect(steppedPageZoom(100, -1)).toBe(90);
    expect(steppedPageZoom(400, 1)).toBe(400);
    expect(steppedPageZoom(25, -1)).toBe(25);
    expect(steppedPageZoom(137, 1)).toBe(150);
  });

  it('zooms the viewport on Ctrl+wheel around the pointer, and leaves the text size alone', async () => {
    await openPage('p-mitosis');
    expect(await shownZoom()).toBe(1);
    const rect = pageViewport().getBoundingClientRect();
    const notPrevented = fireEvent.wheel(pageViewport(), {
      ctrlKey: true,
      deltaY: -100,
      clientX: rect.left + 10,
      clientY: rect.top + 10,
    });
    expect(notPrevented).toBe(false);
    expect(await shownZoom()).toBeGreaterThan(1.2);
    expect(getSettings().appearance.textSize).toBe(100);
    await expect.poll(() => announcements().at(-1)).toMatch(/^Page zoom 12\d percent\.$/);
    const scrolled = fireEvent.wheel(pageViewport(), { deltaY: 40 });
    expect(scrolled).toBe(true);
  });

  it('zooms with the commands and keeps each page at its own zoom', async () => {
    await openPage('p-mitosis');
    await shownZoom();
    await executeCommand('page.zoomIn');
    await executeCommand('page.zoomIn');
    expect(await shownZoom()).toBe(1.25);
    expect(announcements().at(-1)).toBe('Page zoom 125 percent.');
    show('p-meiosis');
    await screen.findByRole('heading', { level: 1, name: 'Meiosis' });
    await expect.poll(() => shownViewport.get()?.camera().zoom).toBe(1);
    show('p-mitosis');
    await screen.findByRole('heading', { level: 1, name: 'Mitosis' });
    await expect.poll(() => shownViewport.get()?.camera().zoom).toBe(1.25);
    await executeCommand('page.zoom100');
    expect(await shownZoom()).toBe(1);
  });

  it('zooms Phase 2’s placeholder page while page.editor is off', async () => {
    await openPage('p-mitosis', false);
    const article = screen.getByRole('article');
    fireEvent.wheel(screen.getByRole('main'), { ctrlKey: true, deltaY: -100 });
    expect(article.style.zoom).toBe('1.1');
    await executeCommand('page.zoom100');
    expect(article.style.zoom).toBe('');
    expect(shownViewport.get()).toBeNull();
  });
});
