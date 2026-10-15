import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeId, NodeSummary } from '../../services/notes/types';
import { resetStores } from '../../state/store';
import { resetBackgroundForTests } from './background';
import { getImageText, onImageText, queueImageText, resetImageTextForTests } from './background/imageText';
import { createScheduler } from './background/scheduler';
import { resetExtrasForTests, setExtra } from './extras';
import { pageIsProtected } from './lifecycle';
import {
  indexPage,
  loadSavedIndex,
  meaningIndex,
  resetMeaningForTests,
  runIndexPass,
  saveIndexNow,
} from './meaning/engine';
import type { PageSource } from './meaning/engine';
import { FILE as MEANING_FILE, serialize } from './meaning/persist';
import {
  checkPageProtected,
  isProtectedPage,
  listTreePages,
  resetProtectedPagesForTests,
  setPagesProtected,
} from './protectedPages';
import { intelExt, loadIntel } from './runtime';
import { installTestHost } from './testing';

const SECRET = 'My bank PIN is under the blue lamp.';

// Node has no image decoder: the reading itself answers with the secret, so the queue runs as it does in the app.
vi.mock('./imageText', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./imageText')>()),
  readTextInImage: async () => ({
    language: 'en-US',
    angle: null,
    lines: [{ text: SECRET, bounds: { x: 0, y: 0, width: 1, height: 1 }, words: [] }],
  }),
}));

function source(pages: Record<string, { text: string; encrypted?: boolean }>, reads: string[] = []): PageSource {
  return {
    list: async () =>
      Object.entries(pages).map(([id, one]) => ({ id, title: id, modified: '1', encrypted: one.encrypted })),
    read: async (id) => {
      reads.push(id);
      return {
        blocks: [
          { id: `${id}-b`, type: 'text', order: 'a', created: '', modified: '', data: { markdown: pages[id]?.text } },
        ],
      };
    },
  };
}

const savedFile = async (name: string) => (await (await intelExt()).get(name)) ?? '';

const node = (id: string, kind: NodeSummary['kind'], extra: Partial<NodeSummary> = {}): NodeSummary => ({
  id: id as NodeId,
  kind,
  parentId: null,
  title: id,
  color: null,
  pageLevel: 0,
  childCount: 0,
  created: '',
  modified: '1',
  readOnly: false,
  ...extra,
});

beforeEach(async () => {
  resetStores();
  resetMeaningForTests();
  resetImageTextForTests();
  resetExtrasForTests();
  resetProtectedPagesForTests();
  installTestHost({ settings: { ocr: true } });
  await loadIntel();
  resetBackgroundForTests(
    createScheduler({ idle: () => true, pluggedIn: () => true, now: () => Date.now() }, { cpuPercent: 100 }),
  );
  await setExtra('meaning', true);
});

