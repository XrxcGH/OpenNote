// Turning a flag off hides the feature it names, in the places the feature shows (study.import, tools.exams,
// tools.timetable). The flags are on in every channel, so each test turns one off with an override.
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initFlags } from '../../../app/flags';
import { renderUi } from '../../../test';
import { DeckPanel } from '../../study';
import { setExams, setTimetable } from './upcomingStores';
import { UpcomingTool } from './UpcomingTool';

beforeEach(() => {
  localStorage.clear();
  setExams([{ id: 'x1', name: 'Chemistry final', date: '2999-01-01', time: '' }]);
  setTimetable([{ id: 'k1', name: 'Organic lab', days: [0, 1, 2, 3, 4, 5, 6], start: '09:00', end: '09:50', room: '' }]);
});
afterEach(() => {
  setExams([]);
  setTimetable([]);
  initFlags('dev');
});

describe('flags that hide a feature', () => {
  it('shows exams and classes while their flags are on', () => {
    initFlags('dev');
    renderUi(<UpcomingTool />);
    expect(screen.getByRole('heading', { name: 'Exams' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Today’s classes' })).toBeTruthy();
  });

  it('hides the exam countdowns when tools.exams is off', () => {
    initFlags('dev', { 'tools.exams': false });
    renderUi(<UpcomingTool />);
    expect(screen.queryByRole('heading', { name: 'Exams' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Today’s classes' })).toBeTruthy();
  });

  it('hides the timetable when tools.timetable is off', () => {
    initFlags('dev', { 'tools.timetable': false });
    renderUi(<UpcomingTool />);
    expect(screen.queryByRole('heading', { name: 'Today’s classes' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Exams' })).toBeTruthy();
  });

  it('hides deck import when study.import is off', () => {
    initFlags('dev');
    const on = renderUi(<DeckPanel />);
    expect(screen.getByRole('button', { name: 'Import cards' })).toBeTruthy();
    on.unmount();
    initFlags('dev', { 'study.import': false });
    renderUi(<DeckPanel />);
    expect(screen.queryByRole('button', { name: 'Import cards' })).toBeNull();
  });
});
