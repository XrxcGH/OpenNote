// The live session recorder: keys and buttons log behaviors against the running clock, a state's second press
// stops it, and Finish sets the session length.
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import Recorder from './Recorder';

const texts: Record<string, string> = { mode: 'session', ethogram: 'rest | state | a\nfeed | state | a\ncall | event' };
const set: Record<string, string> = {};
const setText = (id: string, text: string) => {
  set[id] = text;
};
afterEach(() => {
  for (const key of Object.keys(set)) delete set[key];
});

describe('the session recorder', () => {
  it('logs presses in time order and stops a running state', async () => {
    renderUi(<Recorder texts={texts} setText={setText} />);
    expect((screen.getByRole('button', { name: 'rest (1)' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await userEvent.click(screen.getByRole('button', { name: 'rest (1)' }));
    await userEvent.keyboard('3');
    await userEvent.click(screen.getByRole('button', { name: 'feed (2)' }));
    expect(screen.getByRole('button', { name: 'feed (2)' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'rest (1)' }).getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(screen.getByRole('button', { name: 'feed (2)' }));
    const lines = set.log.split('\n');
    expect(lines.map((l) => l.replace(/^[\d.]+ \| /, ''))).toEqual(['rest', 'call', 'feed', 'feed | stop']);
    const times = lines.map((l) => Number(l.split(' | ')[0]));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    await userEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(Number(set.session)).toBeGreaterThanOrEqual(1));
    await expectNoAxeViolations(screen.getByRole('region', { name: 'Record a session' }));
  });

  it('shows nothing outside the session modes', () => {
    renderUi(<Recorder texts={{ ...texts, mode: 'singleCase' }} setText={setText} />);
    expect(screen.queryByRole('region', { name: 'Record a session' })).toBeNull();
  });
});
