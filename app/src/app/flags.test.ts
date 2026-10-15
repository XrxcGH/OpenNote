import { afterEach, describe, expect, it } from 'vitest';
import { resetStores } from '../state/store';
import { initFlags, isEnabled, withEnabledFlags } from './flags';

afterEach(() => resetStores());

describe('flags', () => {
  it('follow the channel defaults', () => {
    initFlags('dev');
    expect(isEnabled('trash.view')).toBe(true);
    initFlags('beta');
    expect(isEnabled('trash.view')).toBe(true);
    initFlags('stable');
    expect(isEnabled('trash.view')).toBe(false);
    expect(isEnabled('notes.sectionGroups')).toBe(true);
    expect(isEnabled('updates.betaChannel')).toBe(false);
  });

  it('keep notes on disk on every channel', () => {
    for (const channel of ['dev', 'nightly', 'beta', 'stable'] as const) {
      initFlags(channel);
      expect(isEnabled('storage.core')).toBe(true);
    }
  });

  it('give Beta testers the typed-notes editor, and keep it out of Stable', () => {
    initFlags('beta');
    expect(isEnabled('page.editor')).toBe(true);
    initFlags('stable');
    expect(isEnabled('page.editor')).toBe(false);
  });

  it('take overrides in development and nightly builds only, the later ones winning', () => {
    initFlags('nightly', { 'storage.core': true }, { 'storage.core': false, 'trash.view': false });
    expect(isEnabled('storage.core')).toBe(false);
    expect(isEnabled('trash.view')).toBe(false);
    initFlags('beta', { 'settings.penAndInk': true, 'storage.core': false });
    expect(isEnabled('settings.penAndInk')).toBe(false);
    expect(isEnabled('storage.core')).toBe(true);
  });

  it('filter registry items by their flag', () => {
    initFlags('stable');
    const items = [
      { id: 'a' },
      { id: 'b', flag: 'trash.view' as const },
      { id: 'c', flag: 'notes.sectionGroups' as const },
    ];
    expect(withEnabledFlags(items).map((item) => item.id)).toEqual(['a', 'c']);
  });
});
