import { describe, expect, it } from 'vitest';
import type { UpdaterPhase } from '../../platform/types';
import { canCheck, checkIsOffered, chipLabel, formatSize, readyAnnouncement, statusLine } from './model';

const ready: UpdaterPhase = { kind: 'ready', version: '0.5.0', notes: '', blockedBy: null };
const available = (waitingForUnmetered = false): UpdaterPhase => ({
  kind: 'available',
  version: '0.5.0',
  notes: '',
  size: 21_900_000,
  waitingForUnmetered,
});
const off = (reason: Extract<UpdaterPhase, { kind: 'disabled' }>['reason']): UpdaterPhase => ({
  kind: 'disabled',
  reason,
});

describe('chipLabel', () => {
  it('says "Update ready" once an update is checked, whatever the install choice', () => {
    for (const install of ['auto', 'ask', 'manual'] as const) {
      expect(chipLabel(ready, install)).toBe('Update ready');
    }
  });

  it('says "Update available" only when the person decides or a download waits for another network', () => {
    expect(chipLabel(available(), 'auto')).toBeNull();
    expect(chipLabel(available(), 'ask')).toBe('Update available');
    expect(chipLabel(available(true), 'auto')).toBe('Update available');
    expect(chipLabel({ kind: 'downloading', version: '0.5.0', received: 1, total: 2 }, 'auto')).toBeNull();
    expect(chipLabel({ kind: 'downloading', version: '0.5.0', received: 1, total: 2 }, 'ask')).toBe('Update available');
  });

  it('shows no chip while nothing is on offer', () => {
    for (const phase of [{ kind: 'idle' }, { kind: 'upToDate' }, off('noKey')] as UpdaterPhase[]) {
      expect(chipLabel(phase, 'auto')).toBeNull();
    }
  });
});

describe('the status line and the check button', () => {
  it('explains a copy without an update key and offers no check', () => {
    expect(statusLine(off('noKey'))).toMatch(/built without an update key/);
    expect(checkIsOffered(off('noKey'))).toBe(false);
    expect(checkIsOffered(off('devBuild'))).toBe(false);
  });

  it('offers the check in manual mode, and not while one runs', () => {
    expect(canCheck(off('manualMode'))).toBe(true);
    expect(canCheck({ kind: 'checking' })).toBe(false);
    expect(canCheck({ kind: 'upToDate' })).toBe(true);
    expect(statusLine({ kind: 'error', code: 'offline', retryAt: null })).toBe(
      "Couldn't check for updates, because you're offline.",
    );
  });

  it('formats sizes and the ready announcement for each install choice', () => {
    expect(formatSize(21_900_000)).toBe('21.9 MB');
    expect(readyAnnouncement('auto')).toMatch(/installs when you close OpenNote/);
    expect(readyAnnouncement('ask')).toBe('Update ready. Restart OpenNote to install it.');
  });
});
