// The meaning model (A3-23): its vectors replace the built-in ones once the model is downloaded, the index is built
// again with them, and removing the model brings the built-in embedder back. The model is the shell's stand-in.
import { beforeEach, describe, expect, it } from 'vitest';
import { createIntelExt } from '../../../services/intel';
import { resetStores } from '../../../state/store';
import { resetExtrasForTests, setExtra } from '../extras';
import { installTestHost } from '../testing';
import type { TestHost } from '../testing';
import {
  embedderName,
  findByMeaning,
  meaningIndex,
  resetMeaningForTests,
  runIndexPass,
  syncEmbedderFrom,
} from './engine';
import { createModelEmbedder, MODEL_DIM } from './modelEmbedder';

const pages: Record<string, { title: string; text: string }> = {
  a: { title: 'Cars', text: 'Compare the price of each automobile.' },
  b: { title: 'Cells', text: 'Mitochondria make energy.' },
};

const source = {
  list: () => Promise.resolve(Object.entries(pages).map(([id, page]) => ({ id, title: page.title, modified: '1' }))),
  read: (id: string) =>
    Promise.resolve({
      blocks: [{ id: `${id}1`, type: 'text', data: { markdown: pages[id]?.text ?? '' } }],
    } as never),
};

const runnable = () => Promise.resolve(true);
let host: TestHost;

const list = () => createIntelExt(host.transport).models.list();

async function download(id: string) {
  await createIntelExt(host.transport).models.start(id);
  host.transport.ext.tick(1e12);
}

beforeEach(() => {
  resetStores();
  resetExtrasForTests();
  resetMeaningForTests();
  host = installTestHost();
});

describe('the model embedder', () => {
  it('gives vectors of the size the model makes, in the order of the texts', async () => {
    await download('meaning-minilm');
    const embedder = createModelEmbedder(createIntelExt(host.transport));
    const vectors = await embedder.embedMany(Array.from({ length: 20 }, (_, i) => `word${i} cat`));
    expect(vectors).toHaveLength(20);
    expect(vectors.every((v) => v.length === MODEL_DIM)).toBe(true);
    expect(embedder.dim).toBe(MODEL_DIM);
  });

  it('refuses vectors of the wrong size or count', async () => {
    const wrongSize = createModelEmbedder({ embed: { run: () => Promise.resolve([[1, 2, 3]]) } });
    await expect(wrongSize.embedMany(['a'])).rejects.toThrow(/wrong size/);
    const wrongCount = createModelEmbedder({ embed: { run: () => Promise.resolve([]) } });
    await expect(wrongCount.embedMany(['a'])).rejects.toThrow(/wrong count/);
  });
});

describe('switching the index to the model', () => {
  it('uses the built-in embedder until the model is downloaded', async () => {
    await setExtra('meaning', true);
    expect(await syncEmbedderFrom(await list(), runnable, false)).toBe(false);
    expect(embedderName()).toBe('words and word parts');
    expect(await runIndexPass(source, new AbortController().signal)).toBe(2);
    expect(meaningIndex().get('a')?.titleVector).toHaveLength(768);
  });

  it('rebuilds with the model once it is downloaded, and goes back when it is removed', async () => {
    await download('meaning-minilm');
    expect(await syncEmbedderFrom(await list(), runnable, false)).toBe(true);
    expect(embedderName()).toBe('meaning model');
    expect(await runIndexPass(source, new AbortController().signal)).toBe(2);
    expect(meaningIndex().get('a')?.titleVector).toHaveLength(MODEL_DIM);
    // The stand-in model puts texts with the same words together, so a search finds the page with the words.
    expect((await findByMeaning('automobile price'))[0]?.pageId).toBe('a');
    await createIntelExt(host.transport).models.remove('meaning-minilm');
    expect(await syncEmbedderFrom(await list(), runnable, false)).toBe(true);
    expect(embedderName()).toBe('words and word parts');
    expect(meaningIndex().size).toBe(0);
  });

  it('keeps the built-in embedder when this build cannot run the model', async () => {
    await download('meaning-minilm');
    expect(await syncEmbedderFrom(await list(), () => Promise.resolve(false), false)).toBe(false);
    expect(embedderName()).toBe('words and word parts');
  });
});
