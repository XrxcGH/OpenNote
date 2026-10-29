// The Home page's Upcoming section lists the next due items and opens Upcoming through the real command id.
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { configureCommands } from '../../commands/registry';
import { commands } from '../../registries';
import { createMemoryNotesService } from '../../services/notes/memory';
import { createTestPlatform, renderUi } from '../../test';
import { closeTool, openTools } from '../tools';
import type { UpcomingItem } from '../tools';
import { UpcomingSection } from './UpcomingSection';

const due = (day: number) => ({ date: { year: 2026, month: 10, day }, time: null });
const items: UpcomingItem[] = [
  { id: 'a', title: 'Read chapter 4', due: due(3), done: false },
  { id: 'b', title: 'Lab report', due: due(5), done: false },
];

beforeEach(() =>
  configureCommands({ platform: createTestPlatform(), notes: createMemoryNotesService({ seed: 'sample' }) }),
);
afterEach(() => closeTool('upcoming'));

describe('the Upcoming section on Home', () => {
  it('uses the real tools.upcoming command', () => {
    expect(commands.get('tools.upcoming')).toBeDefined();
  });

  it('lists the next items and opens the Upcoming window', async () => {
    renderUi(<UpcomingSection load={async () => items} />);
    const list = await screen.findByRole('list', { name: 'Next due' });
    expect(list.textContent).toContain('Read chapter 4');
    expect(list.textContent).toContain('Lab report');
    await userEvent.click(screen.getByRole('button', { name: 'Open Upcoming' }));
    await waitFor(() => expect(openTools()).toContain('upcoming'));
  });

  it('says plainly when nothing is due', async () => {
    renderUi(<UpcomingSection load={async () => []} />);
    expect(await screen.findByText(/Nothing is due/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Upcoming' })).toBeTruthy();
  });
});
