import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { WebUpdater } from '../../platform/web/updater';
import type { UpdaterPhase, UpdaterStatus } from '../../platform/types';
import { getSettings } from '../../state/settings';
import { DEFAULT_UPDATER_STATUS } from '../../state/updater';
import { announcements, expectNoAxeViolations, renderApp } from '../../test';
import UpdatesSection from './UpdatesSection';

const status = (phase: UpdaterPhase, more: Partial<UpdaterStatus> = {}): UpdaterStatus => ({
  ...DEFAULT_UPDATER_STATUS,
  phase,
  ...more,
});
const ready = (version: string, blockedBy: 'recording' | null = null): UpdaterPhase => ({
  kind: 'ready',
  version,
  notes: 'Faster search.',
  blockedBy,
});

async function start(initial: UpdaterStatus, install: 'auto' | 'ask' | 'manual' = 'auto') {
  const app = await renderApp({ boot: { updater: initial }, settings: { updates: { install } } });
  // Start-up focus lands on the tree once it draws. A popover opened before then would lose focus to it.
  await expect.poll(() => document.activeElement?.getAttribute('role')).toBe('treeitem');
  return { ...app, updater: app.platform.updater as WebUpdater };
}

const chip = (name: string) => screen.queryByRole('button', { name });

describe('the update chip', () => {
  it("appears when an update is ready, and doesn't open anything by itself", async () => {
    const { updater } = await start(status({ kind: 'idle' }));
    expect(chip('Update ready')).toBeNull();
    act(() => updater.setStatus(status(ready('0.5.0'))));
    const button = chip('Update ready');
    expect(button?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(announcements()).toContain(
      'Update ready. It installs when you close OpenNote, or choose Restart to update.',
    );
  });

  it('opens the details, restarts to update, and passes axe', async () => {
    const { updater } = await start(status(ready('0.6.0')));
    fireEvent.click(chip('Update ready')!);
    const dialog = screen.getByRole('dialog', { name: 'Update ready' });
    expect(dialog.textContent).toContain('Version 0.6.0 is ready');
    expect(dialog.textContent).toContain('Faster search.');
    await expectNoAxeViolations(dialog);
    fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
    await waitFor(() => expect(updater.calls).toContain('restartToUpdate'));
  });

  it('says why a blocked update waits, and keeps the restart from running', async () => {
    const { updater } = await start(status(ready('0.7.0', 'recording')));
    fireEvent.click(chip('Update ready')!);
    const restart = screen.getByRole('button', { name: 'Restart to update' });
    expect(restart.getAttribute('aria-disabled')).toBe('true');
    expect(restart.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('Finish the recording first.')).toBeTruthy();
    fireEvent.click(restart);
    expect(updater.calls).not.toContain('restartToUpdate');
  });
});

describe('an available update', () => {
  it('offers Download and Skip under "Ask before installing"', async () => {
    const offer: UpdaterPhase = {
      kind: 'available',
      version: '0.8.0',
      notes: '',
      size: 2e7,
      waitingForUnmetered: false,
    };
    const { updater } = await start(status(offer), 'ask');
    fireEvent.click(chip('Update available')!);
    fireEvent.click(screen.getByRole('button', { name: 'Skip this version' }));
    await waitFor(() => expect(updater.calls).toContain('skip 0.8.0'));
    await waitFor(() => expect(chip('Update available')).toBeNull());
  });
});

describe('the Updates section', () => {
  it('explains a copy without an update key and shows no choices', async () => {
    await start(status({ kind: 'disabled', reason: 'noKey' }));
    const { container } = render(<UpdatesSection />);
    expect(screen.getByText(/built without an update key/)).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('checks for updates and saves the install choice', async () => {
    const { updater } = await start(status({ kind: 'idle' }));
    const { container } = render(<UpdatesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByRole('button', { name: 'Checking…' })).toBeTruthy();
    expect(await screen.findByText('OpenNote is up to date.')).toBeTruthy();
    expect(updater.calls).toEqual(['check']);
    fireEvent.click(screen.getByRole('radio', { name: 'Ask before installing' }));
    await waitFor(() => expect(getSettings().updates.install).toBe('ask'));
    await expectNoAxeViolations(container);
  });

  it('installs a skipped version again, and goes back after confirming', async () => {
    const previous = { version: '0.4.0', available: true };
    const { updater } = await start(status({ kind: 'upToDate' }, { skippedVersion: '0.5.0', previous }));
    render(<UpdatesSection />);
    expect(screen.getByText('Version 0.5.0 is skipped.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Install it' }));
    await waitFor(() => expect(updater.calls).toContain('unskip'));
    fireEvent.click(screen.getByRole('button', { name: 'Go back to version 0.4.0' }));
    const dialog = await screen.findByRole('dialog', { name: 'Go back to version 0.4.0?' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Go back' }));
    await waitFor(() => expect(updater.calls).toContain('goBack'));
  });
});
