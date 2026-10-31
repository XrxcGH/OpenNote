// An exam in progress survives the window going away: the answers, the flag, and the timer come back, with running
// time counted and paused time not. The ready screen says the key waits for the results, and a math answer whose key
// has a unit asks for it. The kept attempt holds the paper only; the key comes back at hand-in, and a saved exam
// can be retaken as a fresh copy.
import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderUi } from '../../../../test';
import { loadAttempts } from '../../exam/attempt';
import { examRequest, requestExam, requestRetake } from '../../exam/request';
import type { Exam } from '../../exam/types';
import { DEFAULT_SETTINGS } from '../../exam/types';
import { ExamPanel } from './ExamPanel';
import { ExamTake } from './ExamTake';

const NOTES = [
  '# Organelles',
  'Mitochondria: the organelle that releases energy from glucose in respiration.',
  'Ribosome: the small structure where proteins are made from amino acids.',
].join('\n');
const MINUTE = 60_000;
const CARRY_ON = 'Carry on with Practice exam: Cells';
const UNIT_HINT = 'Include the unit. A right number without its unit loses a mark.';

/** A fake wall clock: the timer reads Date.now, so moving it stands in for time passing while the app is closed. */
function fakeClock() {
  const clock = { now: Date.UTC(2026, 9, 29, 9, 0, 0) };
  vi.spyOn(Date, 'now').mockImplementation(() => clock.now);
  return clock;
}

function ask(): void {
  act(() => {
    requestExam({
      scope: 'page',
      title: 'Cells',
      sources: [{ pageId: 'p1', title: 'Cells', text: NOTES }],
      skipped: 0,
      notebookId: null,
    });
  });
}

/** Makes and starts a one-question true or false exam with 15 minutes. */
async function startTimedExam(): Promise<void> {
  ask();
  await userEvent.fill(screen.getByLabelText('Number of questions'), '1');
  for (const kind of ['Short answer', 'Multiple choice', 'Fill in the blanks', 'Worked problem'])
    await userEvent.click(screen.getByLabelText(kind));
  await userEvent.click(screen.getByLabelText('Time the exam'));
  await userEvent.fill(screen.getByLabelText('Minutes allowed'), '15');
  await userEvent.click(screen.getByRole('button', { name: 'Make exam' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Start exam' }));
}

async function submitAll(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'Submit exam' }));
  const dialog = await screen.findByRole('dialog', { name: 'Submit the exam?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Submit exam' }));
  await screen.findByRole('heading', { name: /^Score: / });
}

const unitExam = (): Exam => {
  const source = { pageId: 'p', title: 'Motion', topic: 'Speed' };
  return {
    id: 'units',
    title: 'Units',
    created: '2026-10-29T09:00:00.000Z',
    settings: { ...DEFAULT_SETTINGS, minutes: null },
    questions: [
      { id: 'q1', kind: 'short', prompt: 'How far?', marks: 1, answer: '5 m', guide: [], math: true, source },
      { id: 'q2', kind: 'short', prompt: 'Simplify.', marks: 1, answer: '2x + 2', guide: [], math: true, source },
    ],
    engine: 'rules',
  };
};

afterEach(() => {
  act(() => examRequest.set(null));
  vi.restoreAllMocks();
  for (const key of Object.keys(localStorage)) if (key.startsWith('opennote.study.exam.')) localStorage.removeItem(key);
});

