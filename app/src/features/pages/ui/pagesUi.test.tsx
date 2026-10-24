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
import { PrintDialog } from './PrintDialog';
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

describe('SlidePlayer marks', () => {
  it('turns on the laser and ink with keys, draws a mark that fades, and keeps arrow keys for the slides', async () => {
    render(<SlidePlayer source={slideSource()} startBlock={null} close={vi.fn()} />);
    expect(await screen.findByText('1 / 3')).toBeTruthy();
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.dataset.tool).toBe('move');
    await userEvent.keyboard('p');
    expect(canvas.dataset.tool).toBe('ink');
    expect(screen.getByRole('button', { name: /Fading ink/ }).getAttribute('aria-pressed')).toBe('true');
    const box = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: box.left + 20, clientY: box.top + 20, pointerId: 1 }),
    );
    await userEvent.keyboard('l');
    expect(canvas.dataset.tool).toBe('laser');
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText('2 / 3')).toBeTruthy();
    await userEvent.keyboard('m');
    expect(canvas.dataset.tool).toBe('move');
  });
});

function printSource(): PageSource {
  const page = pageOf([textBlock('# Plans\n\nA short page for the printer.')], { title: 'Plans' });
  return { pageId: 'p1', title: 'Plans', notebook: 'Work', section: 'Notes', page, assetUrls: {} };
}

/** The document the preview in this switch's own dialog shows. Dialogs of earlier tests may still be in the page. */
const sheetOf = (control: HTMLElement) => () => {
  let layer: HTMLElement = control;
  while (layer.parentElement && layer.parentElement !== document.body) layer = layer.parentElement;
  const frame = layer.querySelector<HTMLIFrameElement>('iframe[title^="Preview of sheet"]');
  if (!frame) throw new Error('No preview yet.');
  return frame.srcdoc;
};

