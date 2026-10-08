import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 });
import type { DeckFiles } from './deckFiles';
import type { Card } from './types';

const shared = vi.hoisted(() => ({
  items: new Map<string, string>(),
  failPuts: false,
  toasts: [] as { message: string; tone?: string }[],
}));

vi.mock('../../intel', () => ({
  deviceStore: (): Promise<DeckFiles> =>
    Promise.resolve({
      get: (name) => Promise.resolve(shared.items.get(name) ?? null),
      put: (name, text) => {
        if (shared.failPuts) return Promise.reject(new Error('The disk is full.'));
        shared.items.set(name, text);
        return Promise.resolve();
      },
      remove: (name) => Promise.resolve(void shared.items.delete(name)),
      list: (prefix) => Promise.resolve([...shared.items.keys()].filter((name) => name.startsWith(prefix)).sort()),
    }),
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
  shared.toasts.length = 0;
  vi.stubGlobal('localStorage', new MemoryStorage());
});
afterEach(() => vi.unstubAllGlobals());

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

  it('keeps the old decks in the browser storage when moving them fails', async () => {
    localStorage.setItem('opennote.study.decks', JSON.stringify([{ id: 'd1', name: 'Old', cards: [] }]));
    shared.failPuts = true;
    await openWindow();
    expect(localStorage.getItem('opennote.study.decks')).not.toBeNull();
    expect(shared.toasts).toHaveLength(1);
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
});
