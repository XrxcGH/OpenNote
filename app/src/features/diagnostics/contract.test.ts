// The JSON that crates/crashreport and crates/diagnostics write, read here. The Rust tests check the same files
// against the real types (tests/contract.rs in each crate), so the two sides cannot drift apart without a test
// failing. The key lists below are the interface's types in words: a new or renamed field in Rust fails here until
// types.ts, and the screens that read it, are updated too.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WORDING_VERSION, prompt, savingAllowed } from './consent';
import { crashRows } from './crashReview';
import { DEFAULT_OPTIONS, removedLine, sectionRows } from './feedback';
import { SAFE_START_AFTER, safeStartPrompt, sessionStatsLine } from './safeStart';
import { selfCheckView } from './selfCheck';
import type { Bundle, Consent, CrashReport, CrashSummary, SelfCheck, SessionStats, StartReport } from './types';

function fixture<T>(crate: 'crashreport' | 'diagnostics', name: string): T {
  const url = new URL(`../../../../crates/${crate}/tests/fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as T;
}

const keys = (value: object) => Object.keys(value).sort();

describe('crash reports', () => {
  const report = fixture<CrashReport>('crashreport', 'report.json');

  it('have the fields the review shows', () => {
    expect(keys(report)).toEqual(
      [
        'app_version',
        'backtrace',
        'exception_code',
        'format',
        'frames',
        'kind',
        'location',
        'message',
        'os',
        'time_unix',
      ].sort(),
    );
    expect(keys(report.frames[0] ?? {})).toEqual(['debug_id', 'function', 'module', 'offset']);
    expect(report.kind).toBe('exception');
  });

  it('hold no path, name, or note text', () => {
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/Users|Documents|\\\\/);
    expect(report.frames.every((f) => /^[A-Za-z0-9_.+-]+$/.test(f.module))).toBe(true);
  });

  it('list with the fields the rows show', () => {
    const list = fixture<CrashSummary[]>('crashreport', 'summaries.json');
    expect(keys(list[0] ?? {})).toEqual(['app_version', 'id', 'kind', 'size_bytes', 'time_unix']);
    const rows = crashRows(list);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.label).toContain('version 1.0.0-beta.2');
  });
});

describe('consent', () => {
  const states = fixture<Consent[]>('crashreport', 'consent.json');

  it('has the fields the interface stores', () => {
    for (const state of states) expect(keys(state)).toEqual(['decidedUnix', 'decision', 'wordingVersion']);
  });

  it('means the same here as in Rust', () => {
    // Never asked, declined, accepted under this wording, and accepted under a newer one.
    expect(states.map((s) => s.decision)).toEqual(['unasked', 'declined', 'accepted', 'accepted']);
    expect(states.map(savingAllowed)).toEqual([false, false, true, false]);
    expect(states.map(prompt)).toEqual(['first', 'none', 'none', 'none']);
    expect(states[2]?.wordingVersion).toBe(WORDING_VERSION);
    expect(states[3]?.wordingVersion).toBe(WORDING_VERSION + 1);
  });
});

describe('the self-check', () => {
  const check = fixture<SelfCheck>('diagnostics', 'self-check.json');

  it('has the fields the screen reads, for every kind of detail', () => {
    expect(keys(check)).toEqual(['createdUnix', 'items']);
    const byKind = Object.fromEntries(check.items.map((item) => [item.detail.kind, keys(item.detail)]));
    expect(byKind).toEqual({
      freeSpace: ['failBelow', 'freeBytes', 'kind', 'warnBelow'],
      unavailable: ['kind', 'reason'],
      writable: ['kind', 'reason', 'writable'],
      storage: ['fileSystem', 'kind', 'notes'],
      health: ['byCode', 'failed', 'files', 'kind', 'problemCount', 'problems', 'unsavedChanges'],
      updates: ['blockedVersions', 'daysSinceCheck', 'kind', 'lastCheck', 'pending', 'rolledBack', 'stagedVersion'],
      reports: ['count', 'kind'],
      notApplicable: ['kind'],
    });
    for (const item of check.items) expect(keys(item)).toEqual(['detail', 'id', 'status']);
  });

  it('turns into rows without a missing field showing as "undefined"', () => {
    const view = selfCheckView(check);
    expect(view.overall).toBe('fail');
    expect(view.rows).toHaveLength(check.items.length);
    const text = JSON.stringify(view);
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
    expect(view.rows[3]?.details).toHaveLength(3);
    expect(view.rows[4]?.details.at(-1)).toBe('Some changes are not saved yet. They save within a few seconds.');
  });
});

describe('the feedback file', () => {
  const bundle = fixture<Bundle>('diagnostics', 'bundle.json');

  it('has the fields the review reads', () => {
    expect(keys(bundle)).toEqual(['createdUnix', 'redactions', 'sections']);
    expect(keys(bundle.sections[0] ?? {})).toEqual(['body', 'id', 'items', 'redactions', 'title']);
    expect(keys(bundle.redactions)).toEqual(
      ['emails', 'ids', 'links', 'names', 'paths', 'private', 'quoted', 'tokens'].sort(),
    );
  });

  it('lists its parts and says what was removed', () => {
    expect(sectionRows(bundle).map((r) => r.id)).toEqual(['description', 'system', 'logs', 'crashReports']);
    expect(removedLine(bundle.redactions)).toBe('6 things were removed and replaced by marks such as <path>.');
  });

  it('starts from the options the Rust side defaults to', () => {
    const options = fixture<Record<string, unknown>>('diagnostics', 'bundle-options.json');
    expect(options).toMatchObject({
      description: DEFAULT_OPTIONS.description,
      includeLogs: DEFAULT_OPTIONS.includeLogs,
      includeCrashReports: DEFAULT_OPTIONS.includeCrashReports,
    });
    expect(options.includeCrashReports).toBe(false);
  });

  it('takes the facts the app sends', () => {
    const facts = fixture<Record<string, unknown>>('diagnostics', 'system-facts.json');
    expect(keys(facts)).toEqual([
      'appVersion',
      'channel',
      'density',
      'displayScalePercent',
      'enabledFlags',
      'locale',
      'notebooks',
      'textSizePercent',
      'theme',
      'webview2Version',
    ]);
  });
});

describe('sessions', () => {
  it('give the start report the dialog reads', () => {
    const report = fixture<StartReport>('diagnostics', 'start-report.json');
    expect(keys(report)).toEqual(['crashesInARow', 'offerSafeMode', 'previous', 'previousWasSafe']);
    expect(report.previous).toBe('crashed');
    // The fixture is a start after two crashes, so the dialog opens and counts them.
    expect(safeStartPrompt(report)).toBe('offer');
    expect(report.crashesInARow).toBe(SAFE_START_AFTER);
  });

  it('give the counts the self-check line reads', () => {
    const stats = fixture<SessionStats>('diagnostics', 'session-stats.json');
    expect(keys(stats)).toEqual(['clean', 'crashed', 'sessions']);
    expect(sessionStatsLine(stats)).toBe('8 of the last 10 sessions ended without a crash.');
  });
});
