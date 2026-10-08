// A reminder is the person's choice for each item of Upcoming, a task in the list or a line read from a page.
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderUi } from '../../../test';
import { Groups } from './UpcomingList';
import { UpcomingTool } from './UpcomingTool';
import { loadStored } from './storage';
import { pageItemsStore, readReminders } from './upcomingStores';

beforeEach(() => {
  localStorage.clear();
  // Windows allows notifications, so turning a reminder on does not ask.
  vi.stubGlobal(
    'Notification',
    Object.assign(function Notification() {}, { permission: 'granted' }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  pageItemsStore.set({});
});

describe('a reminder for each item', () => {
  it('turns on for a task in the list, and the task keeps the choice', async () => {
    renderUi(<UpcomingTool />);
    await userEvent.fill(screen.getByLabelText('Task and when it is due'), 'Read chapter 4 in 3 days');
    await userEvent.click(screen.getByRole('button', { name: 'Add a task' }));
    const button = screen.getByRole('button', { name: 'Remind me about Read chapter 4' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(button);
    await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'));
    expect(loadStored<{ items: { remind?: boolean }[] }>('upcoming', { items: [] }).items[0].remind).toBe(true);
    await userEvent.click(button);
    await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('false'));
  });

  it('is offered for a line read from a page and kept under the page and its words', async () => {
    const item = {
      id: 'page:p1:b1:2',
      title: 'Hand in the lab report',
      due: { date: { year: 2999, month: 5, day: 1 }, time: null },
      done: false,
      page: { id: 'p1', title: 'Biology notes', block: 'b1', line: 2 },
    };
    const groups = { overdue: [], today: [], thisWeek: [], later: [item], undated: [] };
    renderUi(
      <Groups
        groups={groups}
        shown={['later']}
        onChange={() => undefined}
        onSkip={() => undefined}
        onCheckPage={() => undefined}
        onNote={() => undefined}
      />,
    );
    const button = screen.getByRole('button', { name: 'Remind me about Hand in the lab report' });
    await userEvent.click(button);
    await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'));
    expect(readReminders().pageLines).toEqual(['page:p1:hand in the lab report']);
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
  });
});
