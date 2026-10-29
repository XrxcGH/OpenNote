// An exam can be attached to a notebook or a section from the form in Upcoming. The choice shows beside the exam.
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { NotesProvider } from '../../../services/notes';
import { createMemoryNotesService } from '../../../services/notes/memory';
import { renderUi } from '../../../test';
import { ExamForm } from './ExamForm';
import { loadExams, setExams } from './upcomingStores';

beforeEach(() => {
  localStorage.clear();
  setExams([]);
});
afterEach(() => setExams([]));

describe('the exam form', () => {
  it('attaches an exam to a section and keeps it', async () => {
    const service = createMemoryNotesService({ seed: 'sample' });
    renderUi(
      <NotesProvider service={service}>
        <ExamForm />
      </NotesProvider>,
    );
    const place = screen.getByRole('combobox', { name: 'For a notebook or section' });
    await waitFor(() => expect(within(place).getAllByRole('option').length).toBeGreaterThan(1));
    await userEvent.fill(screen.getByRole('textbox', { name: 'Exam name' }), 'Midterm');
    await userEvent.fill(screen.getByLabelText('Date'), '2999-05-01');
    await userEvent.selectOptions(place, 's-lectures');
    await userEvent.click(screen.getByRole('button', { name: 'Add exam' }));
    expect(await screen.findByText(/for Biology 101, Lectures/)).toBeTruthy();
    expect(loadExams()[0].target).toMatchObject({ kind: 'section', id: 's-lectures', notebookId: 'n-biology' });
  });
});
