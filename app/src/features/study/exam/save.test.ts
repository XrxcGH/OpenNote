// Saving exam pages: the results page keeps the exam in its view for a retake and the handwritten answers as
// pictures after its text, and a paper saved earlier gets the exam merged into its view.
import { describe, expect, it } from 'vitest';
import { createMemoryNotesService } from '../../../services/notes/memory';
import { createMemoryPageService } from '../../../services/pages/memory';
import { inkSvg } from './inkPicture';
import { examSection, patchPageView, writePage } from './save';
import { readStoredExam, storedExam } from './stored';
import type { Exam } from './types';
import { DEFAULT_SETTINGS } from './types';

function rig() {
  const notes = createMemoryNotesService({ seed: 'empty' });
  const pages = createMemoryPageService([], {
    missing: (id) => ({ id, title: '', created: '', modified: '', tags: [], view: {}, blocks: [], assets: {} }),
  });
  return { notes, pages };
}

const exam: Exam = {
  id: 'exam-1',
  title: 'Cells',
  created: '2026-10-01T08:00:00.000Z',
  settings: DEFAULT_SETTINGS,
  questions: [
    {
      id: 'q1',
      kind: 'short',
      prompt: 'Name it.',
      marks: 1,
      answer: 'Mitochondria',
      guide: [],
      source: { pageId: 'p1', title: 'Cells', topic: 'Organelles' },
    },
  ],
  engine: 'rules',
};

async function section(notes: ReturnType<typeof rig>['notes']) {
  const notebook = await notes.create({ kind: 'notebook', placement: { parentId: null, beforeId: null }, title: 'N' });
  const made = await examSection(notes, notebook.id, true);
  return made!.id;
}

describe('saving exam pages', () => {
  it('puts the exam in the view, then the text, then each picture under its label', async () => {
    const { notes, pages } = rig();
    const svg = inkSvg([
      [
        [1, 1],
        [9, 9],
      ],
    ])!;
    const page = await writePage(notes, pages, await section(notes), 'Results', '# Score', {
      view: storedExam(exam),
      pictures: [
        {
          label: 'Question 1, as you wrote it:',
          alt: 'Answer 1.',
          name: 'Question 1.svg',
          svg,
          width: 480,
          height: 150,
        },
      ],
    });
    const open = await pages.open(page.id, { viewport: null });
    const saved = open.initial;
    expect(readStoredExam(saved.view)).toEqual(exam);
    const kinds = [...saved.blocks].sort((a, b) => (a.order < b.order ? -1 : 1)).map((block) => block.type);
    expect(kinds).toEqual(['text', 'text', 'image']);
    const image = saved.blocks.find((block) => block.type === 'image')!;
    expect(image.data.alt).toBe('Answer 1.');
    expect(image.frame?.w).toBe(480);
    expect(image.frame?.h).toBe(150);
    const asset = saved.assets[String(image.data.asset)];
    expect(asset?.mime).toBe('image/svg+xml');
    expect(asset?.bytes).toBe(new TextEncoder().encode(svg).byteLength);
    await open.close();
  });

  it('merges the exam into a page saved before, keeping what its view had', async () => {
    const { notes, pages } = rig();
    const page = await writePage(notes, pages, await section(notes), 'Paper', 'Questions', {
      view: { layout: 'flow' },
    });
    expect(await patchPageView(pages, page.id, storedExam(exam))).toBe(true);
    const open = await pages.open(page.id, { viewport: null });
    expect(open.initial.view.layout).toBe('flow');
    expect(readStoredExam(open.initial.view)).toEqual(exam);
    await open.close();
  });
});