describe('pages of an encrypted section', () => {
  it('are never read into the meaning index or its file', async () => {
    const reads: string[] = [];
    const pages = { diary: { text: SECRET, encrypted: true }, cars: { text: 'Buy an automobile.' } };
    expect(await runIndexPass(source(pages, reads), new AbortController().signal)).toBe(1);
    expect(reads).toEqual(['cars']);
    expect(meaningIndex().has('diary')).toBe(false);
    await saveIndexNow();
    expect(await savedFile(MEANING_FILE)).not.toContain('blue lamp');
    expect(indexPage({ id: 'diary', title: 'Diary', modified: '2', blocks: [] })).toBe(false);
  });

  it('leave the index and its file at once when their section becomes encrypted', async () => {
    await runIndexPass(source({ diary: { text: SECRET } }), new AbortController().signal);
    await saveIndexNow();
    expect(await savedFile(MEANING_FILE)).toContain('blue lamp');
    await runIndexPass(source({ diary: { text: SECRET, encrypted: true } }), new AbortController().signal);
    expect(meaningIndex().has('diary')).toBe(false);
    expect(await savedFile(MEANING_FILE)).not.toContain('blue lamp');
  });

  it('are written out of a saved index that still holds them', async () => {
    await runIndexPass(source({ diary: { text: SECRET } }), new AbortController().signal);
    const saved = serialize(meaningIndex().all(), meaningIndex().embedder.name);
    resetMeaningForTests();
    await (await intelExt()).put(MEANING_FILE, saved);
    await setPagesProtected(['diary']);
    await loadSavedIndex();
    expect(meaningIndex().has('diary')).toBe(false);
    expect(await savedFile(MEANING_FILE)).not.toContain('blue lamp');
  });

  it('lose the words read in their images, on disk too, and get no new ones', async () => {
    const kept = { 'diary/a1': { text: SECRET, at: 1 }, 'cars/a2': { text: 'Price list', at: 2 } };
    await (await intelExt()).put('image-text.json', JSON.stringify(kept));
    expect(await getImageText('diary/a1')).toBe(SECRET);
    await setPagesProtected(['diary']);
    expect(await getImageText('diary/a1')).toBeNull();
    expect(await getImageText('cars/a2')).toBe('Price list');
    expect(await savedFile('image-text.json')).not.toContain('blue lamp');
    expect(await queueImageText('http://opennote-asset.localhost/diary/a3', 'photo')).toBe(false);
  });

  it('lose the words of an image at an outside or data address, which names no page', async () => {
    const src = 'data:image/png;base64,iVBORw0KGgo=';
    const read = new Promise<string>((resolve) => onImageText((key) => resolve(key)));
    expect(await queueImageText(src, 'photo', 'diary')).toBe(true);
    const key = await read;
    expect(await getImageText(key)).toBe(SECRET);
    await setPagesProtected(['diary']);
    expect(await getImageText(key)).toBeNull();
    expect(await savedFile('image-text.json')).not.toContain('blue lamp');
    expect(await queueImageText(src, 'photo', 'diary')).toBe(false);
  });

  it('are dropped from a saved image-text file the next time it is read', async () => {
    await (await intelExt()).put('image-text.json', JSON.stringify({ 'diary/a1': { text: SECRET, at: 1 } }));
    await setPagesProtected(['diary']);
    resetImageTextForTests();
    expect(await getImageText('diary/a1')).toBeNull();
    expect(await savedFile('image-text.json')).not.toContain('blue lamp');
  });
});

describe('knowing which pages are protected', () => {
  it('marks every page under an encrypted section', async () => {
    const children: Record<string, NodeSummary[]> = {
      nb: [node('diary', 'section', { encrypted: true, childCount: 1 }), node('open', 'section', { childCount: 1 })],
      diary: [node('p1', 'page')],
      open: [node('p2', 'page')],
    };
    const notes = {
      listNotebooks: async () => [node('nb', 'notebook', { childCount: 2 })],
      listChildren: async (id: string) => children[id] ?? [],
    };
    expect((await listTreePages(notes)).map((page) => [page.id, page.encrypted])).toEqual([
      ['p1', true],
      ['p2', false],
    ]);
  });

  it('keeps nothing of a page while the tree is not there, and says so in the log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(await pageIsProtected('early')).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('early'));
    } finally {
      warn.mockRestore();
    }
  });

  it('asks the tree about a page it has not seen, and counts an unknown page as protected', async () => {
    const nodes: Record<string, NodeSummary> = {
      locked: node('locked', 'page', { encrypted: true }),
      plain: node('plain', 'page'),
    };
    const notes = { get: async (id: string) => nodes[id] ?? null };
    expect(await checkPageProtected('locked', notes)).toBe(true);
    expect(isProtectedPage('locked')).toBe(true);
    expect(await checkPageProtected('plain', notes)).toBe(false);
    expect(await checkPageProtected('missing', notes)).toBe(true);
    expect(await checkPageProtected('broken', { get: () => Promise.reject(new Error('gone')) })).toBe(true);
  });
});