describe('an exam in progress', () => {
  it('comes back after a remount with running time counted, then paused time kept, until submitted', async () => {
    const clock = fakeClock();
    const first = renderUi(<ExamPanel />);
    await startTimedExam();
    expect(screen.getByRole('timer').textContent).toBe('Time left: 15:00');
    await userEvent.click(screen.getByLabelText('True'));
    await userEvent.click(screen.getByRole('button', { name: 'Flag for review' }));
    // Closed with the timer running after 2 minutes, and opened 3 minutes later: 15 - 2 - 3 = 10 minutes left.
    clock.now += 2 * MINUTE;
    first.unmount();
    act(() => examRequest.set(null));
    clock.now += 3 * MINUTE;
    const second = renderUi(<ExamPanel />);
    expect(screen.getByRole('heading', { name: 'Unfinished exams' })).toBeTruthy();
    expect(screen.getByText(/1 of 1 answered\. Timer running, 10:00 left\./)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: CARRY_ON }));
    expect(screen.getByRole('timer').textContent).toBe('Time left: 10:00');
    expect((screen.getByLabelText('True') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Remove flag' }).getAttribute('aria-pressed')).toBe('true');
    // Paused, then closed for an hour: still 10 minutes left.
    await userEvent.click(screen.getByRole('button', { name: 'Pause timer' }));
    second.unmount();
    clock.now += 60 * MINUTE;
    const third = renderUi(<ExamPanel />);
    expect(screen.getByText(/Timer paused with 10:00 left\./)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: CARRY_ON }));
    expect(screen.getByRole('timer').textContent).toBe('Time left: 10:00');
    await submitAll();
    third.unmount();
    renderUi(<ExamPanel />);
    expect(screen.queryByRole('heading', { name: 'Unfinished exams' })).toBeNull();
  });
});

describe('the key and the unit', () => {
  it('says the answer key waits for the results', async () => {
    renderUi(<ExamPanel />);
    ask();
    await userEvent.click(screen.getByRole('button', { name: 'Make exam' }));
    expect(await screen.findByText('The answer key is saved with your results, after you submit.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save the blank paper as a page' })).toBeTruthy();
  });

  it('asks for the unit on a math answer whose key has one, and not on one without', async () => {
    renderUi(<ExamTake exam={unitExam()} attempt={null} notebookId={null} onSubmit={() => undefined} />);
    expect(screen.getByText(UNIT_HINT)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Next question' }));
    expect(screen.getByRole('heading', { name: 'Question 2 of 2' })).toBeTruthy();
    expect(screen.queryByText(UNIT_HINT)).toBeNull();
  });
});

describe('the key kept apart', () => {
  it('keeps no key in storage mid-exam, still asks for the unit after a remount, and marks with the whole key', async () => {
    const first = renderUi(<ExamTake exam={unitExam()} attempt={null} notebookId={null} onSubmit={() => undefined} />);
    await userEvent.fill(screen.getByRole('textbox'), 'five');
    first.unmount();
    const stored = Object.keys(localStorage)
      .filter((key) => key.startsWith('opennote.study.exam.'))
      .map((key) => localStorage.getItem(key))
      .join(' ');
    expect(stored).toContain('five');
    expect(stored).not.toContain('5 m');
    expect(stored).not.toContain('2x + 2');

    const [kept] = loadAttempts();
    expect(kept?.exam.questions.map((one) => one.answer)).toEqual(['', '']);
    const onSubmit = vi.fn();
    renderUi(<ExamTake exam={kept!.exam} attempt={kept!} notebookId={null} onSubmit={onSubmit} />);
    expect(screen.getByText(UNIT_HINT)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Submit exam' }));
    const dialog = await screen.findByRole('dialog', { name: 'Submit the exam?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit exam' }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [answers, , whole] = onSubmit.mock.calls[0] as [Record<string, { text?: string }>, unknown, Exam];
    expect(answers.q1?.text).toBe('five');
    expect(whole).toEqual(unitExam());
    expect(loadAttempts()).toEqual([]);
  });
});

describe('a retake', () => {
  it('opens a saved exam as a fresh copy, ready to start, and the results offer it again', async () => {
    renderUi(<ExamPanel />);
    act(() => void requestRetake(unitExam(), null));
    expect(await screen.findByRole('heading', { name: 'Units' })).toBeTruthy();
    expect(screen.getByText('2 questions, 2 marks in all.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Start exam' }));
    expect(screen.getByRole('heading', { name: 'Question 1 of 2' })).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement | HTMLInputElement).value).toBe('');
    await userEvent.fill(screen.getByRole('textbox'), '5 m');
    await userEvent.click(screen.getByRole('button', { name: 'Submit exam' }));
    const dialog = await screen.findByRole('dialog', { name: 'Submit the exam?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit exam' }));
    await screen.findByRole('heading', { name: /^Score: / });
    await userEvent.click(screen.getByRole('button', { name: 'Take this exam again' }));
    expect(await screen.findByRole('button', { name: 'Start exam' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Units' })).toBeTruthy();
  });
});