// checks-disable-next-line modifiability: one test group that shares its fixtures; split it when it grows again
describe('PrintDialog', () => {
  it('shows the page with its title by default, and without it when the switch goes off', async () => {
    render(<PrintDialog source={printSource()} platform={createTestPlatform()} mode="export" close={vi.fn()} />);
    const include = await screen.findByRole('switch', { name: 'Include the page title' });
    const sheet = sheetOf(include);
    expect(include.getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(sheet()).toContain('class="page-title"'), { timeout: 10_000 });
    await userEvent.click(include);
    await waitFor(() => expect(sheet()).not.toContain('class="page-title"'), { timeout: 10_000 });
    expect(sheet()).toContain('class="sheet"');
    expect(localStorage.getItem('opennote.export.pageTitle')).toBe('false');
    await userEvent.click(include);
    await waitFor(() => expect(sheet()).toContain('class="page-title"'), { timeout: 10_000 });
  });

  it('remembers that the title was turned off', async () => {
    localStorage.setItem('opennote.export.pageTitle', 'false');
    render(<PrintDialog source={printSource()} platform={createTestPlatform()} mode="export" close={vi.fn()} />);
    const include = await screen.findByRole('switch', { name: 'Include the page title' });
    expect(include.getAttribute('aria-checked')).toBe('false');
    const sheet = sheetOf(include);
    await waitFor(() => expect(sheet()).toContain('class="sheet"'), { timeout: 10_000 });
    expect(sheet()).not.toContain('class="page-title"');
  });

  it('sends the page to the chosen printer with the copies, both sides, and shrink to fit', async () => {
    const platform = createTestPlatform();
    const submit = vi.spyOn(platform.exports, 'printSubmit');
    const close = vi.fn();
    render(<PrintDialog source={printSource()} platform={platform} mode="print" close={close} />);
    const printer = (await screen.findByLabelText('Printer')) as HTMLSelectElement;
    // Nothing is chosen for the person, not even the default printer.
    expect(printer.value).toBe('');
    await userEvent.selectOptions(printer, 'Hallway Printer');
    // The hallway printer prints on one side only, so the choice of sides goes away.
    expect(screen.queryByRole('radiogroup', { name: 'Sides' })).toBeNull();
    await userEvent.selectOptions(printer, 'Studio Printer');
    await userEvent.click(screen.getByRole('radio', { name: 'Both sides, flip on the long edge' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Shrink to fit the paper' }));
    const copies = screen.getByLabelText('Copies');
    await userEvent.clear(copies);
    await userEvent.type(copies, '3');
    await screen.findByText(/sheet on /, undefined, { timeout: 10_000 });
    await userEvent.click(screen.getByRole('button', { name: 'Print…' }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce(), { timeout: 10_000 });
    expect(submit.mock.calls[0][1]).toEqual({
      printer: 'Studio Printer',
      copies: 3,
      collate: true,
      duplex: 'longEdge',
      fit: 'shrinkToFit',
      grayscale: false,
      title: 'Plans',
    });
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it('says what the paper is and how to leave out sheets', async () => {
    render(<PrintDialog source={printSource()} platform={createTestPlatform()} mode="print" close={vi.fn()} />);
    expect(
      await screen.findByText(/^The paper is .* × .* in, the size set in the page layout/, undefined, {
        timeout: 10_000,
      }),
    ).toBeTruthy();
    expect(screen.getByText('Leave empty to print every sheet, or type a range such as 1-3, 5.')).toBeTruthy();
  });

  it('refuses copies that are not a number and sends nothing', async () => {
    const platform = createTestPlatform();
    const submit = vi.spyOn(platform.exports, 'printSubmit');
    render(<PrintDialog source={printSource()} platform={platform} mode="print" close={vi.fn()} />);
    await userEvent.selectOptions(await screen.findByLabelText('Printer'), 'Studio Printer');
    const copies = await screen.findByLabelText('Copies');
    await userEvent.clear(copies);
    await userEvent.type(copies, '0');
    expect(await screen.findByText('Choose a whole number from 1 to 999.')).toBeTruthy();
    await screen.findByText(/sheet on /, undefined, { timeout: 10_000 });
    await userEvent.click(screen.getByRole('button', { name: 'Print…' }));
    expect(submit).not.toHaveBeenCalled();
  }, 30_000);

  it('keeps Print unavailable until the printers are listed, and sends nothing', async () => {
    const platform = createTestPlatform();
    vi.spyOn(platform.exports, 'printers').mockReturnValue(new Promise(() => undefined));
    const submit = vi.spyOn(platform.exports, 'printSubmit');
    render(<PrintDialog source={printSource()} platform={platform} mode="print" close={vi.fn()} />);
    const print = await screen.findByRole('button', { name: 'Print…' });
    expect(print.getAttribute('aria-disabled')).toBe('true');
    print.click();
    expect(submit).not.toHaveBeenCalled();
  });

  it('keeps Print unavailable until the person chooses a printer, and never sends to the default', async () => {
    const platform = createTestPlatform();
    const submit = vi.spyOn(platform.exports, 'printSubmit');
    render(<PrintDialog source={printSource()} platform={platform} mode="print" close={vi.fn()} />);
    expect(await screen.findByRole('option', { name: 'Choose a printer' })).toBeTruthy();
    await screen.findByText(/sheet on /, undefined, { timeout: 10_000 });
    const print = screen.getByRole('button', { name: 'Print…' });
    expect(print.getAttribute('aria-disabled')).toBe('true');
    print.click();
    expect(submit).not.toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByLabelText('Printer'), 'Hallway Printer');
    expect(print.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('saves through its own Save window for Microsoft Print to PDF, and sends no job', async () => {
    const platform = createTestPlatform();
    vi.spyOn(platform.exports, 'printers').mockResolvedValue([
      { name: 'Studio Printer', default: true, twoSided: true },
      { name: 'Microsoft Print to PDF', default: false, twoSided: false },
    ]);
    const submit = vi.spyOn(platform.exports, 'printSubmit');
    const pickSave = vi.spyOn(platform.exports, 'pickSave');
    const write = vi.spyOn(platform.exports, 'write');
    const close = vi.fn();
    render(<PrintDialog source={printSource()} platform={platform} mode="print" close={close} />);
    await userEvent.selectOptions(await screen.findByLabelText('Printer'), 'Microsoft Print to PDF');
    expect(screen.getByText('OpenNote saves the PDF itself and asks where to put it.')).toBeTruthy();
    expect(screen.queryByLabelText('Copies')).toBeNull();
    await screen.findByText(/sheet on /, undefined, { timeout: 10_000 });
    await userEvent.click(screen.getByRole('button', { name: 'Print…' }));
    await waitFor(() => expect(write).toHaveBeenCalledOnce(), { timeout: 10_000 });
    expect(pickSave.mock.calls[0][0]).toMatchObject({ extension: 'pdf' });
    expect(submit).not.toHaveBeenCalled();
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it('says calmly when the printer turns the job down, and stays open', async () => {
    const platform = createTestPlatform();
    const submit = vi.spyOn(platform.exports, 'printSubmit').mockRejectedValue({
      code: 'spool',
      message: "The printer's driver stopped while printing. Nothing was sent, and your notes are untouched.",
    });
    const close = vi.fn();
    render(<PrintDialog source={printSource()} platform={platform} mode="print" close={close} />);
    await userEvent.selectOptions(await screen.findByLabelText('Printer'), 'Studio Printer');
    await screen.findByText(/sheet on /, undefined, { timeout: 10_000 });
    await userEvent.click(screen.getByRole('button', { name: 'Print…' }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce(), { timeout: 10_000 });
    // The dialog goes back to its options, ready to try again.
    expect(await screen.findByLabelText('Printer', undefined, { timeout: 10_000 })).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
  });

  it('shows no printer fields in Export as PDF', async () => {
    render(<PrintDialog source={printSource()} platform={createTestPlatform()} mode="export" close={vi.fn()} />);
    await screen.findByLabelText('Pages');
    expect(screen.queryByLabelText('Printer')).toBeNull();
  });
});
