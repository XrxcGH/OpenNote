import { describe, expect, it } from 'vitest';
import { arrange, HOME_SECTIONS, moved } from './layout';

describe('Home sections', () => {
  it('shows every section in the default order', () => {
    expect(arrange(undefined)).toEqual({ shown: [...HOME_SECTIONS], hidden: [] });
  });

  it('follows the saved order and puts sections it does not know at the end', () => {
    const { shown } = arrange({ order: ['saved', 'recent', 'gone'] });
    expect(shown.slice(0, 2)).toEqual(['saved', 'recent']);
    expect(shown).toHaveLength(HOME_SECTIONS.length);
    expect(shown).not.toContain('gone');
  });

  it('splits off the hidden sections', () => {
    const { shown, hidden } = arrange({ hidden: ['today', 'nope'] });
    expect(hidden).toEqual(['today']);
    expect(shown).not.toContain('today');
  });

  it('moves a section one step and stops at the ends', () => {
    expect(moved(['recent', 'pinned', 'today'], 'pinned', -1)).toEqual(['pinned', 'recent', 'today']);
    expect(moved(['recent', 'pinned', 'today'], 'recent', -1)).toEqual(['recent', 'pinned', 'today']);
    expect(moved(['recent', 'pinned', 'today'], 'today', 1)).toEqual(['recent', 'pinned', 'today']);
  });
});
