import { beforeEach, describe, expect, it } from 'vitest';
import { resetStores } from '../../../state/store';
import { resetBackgroundForTests } from '../background';
import { createScheduler } from '../background/scheduler';
import { extrasState, resetExtrasForTests, setExtra } from '../extras';
import { installTestHost } from '../testing';
import { embed, similarity, stem, tokens } from './embed';
import {
  findByMeaning,
  forgetIndex,
  indexPage,
  loadSavedIndex,
  meaningIndex,
  relatedPages,
  resetMeaningForTests,
  runIndexPass,
} from './engine';
import type { PageSource } from './engine';
import { chunksOfPage, plainMarkdown } from './pageText';
import { deserialize, serialize } from './persist';
import { createVectorIndex } from './vectorIndex';

describe('the embedder', () => {
  it('stems the common endings', () => {
    expect(stem('walking')).toBe('walk');
    expect(stem('studies')).toBe('study');
    expect(stem('walked')).toBe('walk');
    expect(stem('classes')).toBe('class');
  });

  it('maps words that mean the same to one token and drops filler words', () => {
    expect(tokens('We purchased the automobile')).toEqual(tokens('We buy a car'));
    expect(tokens('the and of')).toEqual([]);
  });

  it('puts text about one thing nearer than text about another', () => {
    const query = embed('how do I buy a car');
    const near = embed('Notes on purchasing an automobile: compare prices and insurance.');
    const far = embed('The mitochondria is the powerhouse of the cell.');
    expect(similarity(query, near)).toBeGreaterThan(similarity(query, far) + 0.15);
  });

  it('finds spelling variants through word parts', () => {
    const query = embed('colour palette');
    expect(similarity(query, embed('The colourful palette of the room'))).toBeGreaterThan(
      similarity(query, embed('The musical key of the room')),
    );
  });

  it('gives text with no words a zero vector, and other text length 1', () => {
    expect(embed('the of and').every((v) => v === 0)).toBe(true);
    expect(similarity(embed('photosynthesis in plants'), embed('photosynthesis in plants'))).toBeCloseTo(1, 4);
  });
});

describe('page text', () => {
  it('strips Markdown to words', () => {
    expect(plainMarkdown('## Plan\n- [ ] **Call** the [clinic](https://x.test)\n1. Book [[Trip]]')).toBe(
      'Plan\nCall the clinic\nBook Trip',
    );
  });

  it('cuts a page into paragraphs in block order and joins a heading to its text', () => {
    const chunks = chunksOfPage({
      blocks: [
        {
          id: 'b2',
          type: 'text',
          order: 'b',
          created: '',
          modified: '',
          data: { markdown: 'It grows in sunlight and water.' },
        },
        {
          id: 'b1',
          type: 'text',
          order: 'a',
          created: '',
          modified: '',
          data: { markdown: '# Plants\n\nPlants make food.' },
        },
        { id: 'b3', type: 'image', order: 'c', created: '', modified: '', data: {} },
      ],
    });
    // A short paragraph joins the one before it, so the heading, its text, and the line after it are one paragraph.
    expect(chunks).toEqual([{ block: 'b1', text: 'Plants Plants make food. It grows in sunlight and water.' }]);
  });
});

const page = (id: string, title: string, ...texts: string[]) => ({
  id,
  title,
  modified: '2026-10-01',
  chunks: texts.map((text, index) => ({ block: `${id}-${index}`, text })),
});

