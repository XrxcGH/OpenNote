import { describe, expect, it } from 'vitest';
import { createFakeDiagnostics } from './fake';
import {
  SAFE_MODE_OFF,
  openSafeStart,
  reduceSafeStart,
  safeModeNotice,
  safeStartAnnouncement,
  safeStartPrompt,
  safeStartText,
  sessionStatsLine,
} from './safeStart';
import type { StartReport } from './types';

const report = (changes: Partial<StartReport> = {}): StartReport => ({
  previous: 'crashed',
  crashesInARow: 2,
  offerSafeMode: true,
  previousWasSafe: false,
  ...changes,
});

describe('the safe mode offer', () => {
  it('is made only when the host says two crashes in a row', () => {
    expect(safeStartPrompt(report())).toBe('offer');
    expect(safeStartPrompt(report({ crashesInARow: 1, offerSafeMode: false }))).toBe('none');
    expect(openSafeStart(report({ offerSafeMode: false }))).toBeNull();
  });

  it('says so when the last crash happened in safe mode', () => {
    expect(safeStartPrompt(report({ previousWasSafe: true }))).toBe('offerAgain');
    const text = safeStartText(openSafeStart(report({ previousWasSafe: true }))!);
    expect(text.title).toBe('OpenNote stopped again in safe mode');
    expect(text.intro.join(' ')).toContain('even in safe mode');
  });

  it('counts the crashes in its first sentence', () => {
    const text = safeStartText(openSafeStart(report({ crashesInARow: 3 }))!);
    expect(text.title).toBe('OpenNote did not close properly');
    expect(text.intro[0]).toContain('last 3 starts');
  });

  it('lists what safe mode turns off, and says the notebooks stay open', () => {
    const text = safeStartText(openSafeStart(report())!);
    expect(text.off).toHaveLength(SAFE_MODE_OFF.length);
    expect(text.off.join(' ')).toMatch(/Background work.*Embeds.*On-device models/);
    expect(text.kept).toBe('Your notebooks stay open for reading and editing.');
    expect(text.startSafe).not.toBe(text.startNormal);
  });
});

describe('the offer dialog', () => {
  const open = () => openSafeStart(report())!;

  it('starts open with no choice made', () => {
    expect(open()).toMatchObject({ closed: false, result: null, reason: 'offer' });
  });

  it('starts in safe mode only when the person asks', () => {
    expect(reduceSafeStart(open(), { type: 'startSafe' })).toMatchObject({ closed: true, result: 'safe' });
    expect(reduceSafeStart(open(), { type: 'startNormal' })).toMatchObject({ closed: true, result: 'normal' });
  });

  it('treats Escape as starting normally', () => {
    expect(reduceSafeStart(open(), { type: 'dismiss' })).toMatchObject({ closed: true, result: 'normal' });
  });

  it('keeps a choice once made', () => {
    const chosen = reduceSafeStart(open(), { type: 'startSafe' });
    expect(reduceSafeStart(chosen, { type: 'dismiss' })).toBe(chosen);
    expect(reduceSafeStart(chosen, { type: 'startNormal' })).toBe(chosen);
  });

  it('announces the choice in words', () => {
    expect(safeStartAnnouncement('safe')).toBe('Starting in safe mode.');
    expect(safeStartAnnouncement('normal')).toBe('Starting normally.');
  });
});

describe('the safe mode notice', () => {
  it('is absent in a normal session', () => {
    expect(safeModeNotice(false)).toBeNull();
  });

  it('says what is off and how to turn it back on', () => {
    const notice = safeModeNotice(true)!;
    expect(notice.title).toBe('OpenNote is in safe mode');
    expect(notice.off).toHaveLength(SAFE_MODE_OFF.length);
    expect(notice.restart).toContain('restart OpenNote normally');
    expect(notice.restartButton).toBe('Restart normally');
  });
});

describe('the session counts', () => {
  it('say how many recent sessions ended without a crash', () => {
    expect(sessionStatsLine({ sessions: 10, clean: 9, crashed: 1 })).toBe(
      '9 of the last 10 sessions ended without a crash.',
    );
    expect(sessionStatsLine({ sessions: 1, clean: 1, crashed: 0 })).toBe(
      'The one earlier session ended without a crash.',
    );
    expect(sessionStatsLine({ sessions: 1, clean: 0, crashed: 1 })).toBe('The one earlier session ended in a crash.');
  });

  it('say so when there is nothing to count', () => {
    expect(sessionStatsLine({ sessions: 0, clean: 0, crashed: 0 })).toBe('There are no earlier sessions to count yet.');
  });
});

describe('the fake host', () => {
  it('starts normally, and enterSafeMode turns on the flag for the rest of the session', async () => {
    const { client, calls } = createFakeDiagnostics();
    expect((await client.startup()).safeMode).toBe(false);
    await client.enterSafeMode();
    expect((await client.startup()).safeMode).toBe(true);
    expect(calls).toEqual(['startup', 'enterSafeMode', 'startup']);
  });
});
