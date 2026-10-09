// The Phase 6 dialogs and overlays in a real browser: the gallery moves with the keyboard, the slide player keeps its
// place and leaves on Escape, and the reading panel keeps a choice.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { createTestPlatform } from '../../../test';
import { createMemoryNotesService } from '../../../services/notes/memory';
import type { NodeId } from '../../../services/notes';
import { pageOf, textBlock } from '../testing/build';
import type { PageSource } from '../host/source';
import { readingAids, setReadingAids } from '../live/reading';
import { DEFAULT_READING } from '../reading';
import { Gallery } from './Gallery';
import { ReadingPanel } from './ReadingPanel';
import { SlidePlayer } from './SlidePlayer';

afterEach(() => {
  cleanup();
  setReadingAids(DEFAULT_READING);
  localStorage.clear();
});

async function sectionWithPages() {
  const notes = createMemoryNotesService({ seed: 'sample' });
  const [notebook] = await notes.listNotebooks();
  const sections = await notes.listChildren(notebook.id);
  for (const section of sections) {
    const children = await notes.listChildren(section.id);
    if (children.some((child) => child.kind === 'page')) return { notes, notebook, section, children };
  }
  throw new Error('The sample library has no section with pages.');
}

describe('Gallery', () => {
  it('lists the pages, moves the picked one earlier with Alt and Up, and opens one on Enter', async () => {
    const { notes, notebook, section, children } = await sectionWithPages();
    const pages = children.filter((child) => child.kind === 'page');
    const navigate = vi.fn();
    const close = vi.fn();
    const platform = createTestPlatform();
    render(
      <Gallery
        notes={notes}
        platform={platform}
        notebookId={notebook.id as NodeId}
        sectionId={section.id as NodeId}
        navigate={navigate}
        close={close}
      />,
    );
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(pages.length);
    await userEvent.click(options[1]);
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await waitFor(async () => {
      const moved = (await notes.listChildren(section.id)).filter((child) => child.kind === 'page');
      expect(moved[0].id).toBe(pages[1].id);
    });
    await userEvent.keyboard('{Enter}');
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ view: 'workspace', sectionId: section.id }));
    expect(close).toHaveBeenCalled();
  });

  it('says so when there is no section open', async () => {
    const notes = createMemoryNotesService({ seed: 'empty' });
    const platform = createTestPlatform();
    render(
      <Gallery
        notes={notes}
        platform={platform}
        notebookId={null}
        sectionId={null}
        navigate={vi.fn()}
        close={vi.fn()}
      />,
    );
    expect(await screen.findByText(/Open a section/)).toBeTruthy();
  });
});

function slideSource(): PageSource {
  const page = pageOf([textBlock('# One\n\nFirst.\n\n## Two\n\nSecond.\n\n## Three\n\nThird.')], { title: 'Show' });
  return { pageId: 'p', title: 'Show', notebook: '', section: '', page, assetUrls: {} };
}

describe('SlidePlayer', () => {
  it('starts on the first slide, moves with the arrow keys, and leaves on Escape', async () => {
    const close = vi.fn();
    render(<SlidePlayer source={slideSource()} startBlock={null} close={close} />);
    expect(await screen.findByText('1 / 3')).toBeTruthy();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText('2 / 3')).toBeTruthy();
    await userEvent.keyboard('{End}');
    expect(screen.getByText('3 / 3')).toBeTruthy();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText('3 / 3')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(close).toHaveBeenCalled();
  });

  it('stays on "1 / 1" when an empty page is moved forward', async () => {
    const page = pageOf([], { title: 'Empty' });
    const source = { pageId: 'p', title: 'Empty', notebook: '', section: '', page, assetUrls: {} };
    render(<SlidePlayer source={source} startBlock={null} close={vi.fn()} />);
    expect(await screen.findByText('1 / 1')).toBeTruthy();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText('1 / 1')).toBeTruthy();
  });

  it('names the slide in the frame for a screen reader', async () => {
    render(<SlidePlayer source={slideSource()} startBlock={null} close={vi.fn()} />);
    expect(await screen.findByTitle('Slide 1 of 3')).toBeTruthy();
  });
});

describe('ReadingPanel', () => {
  it('keeps the tint on this device', async () => {
    render(<ReadingPanel close={vi.fn()} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Sepia' }));
    expect(readingAids.get().tint).toBe('sepia');
    expect(localStorage.getItem('opennote.readingAids')).toContain('sepia');
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(readingAids.get().tint).toBe('none');
  });
});
