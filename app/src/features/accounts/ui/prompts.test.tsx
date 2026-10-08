// The two questions the account commands ask: which one, and what to type. They are dialogs that resolve with the
// answer or null, and they work from the keyboard.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test';
import { askText, pickOne } from './prompts';

afterEach(cleanup);

const choices = [
  { id: 'a', label: 'Standup', detail: 'Today, 10:00 AM', value: 1 },
  { id: 'b', label: 'Design review', detail: 'Tomorrow, 2:00 PM', value: 2 },
];

describe('pickOne', () => {
  it('resolves with the value of the chosen item, and the first item is chosen at the start', async () => {
    const first = pickOne({ title: 'Which meeting?', choices, confirmLabel: 'Make the note' });
    const dialog = await screen.findByRole('dialog', { name: 'Which meeting?' });
    expect(screen.getByRole('radio', { name: /Standup/ }).getAttribute('aria-checked')).toBe('true');
    await expectNoAxeViolations(dialog);
    fireEvent.click(screen.getByRole('button', { name: 'Make the note' }));
    expect(await first).toBe(1);

    const second = pickOne({ title: 'Which meeting?', choices, confirmLabel: 'Make the note' });
    await screen.findByRole('dialog', { name: 'Which meeting?' });
    fireEvent.keyDown(screen.getByRole('radio', { name: /Standup/ }), { key: 'ArrowDown' });
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /Design review/ }).getAttribute('aria-checked')).toBe('true'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Make the note' }));
    expect(await second).toBe(2);
  });

  it('resolves null on Cancel, and says so instead of offering a choice when there is nothing to choose', async () => {
    const none = pickOne({
      title: 'Which meeting?',
      choices: [],
      confirmLabel: 'Make the note',
      empty: 'Nothing here.',
    });
    await screen.findByText('Nothing here.');
    expect(screen.queryByRole('button', { name: 'Make the note' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await none).toBeNull();
  });
});

describe('askText', () => {
  it('resolves with the trimmed text, and null when it is left empty', async () => {
    const typed = askText({ title: 'Name it', label: 'Name', confirmLabel: 'Save' });
    const field = await screen.findByRole('textbox', { name: 'Name' });
    fireEvent.change(field, { target: { value: '  Biology  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await typed).toBe('Biology');

    const empty = askText({ title: 'Name it', label: 'Name', confirmLabel: 'Save' });
    await screen.findByRole('textbox', { name: 'Name' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await empty).toBeNull();
  });
});
