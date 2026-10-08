// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Exam } from '../upcoming';
import { examsStore, setExams } from './upcomingStores';

describe('the Upcoming lists in two windows', () => {
  it('take in what another window saves, so the next save keeps it', () => {
    const exam = (id: string) => ({ id, title: id, date: '2026-12-01' }) as unknown as Exam;
    setExams([exam('mine')]);
    // A popped-out Upcoming window saves its own exam: this window hears of it through the storage event.
    const theirs = JSON.stringify([exam('mine'), exam('theirs')]);
    localStorage.setItem('opennote.tools.exams', theirs);
    window.dispatchEvent(new StorageEvent('storage', { key: 'opennote.tools.exams', newValue: theirs }));
    expect(examsStore.get().map((one) => one.id)).toEqual(['mine', 'theirs']);
    setExams([...examsStore.get(), exam('later')]);
    expect((JSON.parse(localStorage.getItem('opennote.tools.exams')!) as Exam[]).map((one) => one.id)).toEqual([
      'mine',
      'theirs',
      'later',
    ]);
  });
});
