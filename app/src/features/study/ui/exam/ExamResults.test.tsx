// The results page. A blank the app marked wrong for a plural can be given its mark by the person, with the app's
// mark kept beside it. A paper handed in after the time ran out says how late it was.
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import { resultsMarkdown } from '../../exam/paper';
import type { Exam } from '../../exam/types';
import { DEFAULT_SETTINGS } from '../../exam/types';
import { ExamResults } from './ExamResults';

const exam: Exam = {
  id: 'e1',
  title: 'Cells',
  created: '2026-10-29T00:00:00.000Z',
  settings: { ...DEFAULT_SETTINGS, minutes: 10 },
  engine: 'rules',
  questions: [
    {
      id: 'f',
      kind: 'fill',
      prompt: 'Energy is released in the {{mitochondria}}.',
      marks: 1,
      answer: 'mitochondria',
      guide: [],
      source: { pageId: 'p1', title: 'Cells', topic: 'Organelles' },
    },
  ],
};

describe('ExamResults', () => {
  it('lets the person change a mark the app gave, and says how late the paper was', async () => {
    const { container } = renderUi(
      <ExamResults
        exam={exam}
        answers={{ f: { blanks: ['mitochondrion'] } }}
        late={200_000}
        notebookId={null}
        onAgain={() => {}}
      />,
    );
    // The singular does not match the key's word, so the app gives nothing.
    expect(await screen.findByRole('heading', { name: 'Score: 0 of 1 marks (0 percent)' })).toBeTruthy();
    expect(screen.getByText('Submitted 3:20 after the time ran out.')).toBeTruthy();
    expect(screen.getByText('Marked by OpenNote.')).toBeTruthy();
    await expectNoAxeViolations(container);

    await userEvent.click(screen.getByRole('button', { name: 'Change this mark' }));
    const zero = screen.getByLabelText('0 of 1');
    expect((zero as HTMLInputElement).checked).toBe(true);
    expect(document.activeElement).toBe(zero);
    await userEvent.click(screen.getByLabelText('1 of 1'));
    expect(screen.getByRole('heading', { name: 'Score: 1 of 1 marks (100 percent)' })).toBeTruthy();
    expect(screen.getByText('OpenNote gave 0 of 1. You changed it.')).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('writes the lateness on the saved results, and nothing when in time', () => {
    const marks = { f: { id: 'f', got: 1, of: 1, auto: false, status: 'right' as const } };
    expect(resultsMarkdown(exam, {}, marks, 65_000)).toContain('Submitted 1:05 after the time ran out.');
    expect(resultsMarkdown(exam, {}, marks)).not.toContain('after the time ran out');
  });
});
