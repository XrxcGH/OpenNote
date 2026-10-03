// @vitest-environment node
// The import flow against the web fake and the in-memory notes service: choose, check, review, import, undo.

import { describe, expect, it } from 'vitest';
import { createWebInterop } from '../../platform/web/interop';
import { createMemoryNotesService } from '../../services/notes/memory';
import { createImportFlow } from './importFlow';
import type { ImportState } from './importFlow';

function setup() {
  const interop = createWebInterop();
  const notes = createMemoryNotesService({ seed: 'empty' });
  const announced: string[] = [];
  const flow = createImportFlow({ interop, notes, announce: (text) => void announced.push(text) });
  const detach = flow.attach();
  return { interop, notes, flow, announced, detach };
}

const until = async (flow: ReturnType<typeof setup>['flow'], step: ImportState['step']) => {
  for (let i = 0; i < 400 && flow.state.get().step !== step; i += 1) await new Promise((r) => setTimeout(r, 5));
  expect(flow.state.get().step).toBe(step);
};

describe('checking a source', () => {
  it('checks a file and shows the review without adding anything', async () => {
    const { flow, interop, notes, detach } = setup();
    await flow.chooseFile();
    const state = flow.state.get();
    expect(state.step).toBe('review');
    if (state.step !== 'review') return;
    expect(state.preview.pages).toBe(5);
    expect(state.preview.losses.length).toBeGreaterThan(0);
    expect(interop.log.previews).toEqual(['C:\\Users\\Sample\\Exports\\Recipes.enex']);
    expect(interop.log.imports).toEqual([]);
    expect(await notes.listNotebooks()).toHaveLength(0);
    detach();
  });

  it('checks the Sticky Notes database of this PC without browsing', async () => {
    const { flow, interop, detach } = setup();
    expect((await flow.localSources()).stickyNotes).toBeNull();
    interop.setStickyNotes('C:/Users/Sample/Packages/StickyNotes/LocalState/plum.sqlite');
    const sources = await flow.localSources();
    expect(sources.stickyNotes).toContain('plum.sqlite');
    await flow.chooseLocal(sources.stickyNotes ?? '');
    expect(flow.state.get().step).toBe('review');
    expect(interop.log.picks).toEqual([]);
    detach();
  });

  it('stops at a source it cannot import and shows what to do instead', async () => {
    const { flow, interop, detach } = setup();
    interop.pick = () => Promise.resolve('C:\\Notes\\Work.one');
    await flow.chooseFile();
    const state = flow.state.get();
    expect(state.step).toBe('unsupported');
    if (state.step === 'unsupported') expect(state.detected.advice).toContain('Export');
    expect(interop.log.previews).toEqual([]);
    detach();
  });
});

describe('importing a source', () => {
  it('adds the notebook, its sections, and its pages in order, and tells the host which page is which', async () => {
    const { flow, interop, notes, detach } = setup();
    await flow.chooseFile();
    await flow.start();
    const state = flow.state.get();
    expect(state.step).toBe('done');
    if (state.step !== 'done') return;
    const sections = await notes.listChildren(state.notebook.id);
    expect(sections.map((node) => node.title)).toEqual(['Recipes', 'Travel']);
    const pages = await notes.listChildren(sections[0].id);
    expect(pages.map((node) => node.title)).toEqual(['Sourdough', 'Lentil soup', 'Flatbread']);
    const adopted = interop.log.adopted[0];
    expect(adopted.pages).toHaveLength(5);
    expect(adopted.pages[0]).toEqual({ ui: pages[0].id, core: 'core-1-1' });
    expect(state.firstPage?.id).toBe(pages[0].id);
    detach();
  });

  it('adds an Import report section when asked', async () => {
    const { flow, notes, detach } = setup();
    await flow.chooseFile();
    flow.setReportPage(true);
    await flow.start();
    const state = flow.state.get();
    expect(state.step).toBe('done');
    if (state.step !== 'done') return;
    const sections = await notes.listChildren(state.notebook.id);
    expect(sections.map((node) => node.title)).toContain('Import report');
    detach();
  });

  it('goes back to choosing, with a note, when the check is canceled', async () => {
    const { flow, interop, detach } = setup();
    const picked = flow.chooseFile();
    await until(flow, 'checking');
    flow.cancel();
    await picked;
    expect(flow.state.get()).toEqual({ step: 'choose', canceled: true });
    expect(interop.log.canceled).toHaveLength(1);
    detach();
  });

  it('adds nothing when the import is canceled', async () => {
    const { flow, interop, notes, announced, detach } = setup();
    await flow.chooseFile();
    const running = flow.start();
    await until(flow, 'importing');
    flow.cancel();
    await running;
    expect(flow.state.get()).toEqual({ step: 'choose', canceled: true });
    expect(announced).toContain('Import canceled. Nothing was added.');
    expect(interop.log.adopted).toEqual([]);
    expect(await notes.listNotebooks()).toHaveLength(0);
    detach();
  });

  it('moves the new notebook to the Trash on Undo', async () => {
    const { flow, notes, detach } = setup();
    await flow.chooseFile();
    await flow.start();
    await flow.undo();
    const state = flow.state.get();
    expect(state.step === 'done' && state.undone).toBe(true);
    expect(await notes.listNotebooks()).toHaveLength(0);
    expect(await notes.listTrash()).toHaveLength(1);
    detach();
  });

  it('keeps the review after a failure, so Try again goes back to it', async () => {
    const { flow, interop, detach } = setup();
    await flow.chooseFile();
    interop.importFrom = () => Promise.reject({ code: 'io', message: 'disk full' });
    await flow.start();
    expect(flow.state.get().step).toBe('failed');
    flow.retry();
    expect(flow.state.get().step).toBe('review');
    detach();
  });

  it('cancels a running job when the dialog goes away', async () => {
    const { flow, interop, detach } = setup();
    void flow.chooseFile();
    await until(flow, 'checking');
    detach();
    expect(interop.log.canceled).toHaveLength(1);
  });
});
