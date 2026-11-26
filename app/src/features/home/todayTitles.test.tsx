import { describe, expect, it } from 'vitest';
import { noteTitle, toYmd } from '../daily';
import { todayTitles } from './HomeView';

describe('todayTitles', () => {
  it('finds the note the Today button makes, by its daily notes title', () => {
    const day = new Date(2026, 9, 31);
    expect(todayTitles(day)[0]).toBe('2026-10-31');
    expect(todayTitles(day)).toContain(noteTitle('day', toYmd(day)));
  });
});
