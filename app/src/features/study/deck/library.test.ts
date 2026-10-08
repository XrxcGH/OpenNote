import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 });
import { deckName, pictureName, splitPictures } from './deckFiles';
import type { DeckFiles } from './deckFiles';
import type { Card } from './types';

const shared = vi.hoisted(() => ({
  items: new Map<string, string>(),
  failPuts: false,
  /** Fails the writes of the items this picks. */
  failPut: null as ((name: string) => boolean) | null,
  /** Holds deck writes until it resolves. */
  gate: null as Promise<void> | null,
  /** Uses the web platform's device store (the browser's storage) instead of the map above. */
  web: false,
  toasts: [] as { message: string; tone?: string }[],
}));

vi.mock('../../intel', () => ({
  deviceStore: async (): Promise<DeckFiles> => {
    if (shared.web) {
      const { loadIntelHost } = await import('../../../platform/intel');
      const { createIntelExt } = await import('../../../services/intel');
      return createIntelExt((await loadIntelHost()).transport);
    }
    return {
      get: (name) => Promise.resolve(shared.items.get(name) ?? null),
      put: async (name, text) => {
        // The shell's rule for a stored name (app/src-tauri/src/intel/ext.rs).
        if (name.length > 80 || !/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(name)) throw new Error('A bad name.');
        if (shared.gate && name.startsWith('study.deck.')) await shared.gate;
        if (shared.failPuts || shared.failPut?.(name)) throw new Error('The disk is full.');
        shared.items.set(name, text);
      },
      remove: (name) => Promise.resolve(void shared.items.delete(name)),
      list: (prefix) => Promise.resolve([...shared.items.keys()].filter((name) => name.startsWith(prefix)).sort()),
    };
  },
}));

vi.mock('../../../ui', () => ({
  showToast: (toast: { message: string; tone?: string }) => void shared.toasts.push(toast),
}));

/** A window: a fresh copy of the library, as the main window and a popped-out window each have. */
async function openWindow() {
  vi.resetModules();
  const library = await import('./library');
  await library.whenDecksLoaded();
  return library;
}

const picture = (n: number) => `data:image/jpeg;base64,${String(n).repeat(50_000)}`;
const card = (id: string, extra: Partial<Card> = {}): Card => ({ id, kind: 'basic', front: id, back: '', ...extra });

