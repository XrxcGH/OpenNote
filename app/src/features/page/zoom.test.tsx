import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { navigate } from '../../app/location';
import { executeCommand } from '../../commands/registry';
import type { NodeId } from '../../services/notes/types';
import { getSettings } from '../../state/settings';
import { announcements, renderApp } from '../../test';
import { steppedPageZoom } from './zoom';

const id = (value: string) => value as NodeId;

async function openPage(pageId: string) {
  await renderApp();
  act(() =>
    navigate({ view: 'workspace', notebookId: id('n-biology'), sectionId: id('s-lectures'), pageId: id(pageId) }),
  );
  return screen.findByRole('heading', { level: 1, name: 'Mitosis' });
}

const pageArticle = () => screen.getByRole('article');

describe('page zoom', () => {
  it('steps through the list and stops at the ends', () => {
    expect(steppedPageZoom(100, 1)).toBe(110);
    expect(steppedPageZoom(100, -1)).toBe(90);
    expect(steppedPageZoom(300, 1)).toBe(300);
    expect(steppedPageZoom(50, -1)).toBe(50);
    expect(steppedPageZoom(137, 1)).toBe(110);
  });

  it('zooms the page on Ctrl+wheel over the page region, and leaves the text size alone', async () => {
    const heading = await openPage('p-mitosis');
    const main = screen.getByRole('main');
    expect(pageArticle().style.zoom).toBe('');
    const notPrevented = fireEvent.wheel(main, { ctrlKey: true, deltaY: -100 });
    expect(notPrevented).toBe(false);
    expect(pageArticle().style.zoom).toBe('1.1');
    expect(getSettings().appearance.textSize).toBe(100);
    expect(announcements().at(-1)).toBe('Page zoom 110 percent.');
    fireEvent.wheel(heading, { ctrlKey: true, deltaY: 100 });
    fireEvent.wheel(heading, { ctrlKey: true, deltaY: 100 });
    expect(pageArticle().style.zoom).toBe('0.9');
    expect(getSettings().appearance.textSize).toBe(100);
  });

  it('adds up small pinch steps, and ignores the wheel without Ctrl', async () => {
    await openPage('p-mitosis');
    const main = screen.getByRole('main');
    for (let i = 0; i < 3; i += 1) fireEvent.wheel(main, { ctrlKey: true, deltaY: -40 });
    expect(pageArticle().style.zoom).toBe('1.1');
    const scrolled = fireEvent.wheel(main, { deltaY: -400 });
    expect(scrolled).toBe(true);
    expect(pageArticle().style.zoom).toBe('1.1');
  });

  it('keeps each page at its own zoom, and the commands zoom the open page', async () => {
    await openPage('p-mitosis');
    await executeCommand('page.zoomIn');
    await executeCommand('page.zoomIn');
    expect(pageArticle().style.zoom).toBe('1.25');
    act(() =>
      navigate({
        view: 'workspace',
        notebookId: id('n-biology'),
        sectionId: id('s-lectures'),
        pageId: id('p-meiosis'),
      }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Meiosis' });
    expect(pageArticle().style.zoom).toBe('');
    act(() =>
      navigate({
        view: 'workspace',
        notebookId: id('n-biology'),
        sectionId: id('s-lectures'),
        pageId: id('p-mitosis'),
      }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Mitosis' });
    expect(pageArticle().style.zoom).toBe('1.25');
    await executeCommand('page.zoomReset');
    expect(pageArticle().style.zoom).toBe('');
  });
});
