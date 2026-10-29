import { describe, expect, it } from 'vitest';
import {
  CLOSED,
  canSend,
  crashListSummary,
  crashRows,
  reduceReview,
  refusalMessage,
  reportId,
  sendRequest,
} from './crashReview';
import type { ReviewState } from './crashReview';
import type { CrashSummary, PendingSend } from './types';

const pending: PendingSend = {
  id: 'crash-1790000000-0',
  endpoint: 'https://crashes.example.org/report',
  payload: '{ "format": 1 }\n',
  digest: 'abc123',
};

function run(...events: Parameters<typeof reduceReview>[1][]): ReviewState {
  return events.reduce(reduceReview, CLOSED);
}

describe('reviewing a report', () => {
  it('shows the text before anything can be sent', () => {
    const loading = run({ type: 'open', id: pending.id });
    expect(loading).toEqual({ step: 'loading', id: pending.id });
    expect(canSend(loading)).toBe(false);
    const reviewing = reduceReview(loading, { type: 'prepared', pending });
    expect(reviewing).toEqual({ step: 'reviewing', pending });
    expect(canSend(reviewing)).toBe(true);
    expect(sendRequest(reviewing)).toBeNull();
  });

  it('sends the digest of the text that was shown, and only after Send is pressed', () => {
    const sending = run({ type: 'open', id: pending.id }, { type: 'prepared', pending }, { type: 'send' });
    expect(sending.step).toBe('sending');
    expect(sendRequest(sending)).toEqual({ id: pending.id, digest: 'abc123' });
    expect(canSend(sending)).toBe(false);
  });

  it('cannot send from a state where no text was shown', () => {
    for (const state of [
      CLOSED,
      run({ type: 'open', id: 'x' }),
      run({ type: 'open', id: 'x' }, { type: 'refused', reason: 'noAddress' }),
    ]) {
      expect(reduceReview(state, { type: 'send' })).toBe(state);
    }
  });

  it('ignores a prepared report that is not the one being opened', () => {
    const loading = run({ type: 'open', id: 'crash-1-0' });
    expect(reduceReview(loading, { type: 'prepared', pending })).toBe(loading);
  });

  it('finishes with sent, and keeps the report id', () => {
    const sent = run(
      { type: 'open', id: pending.id },
      { type: 'prepared', pending },
      { type: 'send' },
      { type: 'sent' },
    );
    expect(sent).toEqual({ step: 'sent', id: pending.id });
    expect(reportId(sent)).toBe(pending.id);
    expect(canSend(sent)).toBe(false);
  });

  it('keeps the text on screen after a failure and lets the person send again', () => {
    const failed = run(
      { type: 'open', id: pending.id },
      { type: 'prepared', pending },
      { type: 'send' },
      { type: 'failed' },
    );
    expect(failed).toEqual({ step: 'failed', pending });
    expect(canSend(failed)).toBe(true);
    expect(reduceReview(failed, { type: 'send' }).step).toBe('sending');
  });

  it('does not close or switch away while a send is under way', () => {
    const sending = run({ type: 'open', id: pending.id }, { type: 'prepared', pending }, { type: 'send' });
    expect(reduceReview(sending, { type: 'close' })).toBe(sending);
    expect(reduceReview(sending, { type: 'open', id: 'crash-2-0' })).toBe(sending);
    expect(reduceReview(reduceReview(sending, { type: 'sent' }), { type: 'close' })).toBe(CLOSED);
  });

  it('says why a report cannot be prepared', () => {
    for (const reason of ['notOptedIn', 'noAddress', 'missing'] as const) {
      const blocked = run({ type: 'open', id: 'x' }, { type: 'refused', reason });
      expect(blocked).toEqual({ step: 'blocked', id: 'x', reason });
      expect(canSend(blocked)).toBe(false);
      expect(refusalMessage(reason).length).toBeGreaterThan(10);
    }
    expect(refusalMessage('notOptedIn')).toContain('Turn them on in Settings');
  });

  it('closes from any resting state', () => {
    expect(reduceReview(run({ type: 'open', id: 'x' }), { type: 'close' })).toBe(CLOSED);
    expect(reportId(CLOSED)).toBeNull();
  });

  it('ignores events that do not fit the state', () => {
    expect(reduceReview(CLOSED, { type: 'sent' })).toBe(CLOSED);
    expect(reduceReview(CLOSED, { type: 'failed' })).toBe(CLOSED);
    expect(reduceReview(CLOSED, { type: 'prepared', pending })).toBe(CLOSED);
  });
});

describe('the list', () => {
  const reports: CrashSummary[] = [
    { id: 'a', time_unix: 1_790_000_100, kind: 'panic', app_version: '1.0.0-beta.2', size_bytes: 1204 },
    { id: 'b', time_unix: 1_790_000_000, kind: 'exception', app_version: '1.0.0-beta.1', size_bytes: 988 },
  ];

  it('labels each row with what happened, when, and in which version', () => {
    const rows = crashRows(reports);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(rows[0]?.label).toMatch(
      /^Program error on Sep \d{1,2}, 2026 at \d{1,2}:\d{2} [AP]M, version 1\.0\.0-beta\.2$/,
    );
    expect(rows[1]?.label).toMatch(/^Crash on /);
    expect(rows[1]?.sizeBytes).toBe(988);
  });

  it('says how many are saved, or that none are', () => {
    expect(crashListSummary(0)).toBe('No crash reports are saved.');
    expect(crashListSummary(1)).toBe('1 crash report is saved on this computer.');
    expect(crashListSummary(3)).toBe('3 crash reports are saved on this computer.');
  });
});
