// Upcoming's week and month views, repeating to-dos typed in words, and a class that opens its section. A recording is
// never asked for here: the Record button is only checked to be there.
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderUi } from '../../../test';
import { UpcomingTool } from './UpcomingTool';
import { ClassButtons } from './ClassButtons';
import { loadStored } from './storage';
import { pageItemsStore } from './upcomingStores';

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  pageItemsStore.set({});
});

async function addTask(text: string) {
  await userEvent.fill(screen.getByLabelText('Task and when it is due'), text);
  await userEvent.click(screen.getByRole('button', { name: 'Add a task' }));
}

const saved = () =>
  loadStored<{ items: { title: string; done: boolean; repeat?: { unit: string } }[] }>('upcoming', { items: [] });

describe('the week and month views', () => {
  it('show the number due on each day, list the chosen day, and check an item off', async () => {
    renderUi(<UpcomingTool />);
    await addTask('Read chapter 4 today');
    await userEvent.click(screen.getByRole('tab', { name: 'Week' }));
    const grid = screen.getByRole('grid', { name: /^Week of/ });
    expect(within(grid).getAllByRole('gridcell')).toHaveLength(7);
    const today = within(grid).getByRole('gridcell', { name: /1 item, today/ });
    await userEvent.click(today);
    const box = screen.getByRole('checkbox', { name: 'Done: Read chapter 4' });
    await userEvent.click(box);
    await waitFor(() => expect(saved().items[0].done).toBe(true));
  });

  it('move the chosen day with the arrow keys and page through the months', async () => {
    renderUi(<UpcomingTool />);
    await userEvent.click(screen.getByRole('tab', { name: 'Month' }));
    const grid = screen.getByRole('grid');
    expect(within(grid).getAllByRole('gridcell')).toHaveLength(42);
    const first = within(grid)
      .getAllByRole('gridcell')
      .find((cell) => cell.getAttribute('aria-selected') === 'true')!;
    first.focus();
    await userEvent.keyboard('{ArrowRight}');
    const second = within(grid)
      .getAllByRole('gridcell')
      .find((cell) => cell.getAttribute('aria-selected') === 'true')!;
    expect(second.dataset.key).not.toBe(first.dataset.key);
    expect(document.activeElement).toBe(second);
    const before = screen.getByRole('heading', { name: /\d{4}$/ }).textContent;
    await userEvent.keyboard('{PageDown}');
    await waitFor(() => expect(screen.getByRole('heading', { name: /\d{4}$/ }).textContent).not.toBe(before));
  });

  it('say when nothing is due on the chosen day', async () => {
    renderUi(<UpcomingTool />);
    await userEvent.click(screen.getByRole('tab', { name: 'Week' }));
    expect(screen.getByText('Nothing is due on this day.')).toBeTruthy();
  });
});

describe('a repeat typed in words', () => {
  it('sets the repeat, takes the words out of the title, and says how it repeats', async () => {
    renderUi(<UpcomingTool />);
    await addTask('Stand-up every weekday');
    expect(saved().items[0]).toMatchObject({ title: 'Stand-up', repeat: { unit: 'weekday' } });
    expect(screen.getByText('(repeats every weekday)')).toBeTruthy();
  });
});

describe('a class with a section', () => {
  const slot = {
    id: 'k1',
    name: 'Biology 101',
    days: [0, 1, 2, 3, 4, 5, 6] as never,
    start: '09:00',
    end: '09:50',
    room: 'Hall B',
  };

  it('offers Open class and Record only when it has a section', () => {
    const date = { year: 2026, month: 10, day: 7 };
    const { rerender } = renderUi(<ClassButtons slot={slot} date={date} />);
    expect(screen.queryByRole('button', { name: /Record/ })).toBeNull();
    rerender(
      <ClassButtons
        slot={{ ...slot, section: { id: 's1', label: 'Biology, Lectures', notebookId: 'n1' } }}
        date={date}
      />,
    );
    expect(screen.getByRole('button', { name: 'Open the page for Biology 101' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record Biology 101' })).toBeTruthy();
  });
});