class MemoryStorage {
  private readonly map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

beforeEach(() => {
  shared.items.clear();
  shared.failPuts = false;
  shared.failPut = null;
  shared.gate = null;
  shared.web = false;
  shared.toasts.length = 0;
  vi.stubGlobal('localStorage', new MemoryStorage());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('decks in the device store', () => {
  it('keeps each deck and each picture as an item of its own, and a new window reads them back', async () => {
    const one = await openWindow();
    const occlusion = { src: picture(1), alt: 'Leaf', boxes: [] };
    const deck = one.createDeck('Biology', [
      card('a', { kind: 'occlusion', image: occlusion }),
      card('b', { images: { front: [picture(2)], back: [picture(1)] } }),
    ]);
    one.createDeck('History', [card('c')]);
    await one.flushDecks();
    const names = [...shared.items.keys()];
    expect(names.filter((name) => name.startsWith('study.deck.'))).toHaveLength(2);
    expect(names.filter((name) => name.startsWith('study.picture.'))).toHaveLength(2);
    const deckItems = names.filter((name) => name.startsWith('study.deck.')).map((name) => shared.items.get(name)!);
    expect(Math.max(...deckItems.map((text) => text.length))).toBeLessThan(2000);
    expect(localStorage.getItem('opennote.study.decks')).toBeNull();

    const two = await openWindow();
    expect(two.decksStore.get().map((one) => one.name)).toEqual(['Biology', 'History']);
    expect(two.deckById(deck.id)?.cards[0].image?.src).toBe(picture(1));
    expect(two.deckById(deck.id)?.cards[1].images).toEqual({ front: [picture(2)], back: [picture(1)] });
  });

  it('reports a save that fails, and keeps the change in memory', async () => {
    const one = await openWindow();
    shared.failPuts = true;
    one.createDeck('Chemistry', [card('a')]);
    await one.flushDecks();
    expect(shared.toasts).toEqual([expect.objectContaining({ tone: 'danger' })]);
    expect(one.decksStore.get().map((deck) => deck.name)).toEqual(['Chemistry']);
  });

  it('moves the decks an earlier version kept in the browser storage, with their history, once', async () => {
    const old = [
      {
        id: 'd1',
        name: 'Old',
        cards: [card('a', { kind: 'occlusion', image: { src: picture(3), alt: '', boxes: [] } })],
      },
    ];
    localStorage.setItem('opennote.study.decks', JSON.stringify(old));
    const state = { due: '2026-10-08', interval: 1, ease: 2.5, reps: 1, lapses: 0, first: '2026-10-07' };
    localStorage.setItem('opennote.study.states.d1', JSON.stringify({ a: state }));
    const one = await openWindow();
    expect(one.deckById('d1')?.cards[0].image?.src).toBe(picture(3));
    expect(one.statesOf('d1')).toEqual({ a: state });
    expect(localStorage.getItem('opennote.study.decks')).toBeNull();
    expect(localStorage.getItem('opennote.study.states.d1')).toBeNull();
    expect((await openWindow()).deckById('d1')?.name).toBe('Old');
  });

  it('moves the history of a deck whose earlier move stopped after the deck', async () => {
    localStorage.setItem('opennote.study.decks', JSON.stringify([{ id: 'd1', name: 'Old', cards: [card('a')] }]));
    const state = { due: '2026-10-08', interval: 1, ease: 2.5, reps: 1, lapses: 0, first: '2026-10-07' };
    localStorage.setItem('opennote.study.states.d1', JSON.stringify({ a: state }));
    shared.failPut = (name) => name.startsWith('study.states.');
    await openWindow();
    expect(localStorage.getItem('opennote.study.states.d1')).not.toBeNull();
    shared.failPut = null;
    const next = await openWindow();
    expect(next.statesOf('d1')).toEqual({ a: state });
    expect(localStorage.getItem('opennote.study.states.d1')).toBeNull();
  });

  it('reports a picture that is missing, and keeps naming it so a later save does not lose it', async () => {
    const one = await openWindow();
    const deck = one.createDeck('Pictures', [card('a', { images: { front: [picture(4)], back: [] } })]);
    await one.flushDecks();
    for (const name of [...shared.items.keys()]) if (name.startsWith('study.picture.')) shared.items.delete(name);
    const two = await openWindow();
    expect(shared.toasts).toEqual([expect.objectContaining({ tone: 'danger' })]);
    two.changeDeck(deck.id, (old) => ({ ...old, name: 'Renamed' }));
    await two.flushDecks();
    expect(shared.items.get(deckName(deck.id))).toContain('opennote-picture:');
  });

  it('says when the decks have been read, so an empty list is not shown as "no decks" before then', async () => {
    vi.resetModules();
    const library = await import('./library');
    expect(library.decksLoadedStore.get()).toBe(false);
    await library.whenDecksLoaded();
    expect(library.decksLoadedStore.get()).toBe(true);
  });

  it('keeps the old decks in the browser storage when moving them fails', async () => {
    localStorage.setItem('opennote.study.decks', JSON.stringify([{ id: 'd1', name: 'Old', cards: [] }]));
    shared.failPuts = true;
    await openWindow();
    expect(localStorage.getItem('opennote.study.decks')).not.toBeNull();
    expect(shared.toasts).toHaveLength(1);
  });
});

describe('long IDs', () => {
  it("keeps the review of a page deck's inline card, whose IDs are too long to spell out in a name", async () => {
    const one = await openWindow();
    const page = '01K6PAGE0000000000000000AB';
    const cardId = `inline:${page}:12`;
    await one.syncInlineDeck(page, 'Page', [card(cardId, { origin: `inline:${page}:12` })]);
    await one.flushDecks();
    one.recordReview(one.pageDeckId(page), cardId, 'good', new Date('2026-10-07T10:00:00Z'));
    await one.flushDecks();
    expect(shared.toasts).toEqual([]);
    expect([...shared.items.keys()].every((name) => name.length <= 80)).toBe(true);
    const next = await openWindow();
    expect(Object.keys(next.statesOf(next.pageDeckId(page)))).toEqual([cardId]);
  });

  it('keeps a deck whose ID is too long to spell out in a name', async () => {
    const one = await openWindow();
    const id = `imported:${'x'.repeat(90)}`;
    one.putDeck({ id, name: 'Long', cards: [card('a')] });
    await one.flushDecks();
    expect(shared.toasts).toEqual([]);
    expect((await openWindow()).deckById(id)?.name).toBe('Long');
  });
});

describe('on the web platform', () => {
  it('keeps the decks in the browser across a reload, and moving old decks there keeps them', async () => {
    vi.stubEnv('VITE_PLATFORM', 'web');
    shared.web = true;
    localStorage.setItem('opennote.study.decks', JSON.stringify([{ id: 'd1', name: 'Old', cards: [card('a')] }]));
    const one = await openWindow();
    expect(one.deckById('d1')?.name).toBe('Old');
    one.createDeck('New', [card('b')]);
    await one.flushDecks();
    const reloaded = await openWindow();
    expect(reloaded.decksStore.get().map((deck) => deck.name)).toEqual(['Old', 'New']);
  });
});

describe('two windows', () => {
  it('merge their changes instead of writing over each other', async () => {
    const main = await openWindow();
    const popped = await openWindow();
    // In the popped-out Flashcards window, a new deck; in the main window, a page with a "Question :: Answer" line.
    const chem = popped.createDeck('Chem', [card('x')]);
    await popped.flushDecks();
    await main.syncInlineDeck('01k6page000000000000000001', 'Notes', [card('q', { origin: 'inline:b:1' })]);
    await main.flushDecks();
    // Each window took in the other's deck.
    await vi.waitFor(() => expect(main.deckById(chem.id)?.name).toBe('Chem'));
    await vi.waitFor(() => expect(popped.deckById(main.pageDeckId('01k6page000000000000000001'))).toBeDefined());
    // Reviewing in one window keeps the other's decks.
    popped.recordReview(chem.id, 'x', 'good', new Date('2026-10-07T10:00:00Z'));
    await popped.flushDecks();
    const later = await openWindow();
    expect(
      later.decksStore
        .get()
        .map((deck) => deck.name)
        .sort(),
    ).toEqual(['Chem', 'Notes']);
    expect(Object.keys(later.statesOf(chem.id))).toEqual(['x']);
  });

  it('wait for the decks to be read before a page brings in its lines, so hand-typed cards stay', async () => {
    const first = await openWindow();
    const id = first.pageDeckId('01k6page000000000000000002');
    first.putDeck({ id, name: 'Page', cards: [card('typed'), card('q', { origin: 'inline:b:1' })] });
    await first.flushDecks();
    vi.resetModules();
    const next = await import('./library');
    // A page is shown before the store is read.
    const inline = [card('q2', { origin: 'inline:b:2' })];
    await next.syncInlineDeck('01k6page000000000000000002', 'Page', inline);
    await next.flushDecks();
    expect(next.deckById(id)?.cards.map((one) => one.id)).toEqual(['typed', 'q2']);
  });

  it('keep both reviews when they review different cards of one deck at once', async () => {
    const main = await openWindow();
    const popped = await openWindow();
    const deck = main.createDeck('Both', [card('x'), card('y')]);
    await main.flushDecks();
    await vi.waitFor(() => expect(popped.deckById(deck.id)).toBeDefined());
    const at = new Date('2026-10-07T10:00:00Z');
    main.recordReview(deck.id, 'x', 'good', at);
    popped.recordReview(deck.id, 'y', 'good', at);
    await Promise.all([main.flushDecks(), popped.flushDecks()]);
    expect(Object.keys((await openWindow()).statesOf(deck.id)).sort()).toEqual(['x', 'y']);
    await vi.waitFor(() => expect(Object.keys(main.statesOf(deck.id)).sort()).toEqual(['x', 'y']));
    await vi.waitFor(() => expect(Object.keys(popped.statesOf(deck.id)).sort()).toEqual(['x', 'y']));
  });

  it('keep a picture a deck from the other window names when this window removes the last deck it knows', async () => {
    const main = await openWindow();
    const old = main.createDeck('Old', [card('a', { images: { front: [picture(7)], back: [] } })]);
    await main.flushDecks();
    // The other window made a deck with the same picture; this window hasn't read it back yet.
    const split = await splitPictures({
      id: 'other',
      name: 'Other',
      cards: [card('b', { images: { front: [picture(7)], back: [] } })],
    });
    shared.items.set(deckName('other'), JSON.stringify({ version: 1, at: 2, deck: split.deck }));
    main.removeDeck(old.id);
    await main.flushDecks();
    const [hash] = split.pictures.keys();
    expect(shared.items.has(pictureName(hash!))).toBe(true);
    expect((await openWindow()).deckById('other')?.cards[0]?.images?.front[0]).toBe(picture(7));
  });

  it('put back a picture another window removed while this window still shows it', async () => {
    const main = await openWindow();
    const deck = main.createDeck('Mine', [card('a', { images: { front: [picture(8)], back: [] } })]);
    await main.flushDecks();
    for (const name of [...shared.items.keys()]) if (name.startsWith('study.picture.')) shared.items.delete(name);
    main.changeDeck(deck.id, (current) => ({ ...current, name: 'Renamed' }));
    await main.flushDecks();
    expect((await openWindow()).deckById(deck.id)?.cards[0]?.images?.front[0]).toBe(picture(8));
  });

  it('take in a deck another window wrote only after their own write of it, so both end up the same', async () => {
    const main = await openWindow();
    const deck = main.createDeck('Start', [card('a')]);
    await main.flushDecks();
    let open = () => {};
    shared.gate = new Promise<void>((resolve) => (open = resolve));
    main.changeDeck(deck.id, (old) => ({ ...old, name: 'Main' }));
    await tick();
    // Another window's version lands in the store and is announced while this window's write is under way.
    shared.items.set(deckName(deck.id), JSON.stringify({ version: 1, at: 1, deck: { ...deck, name: 'Other' } }));
    const other = new BroadcastChannel('opennote.study');
    other.postMessage({ kind: 'deck', id: deck.id });
    await tick();
    shared.gate = null;
    open();
    await main.flushDecks();
    await tick();
    await main.flushDecks();
    other.close();
    const stored = (JSON.parse(shared.items.get(deckName(deck.id))!) as { deck: { name: string } }).deck.name;
    expect(main.deckById(deck.id)?.name).toBe(stored);
  });
});
