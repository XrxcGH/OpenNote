// @vitest-environment node
// What an export covers (page, section, notebook) and the export flow, on the sample library and the web fake.

import { describe, expect, it } from 'vitest';
import { createWebInterop } from '../../platform/web/interop';
import { createMemoryNotesService } from '../../services/notes/memory';
import type { NodeId } from '../../services/notes/types';
import { createExportFlow } from './exportFlow';
import type { ExportState } from './exportFlow';
import { collectRequest, resolveTarget } from './exportTarget';

const id = (value: string) => value as NodeId;

async function setup(start: string) {
  const interop = createWebInterop();
  const notes = createMemoryNotesService({ seed: 'sample' });
  const target = await resolveTarget(notes, id(start));
  if (!target) throw new Error('No target');
  const announced: string[] = [];
  const flow = createExportFlow({ interop, notes, target, announce: (text) => void announced.push(text) });
  const detach = flow.attach();
  return { interop, notes, target, flow, announced, detach };
}

const until = async (flow: { state: { get(): ExportState } }, step: ExportState['step']) => {
  for (let i = 0; i < 400 && flow.state.get().step !== step; i += 1) await new Promise((r) => setTimeout(r, 5));
  expect(flow.state.get().step).toBe(step);
};

describe('what an export covers', () => {
  it('offers the page, its section, and its notebook, starting from the page', async () => {
    const { target } = await setup('p-mitosis');
    expect(target.choices.map((choice) => [choice.scope, choice.node.title])).toEqual([
      ['page', 'Mitosis'],
      ['section', 'Lectures'],
      ['notebook', 'Biology 101'],
    ]);
    expect(target.initial).toBe('page');
  });

  it('offers a section and its notebook from a section, and just the notebook from a notebook', async () => {
    expect((await setup('s-lectures')).target.choices.map((choice) => choice.scope)).toEqual(['section', 'notebook']);
    const notebook = await setup('n-biology');
    expect(notebook.target.choices.map((choice) => choice.scope)).toEqual(['notebook']);
    expect(notebook.target.initial).toBe('notebook');
  });

  it('sends every section of a notebook, with section groups folded into the section title', async () => {
    const { notes, target } = await setup('n-biology');
    const request = await collectRequest(notes, target, 'notebook');
    expect(request.title).toBe('Biology 101');
    expect(request.sections.map((section) => section.title)).toEqual([
      'Lectures',
      'Labs',
      'Exam prep - Midterm',
      'Exam prep - Final',
    ]);
    const lectures = request.sections[0].pages;
    expect(lectures.map((page) => page.title)).toContain('Mitosis');
    expect(lectures[0]).toMatchObject({ level: 0 });
  });

  it('sends one section, or one page inside its section', async () => {
    const { notes, target } = await setup('p-mitosis');
    const section = await collectRequest(notes, target, 'section');
    expect(section.sections).toHaveLength(1);
    expect(section.sections[0].title).toBe('Lectures');
    const page = await collectRequest(notes, target, 'page');
    expect(page.scope).toBe('page');
    expect(page.sections[0].pages).toEqual([{ ui: 'p-mitosis', title: 'Mitosis', level: 0 }]);
  });
});

describe('exporting', () => {
  it('asks for a folder when Export is pressed without one, then exports and shows the summary', async () => {
    const { flow, interop, detach } = await setup('s-lectures');
    flow.setFormat('docx');
    await flow.start();
    const state = flow.state.get();
    expect(state.step).toBe('done');
    expect(interop.log.picks).toEqual([{ kind: 'folder' }]);
    expect(interop.log.exports).toHaveLength(1);
    expect(interop.log.exports[0]).toMatchObject({
      format: 'docx',
      scope: 'section',
      folder: 'C:\\Users\\Sample\\Documents',
    });
    if (state.step === 'done') expect(state.result.files).toBe(1);
    detach();
  });

  it('stays on the options when the person closes the folder picker', async () => {
    const { flow, interop, detach } = await setup('s-lectures');
    interop.pick = () => Promise.resolve(null);
    await flow.start();
    expect(flow.state.get().step).toBe('options');
    expect(interop.log.exports).toEqual([]);
    detach();
  });

  it('returns to the options with nothing kept when canceled', async () => {
    const { flow, announced, detach } = await setup('s-lectures');
    await flow.chooseFolder();
    const running = flow.start();
    await until(flow, 'exporting');
    flow.cancel();
    await running;
    expect(flow.state.get().step).toBe('options');
    expect(announced).toContain('Export canceled. Nothing was kept.');
    detach();
  });

  it('says so when a section has no pages', async () => {
    const { flow, detach } = await setup('s-final');
    await flow.chooseFolder();
    await flow.start();
    expect(flow.state.get().step).toBe('empty');
    flow.back();
    expect(flow.state.get().step).toBe('options');
    detach();
  });

  it('shows the error and keeps the choices when the host refuses', async () => {
    const { flow, interop, detach } = await setup('s-lectures');
    await flow.chooseFolder();
    interop.exportTo = () => Promise.reject({ code: 'io', message: 'access denied' });
    flow.setFormat('html');
    await flow.start();
    const state = flow.state.get();
    expect(state.step).toBe('options');
    if (state.step === 'options') {
      expect(state.error?.code).toBe('io');
      expect(state.format).toBe('html');
    }
    detach();
  });
});