describe('the vector index', () => {
  it('finds a page by meaning when the words differ', () => {
    const index = createVectorIndex();
    index.set(page('car', 'Buying a car', 'Compare the price of each automobile and the insurance cost.'));
    index.set(page('cell', 'Biology', 'Mitochondria make energy for the cell.'));
    const hits = index.search(embed('purchase a vehicle'));
    expect(hits[0]?.pageId).toBe('car');
    expect(hits.map((hit) => hit.pageId)).not.toContain('cell');
  });

  it('lists related pages and leaves the page itself out', () => {
    const index = createVectorIndex();
    index.set(page('a', 'Trip to Rome', 'Book the flight and the hotel for the holiday in Italy.'));
    index.set(page('b', 'Vacation ideas', 'Travel to Italy for a holiday, with a hotel near the station.'));
    index.set(page('c', 'Chemistry', 'Balance the equation and find the moles of the reagent.'));
    const related = index.related('a');
    expect(related.map((hit) => hit.pageId)).toEqual(['b']);
  });

  it('never adds a protected page and drops one that becomes protected', () => {
    const index = createVectorIndex();
    index.set(page('secret', 'Diary', 'Private words about my day.'));
    index.setProtectedCheck((id) => id === 'secret');
    expect(index.has('secret')).toBe(false);
    expect(index.set(page('secret', 'Diary', 'More private words.'))).toBe(false);
  });

  it('saves and restores the vectors', () => {
    const index = createVectorIndex();
    index.set(page('a', 'Trip', 'Book the flight and the hotel.'));
    const restored = createVectorIndex();
    for (const saved of deserialize(serialize(index.all(), 'built in'), 'built in')) restored.restore(saved);
    expect(restored.get('a')?.chunks[0]?.text).toBe('Book the flight and the hotel.');
    expect(restored.search(embed('flight hotel'))[0]?.pageId).toBe('a');
    expect(deserialize(serialize(index.all(), 'built in'), 'another embedder')).toEqual([]);
    expect(deserialize('not json', 'built in')).toEqual([]);
  });
});

function source(pages: Record<string, { title: string; text: string }>, modified = '1'): PageSource {
  return {
    list: async () => Object.entries(pages).map(([id, one]) => ({ id, title: one.title, modified })),
    read: async (id) => ({
      blocks: [
        {
          id: `${id}-b`,
          type: 'text',
          order: 'a',
          created: '',
          modified: '',
          data: { markdown: pages[id]?.text ?? '' },
        },
      ],
    }),
  };
}

describe('the engine', () => {
  beforeEach(() => {
    resetStores();
    resetMeaningForTests();
    resetExtrasForTests();
    installTestHost();
    resetBackgroundForTests(
      createScheduler({ idle: () => true, pluggedIn: () => true, now: () => Date.now() }, { cpuPercent: 100 }),
    );
  });

  it('reads the pages a pass finds, answers a search, and forgets pages that are gone', async () => {
    const pages = {
      a: { title: 'Cars', text: 'Compare the price of each automobile.' },
      b: { title: 'Cells', text: 'Mitochondria make energy.' },
    };
    expect(await runIndexPass(source(pages), new AbortController().signal)).toBe(2);
    expect(findByMeaning('buy a car')[0]?.pageId).toBe('a');
    expect(relatedPages('a')).toEqual([]);
    // Nothing changed, so the next pass reads nothing, and a page that left the tree leaves the index.
    expect(await runIndexPass(source({ a: pages.a }), new AbortController().signal)).toBe(0);
    expect(meaningIndex().ids()).toEqual(['a']);
  });

  it('indexes a page it is given only while search by meaning is on', async () => {
    const shown = { id: 'p', title: 'Trip', modified: '1', blocks: [] };
    expect(indexPage(shown)).toBe(false);
    await setExtra('meaning', true);
    expect(extrasState.get().on.meaning).toBe(true);
    expect(indexPage(shown)).toBe(true);
    expect(indexPage(shown)).toBe(false);
  });

  it('keeps nothing after the index is forgotten', async () => {
    await runIndexPass(source({ a: { title: 'Cars', text: 'Buy an automobile.' } }), new AbortController().signal);
    await forgetIndex();
    expect(meaningIndex().size).toBe(0);
    await loadSavedIndex();
    expect(meaningIndex().size).toBe(0);
  });
});
