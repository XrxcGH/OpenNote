// The Practice exams window: settings, the paper, taking the exam one question at a time with a flag and a timer,
// and the marking, with the person's own mark for an answer in words.
import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import { examRequest, requestExam } from '../../exam/request';
import { ExamPanel } from './ExamPanel';

const NOTES = [
  '# Organelles',
  'Mitochondria: the organelle that releases energy from glucose in respiration.',
  'Ribosome: the small structure where proteins are made from amino acids.',
  'Nucleus: the part of the cell that holds the genetic material and controls it.',
].join('\n');

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

afterEach(() => examRequest.set(null));

describe('ExamPanel', () => {
  it('says how to start when no notes were chosen', async () => {
    const { container } = renderUi(<ExamPanel />);
    expect(screen.getByRole('button', { name: 'Make a practice exam from this page' })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('makes a timed true or false exam, takes it, and marks it', async () => {
    const { container } = renderUi(<ExamPanel />);
    ask();
    expect(screen.getByText('From 1 page of Cells.')).toBeTruthy();
    await userEvent.fill(screen.getByLabelText('Number of questions'), '3');
    for (const kind of ['Short answer', 'Multiple choice', 'Fill in the blanks', 'Worked problem'])
      await userEvent.click(screen.getByLabelText(kind));
    await userEvent.click(screen.getByLabelText('Time the exam'));
    await userEvent.fill(screen.getByLabelText('Minutes allowed'), '15');
    await expectNoAxeViolations(container);
    await userEvent.click(screen.getByRole('button', { name: 'Make exam' }));
    expect(await screen.findByText('3 questions, 3 marks in all.')).toBeTruthy();
    expect(screen.getByText('Time allowed: 15 minutes.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Start exam' }));

    expect(screen.getByRole('timer').textContent).toMatch(/^Time left: 1[45]:\d\d$/);
    await userEvent.click(screen.getByRole('button', { name: 'Pause timer' }));
    expect(screen.getByRole('button', { name: 'Resume timer' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Question 1 of 3' })).toBeTruthy();
    await userEvent.click(screen.getByLabelText('True'));
    await userEvent.click(screen.getByRole('button', { name: 'Flag for review' }));
    expect(screen.getByRole('button', { name: 'Question 1, answered, flagged for review' })).toBeTruthy();
    await expectNoAxeViolations(container);
    await userEvent.click(screen.getByRole('button', { name: 'Next question' }));
    await userEvent.click(screen.getByLabelText('False'));
    await userEvent.click(screen.getByRole('button', { name: 'Show all questions' }));
    expect(screen.getAllByRole('heading', { name: /^Question \d of 3$/ })).toHaveLength(3);

    await userEvent.click(screen.getByRole('button', { name: 'Submit exam' }));
    // One question has no answer and one is flagged, so the window asks first.
    const dialog = await screen.findByRole('dialog', { name: 'Submit the exam?' });
    expect(dialog.textContent).toContain('1 question has no answer. 1 question is flagged for review.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit exam' }));

    const score = await screen.findByRole('heading', { name: /^Score: \d of 3 marks/ });
    expect(score).toBeTruthy();
    expect(screen.getAllByText('Marked by OpenNote.').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: 'Add missed questions to flashcards' })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('lets the person mark a short answer with the key beside it', async () => {
    renderUi(<ExamPanel />);
    ask();
    await userEvent.fill(screen.getByLabelText('Number of questions'), '1');
    for (const kind of ['Multiple choice', 'Fill in the blanks', 'Worked problem', 'True or false'])
      await userEvent.click(screen.getByLabelText(kind));
    await userEvent.click(screen.getByRole('button', { name: 'Make exam' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Start exam' }));
    await userEvent.fill(screen.getByLabelText('Your answer'), 'It makes energy.');
    await userEvent.click(screen.getByRole('button', { name: 'Submit exam' }));
    expect(
      await screen.findByText('1 question is yours to mark. Compare your answer with the key, then choose a mark.'),
    ).toBeTruthy();
    expect(screen.getByText('It makes energy.')).toBeTruthy();
    await userEvent.click(screen.getByLabelText('2 of 2'));
    expect(screen.getByRole('heading', { name: 'Score: 2 of 2 marks (100 percent)' })).toBeTruthy();
    expect(screen.getByText('No weak topics. Every topic got at least 60 percent of its marks.')).toBeTruthy();
  });

  it('says so when the notes have nothing to ask', async () => {
    renderUi(<ExamPanel />);
    act(() => {
      requestExam({
        scope: 'page',
        title: 'Empty',
        sources: [{ pageId: 'p', title: 'E', text: 'just words' }],
        skipped: 0,
        notebookId: null,
      });
    });
    await userEvent.click(screen.getByRole('button', { name: 'Make exam' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to settings' })).toBeTruthy();
  });
});
