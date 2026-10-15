// @vitest-environment jsdom
// The decks are mirrored into the profile's qol.json and restored from it when the web view's storage is empty.
import { afterEach, describe, expect, it, vi } from 'vitest';

const profile: { prefs: Record<string, unknown> } = { prefs: {} };
vi.mock('../../qol', () => ({
  readPrefs: () => Promise.resolve(profile.prefs),
  writePrefs: (patch: Record<string, unknown>) => {
    profile.prefs = { ...profile.prefs, ...patch };
    return Promise.resolve(profile.prefs);
  },
}));

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  vi.resetModules();
});

describe('the deck profile mirror', () => {
  it('writes the decks to the profile after a change', async () => {
    vi.useFakeTimers();
    profile.prefs = {};
    const library = await import('./library');
    library.createDeck('Mirrored');
    await vi.advanceTimersByTimeAsync(300);
    const decks = profile.prefs.studyDecks as { name: string }[];
    expect(decks.map((deck) => deck.name)).toEqual(['Mirrored']);
  });

  it('restores the decks when browser storage has none', async () => {
    localStorage.clear();
    profile.prefs = { studyDecks: [{ id: 'dR', name: 'Restored', cards: [] }], studyStates: {} };
    const library = await import('./library');
    await vi.waitFor(() => expect(library.decksStore.get().map((deck) => deck.name)).toEqual(['Restored']));
    expect(localStorage.getItem('opennote.study.decks')).toContain('Restored');
  });
});
