// Lock entry (A2-17): locking asks first and sends the lock with this PC's name; a locked page shows its stamp,
// stays read-only, and unlocks only with a reason, which names the locked version in page history.
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { resetFakeShell, setFakeShell } from '../../platform/shellqol';
import { pressChord, renderApp } from '../../test';
import { readingLock, shownQueue } from '../page';
import type { MountedPage } from '../page';
import { attachEntryLock, entryLockState, isLab, lockEntry, readLock, unlockEntry } from './entryLock';

const LOCK = { lockedAt: '2026-10-14T09:30:00.000Z', by: 'Lab PC', hash: 'sha256:ab' };

function fakePage(view: Record<string, unknown>) {
  const sent: unknown[] = [];
  const named: Array<[string, string | null, boolean]> = [];
  const viewport = document.createElement('div');
  document.body.append(viewport);
  const mounted = {
    viewport: { viewport },
    page: {
      id: '01m3sa12426sg32pmtyffjaqcf',
      readOnly: false,
      initial: { view },
      history: {
        list: async () => [
          { revision: 'r2', savedAt: LOCK.lockedAt, reason: 'closed', device: '', name: null, keep: false },
        ],
        name: async (revision: string, name: string | null, keep: boolean) => {
          named.push([revision, name, keep]);
        },
      },
    },
  } as unknown as MountedPage;
  const queue = {
    canUndo: () => false,
    canRedo: () => false,
    onUndoState: () => () => undefined,
    send: async (batch: { edits: unknown[] }) => {
      sent.push(...batch.edits);
      return { seq: 1, orderKeys: {}, canUndo: true, canRedo: false };
    },
  };
  shownQueue.set(queue as never);
  return { mounted, viewport, sent, named };
}

afterEach(async () => {
  for (let i = 0; i < 3 && document.querySelector('[role="dialog"]'); i += 1) await pressChord('Escape');
  shownQueue.set(null);
  entryLockState.set(null);
  readingLock.set(false);
  resetFakeShell();
});

describe('lock records', () => {
  it('reads a lock and the Lab notebook layout from a page view', () => {
    expect(readLock({ entryLock: LOCK })).toEqual(LOCK);
    expect(readLock({ entryLock: null })).toBeNull();
    expect(readLock({})).toBeNull();
    expect(isLab({ background: { drawing: { id: 'builtin-lab-notebook' } } })).toBe(true);
    expect(isLab({ background: { pattern: 'ruled' } })).toBe(false);
  });
});

describe('Lock entry', () => {
  it('shows the stamp on a locked page and keeps it read-only', async () => {
    await renderApp();
    const { mounted } = fakePage({ entryLock: LOCK });
    const stop = attachEntryLock(mounted);
    const region = await screen.findByRole('region', { name: 'Entry lock' });
    expect(within(region).getByText(/^Locked entry, .+, on Lab PC$/)).toBeTruthy();
    expect(within(region).getByText("Read-only in OpenNote. It isn't tamper-proof.")).toBeTruthy();
    expect(readingLock.get()).toBe(true);
    stop();
    expect(readingLock.get()).toBe(false);
  });

  it('says the entry is locked when someone types into it, once for a burst of keys', async () => {
    await renderApp();
    const { mounted, viewport } = fakePage({ entryLock: LOCK });
    const stop = attachEntryLock(mounted);
    const key = (init: KeyboardEventInit) =>
      viewport.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
    key({ key: 'c', ctrlKey: true });
    expect(screen.queryByText('This entry is locked. Unlock it to make changes.')).toBeNull();
    key({ key: 'a' });
    key({ key: 'b' });
    expect(await screen.findAllByText('This entry is locked. Unlock it to make changes.')).toHaveLength(1);
    stop();
  });

  it('asks before locking and sends the lock with the PC name', async () => {
    setFakeShell((name) => (name === 'lock.device' ? { label: 'Lab PC' } : null));
    await renderApp();
    const { mounted, sent } = fakePage({ background: { drawing: { id: 'builtin-lab-notebook' } } });
    attachEntryLock(mounted);
    expect(await screen.findByRole('button', { name: 'Lock entry' })).toBeTruthy();
    const locking = lockEntry();
    const dialog = await screen.findByRole('dialog', { name: 'Lock this entry?' });
    expect(within(dialog).getByText(/isn't tamper-proof/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lock entry' }));
    expect(await locking).toBe(true);
    expect(sent).toEqual([{ edit: 'setPage', view: { entryLock: { by: 'Lab PC' } } }]);
    expect(entryLockState.get()?.lock).not.toBeNull();
    expect(readingLock.get()).toBe(true);
    expect(await screen.findByRole('button', { name: 'Unlock entry…' })).toBeTruthy();
  });

  it('unlocks only with a reason, which names the locked version in history', async () => {
    await renderApp();
    const { mounted, sent, named } = fakePage({ entryLock: LOCK });
    attachEntryLock(mounted);
    const unlocking = unlockEntry();
    const dialog = await screen.findByRole('dialog', { name: 'Unlock this entry?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unlock' }));
    expect(await within(dialog).findByText('Write a reason to unlock the entry.')).toBeTruthy();
    expect(sent).toEqual([]);
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Fixed a typo in sample 4');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unlock' }));
    expect(await unlocking).toBe(true);
    expect(named).toHaveLength(1);
    expect(named[0][0]).toBe('r2');
    expect(named[0][1]).toMatch(/^Locked entry, .+\. Unlocked: Fixed a typo in sample 4$/);
    expect(named[0][2]).toBe(true);
    expect(sent).toEqual([{ edit: 'setPage', view: { entryLock: null } }]);
    expect(readingLock.get()).toBe(false);
  });

  it('keeps the entry locked when unlocking is canceled', async () => {
    await renderApp();
    const { mounted, sent } = fakePage({ entryLock: LOCK });
    attachEntryLock(mounted);
    const unlocking = unlockEntry();
    const dialog = await screen.findByRole('dialog', { name: 'Unlock this entry?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await unlocking).toBe(false);
    expect(sent).toEqual([]);
    expect(readingLock.get()).toBe(true);
  });
});
