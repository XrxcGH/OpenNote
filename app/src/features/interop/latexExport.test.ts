// @vitest-environment node
// The LaTeX choices, the citation library that goes with them, and the flow: options, live preview, and the request.

import { describe, expect, it } from 'vitest';
import { blankSource, setSources } from '../citations';
import type { Source } from '../citations';
import { createWebInterop } from '../../platform/web/interop';
import { createMemoryNotesService } from '../../services/notes/memory';
import type { NodeId } from '../../services/notes/types';
import { createExportFlow } from './exportFlow';
import { resolveTarget } from './exportTarget';
import { DEFAULT_LATEX, latexOptions, loadLatexChoices } from './latex';

const id = (value: string) => value as NodeId;

async function setup(start: string, format?: 'latex') {
  const interop = createWebInterop();
  const notes = createMemoryNotesService({ seed: 'sample' });
  const target = await resolveTarget(notes, id(start));
  if (!target) throw new Error('No target');
  const flow = createExportFlow({ interop, notes, target, announce: () => {}, ...(format ? { format } : {}) });
  const detach = flow.attach();
  return { interop, notes, target, flow, detach };
}

const source = (sid: string, family: string, year: string): Source => ({
  ...blankSource('book'),
  id: sid,
  title: `Book ${sid}`,
  authors: [{ family, given: 'A.' }],
  year,
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the LaTeX choices', () => {
  it('start from the defaults when nothing is saved or the saved choices are damaged', () => {
    expect(loadLatexChoices()).toEqual(DEFAULT_LATEX);
    expect(DEFAULT_LATEX).toMatchObject({ engine: 'unicode', paper: 'letter', titleBlock: true, toc: false });
  });
});

describe('the citation library for a LaTeX export', () => {
  it('sends the notebook list and the shared list with BibTeX keys that are unique across both', async () => {
    setSources('n-biology', [source('s1', 'Smith', '2020'), source('s2', 'Jones', '2019')]);
    setSources('shared', [source('s3', 'Smith', '2020')]);
    const options = await latexOptions(DEFAULT_LATEX, 'n-biology');
    expect(options.citations.map((c) => [c.notebook, c.id, c.key])).toEqual([
      ['n-biology', 's1', 'Smith2020'],
      ['n-biology', 's2', 'Jones2019'],
      ['shared', 's3', 'Smith2020b'],
    ]);
    expect(options.citations[0].entry).toMatch(/^@book\{Smith2020,\n {2}author = \{Smith, A\.\}/);
    expect(options.engine).toBe('unicode');
  });
});

describe('the Export dialog flow with LaTeX', () => {
  it('keeps the choices, previews the file after a moment, and sends the choices with the export', async () => {
    setSources('n-biology', [source('s1', 'Smith', '2020')]);
    setSources('shared', []);
    const { flow, interop, detach } = await setup('p-mitosis', 'latex');
    expect(flow.state.get()).toMatchObject({ format: 'latex', latex: DEFAULT_LATEX });
    flow.setLatex({ paper: 'a4', toc: true, author: 'Ada' });
    expect(flow.preview.get()).toEqual({ status: 'loading' });
    flow.setLatex({ margin: 'wide' });
    await wait(600);
    const shown = flow.preview.get();
    expect(shown.status).toBe('ready');
    if (shown.status === 'ready') {
      expect(shown.text).toContain('\\documentclass[11pt,a4paper]{article}');
      expect(shown.text).toContain('% Margins: wide');
      expect(shown.text).toContain('\\tableofcontents');
      expect(shown.text).toContain('\\author{Ada}');
    }
    interop.pick = () => Promise.resolve('C:\\Users\\Sample\\Exports');
    await flow.start();
    expect(flow.state.get().step).toBe('done');
    const request = interop.log.exports[0];
    expect(request).toMatchObject({
      format: 'latex',
      scope: 'page',
      latex: { paper: 'a4', margin: 'wide', toc: true, author: 'Ada', engine: 'unicode' },
    });
    expect(request.latex?.citations.map((c) => c.key)).toEqual(['Smith2020']);
    detach();
  });

  it('shows no preview for other formats, and one again when LaTeX is chosen', async () => {
    const { flow, detach } = await setup('p-mitosis');
    expect(flow.state.get()).toMatchObject({ format: 'markdown' });
    expect(flow.preview.get()).toEqual({ status: 'idle' });
    flow.setFormat('latex');
    expect(flow.state.get()).toMatchObject({ format: 'latex', latex: DEFAULT_LATEX });
    expect(flow.preview.get()).toEqual({ status: 'loading' });
    flow.setFormat('docx');
    expect(flow.preview.get()).toEqual({ status: 'idle' });
    detach();
  });

  it('says so, calmly, when the host cannot make the preview', async () => {
    const { flow, interop, detach } = await setup('p-mitosis', 'latex');
    interop.latexPreview = () => Promise.reject({ code: 'io', message: 'disk' });
    flow.setLatex({ toc: true });
    await wait(600);
    expect(flow.preview.get()).toMatchObject({ status: 'error', error: { code: 'io' } });
    detach();
  });
});
