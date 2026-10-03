import { describe, expect, it } from 'vitest';
import { SHOWN_PROBLEMS, formatBytes, selfCheckRow, selfCheckView } from './selfCheck';
import type { CheckItem, Detail, SelfCheck } from './types';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

function row(item: CheckItem) {
  return selfCheckRow(item);
}

const freeSpace = (freeBytes: number): Detail => ({
  kind: 'freeSpace',
  freeBytes,
  warnBelow: 500 * MIB,
  failBelow: 50 * MIB,
});

describe('sizes', () => {
  it('count in the units Windows uses', () => {
    expect(formatBytes(512 * MIB)).toBe('512 MB');
    expect(formatBytes(GIB)).toBe('1.0 GB');
    expect(formatBytes(12.4 * GIB)).toBe('12.4 GB');
    expect(formatBytes(0)).toBe('0 MB');
  });
});

describe('free space', () => {
  it('says how much room there is, and what to do when there is little', () => {
    expect(row({ id: 'diskNotebook', status: 'pass', detail: freeSpace(20 * GIB) })).toMatchObject({
      title: 'Space for your notes',
      statusLabel: 'OK',
      summary: '20.0 GB free.',
    });
    expect(row({ id: 'diskNotebook', status: 'warn', detail: freeSpace(300 * MIB) }).summary).toBe(
      '300 MB free. Free up some space soon, so saves and updates keep working.',
    );
    expect(row({ id: 'diskApp', status: 'fail', detail: freeSpace(10 * MIB) })).toMatchObject({
      title: 'Space for updates and backups',
      statusLabel: 'Problem',
      summary: '10 MB free. Free up space now, or OpenNote may not be able to save.',
    });
  });

  it('says so when the free space could not be read', () => {
    const unknown = row({ id: 'diskApp', status: 'warn', detail: { kind: 'unavailable', reason: 'PermissionDenied' } });
    expect(unknown.summary).toBe("Couldn't read how much space is free.");
    const storage = row({ id: 'notebookStorage', status: 'warn', detail: { kind: 'unavailable', reason: 'x' } });
    expect(storage.summary).toBe("Couldn't read details about the drive.");
  });
});

describe('the notebook folder', () => {
  it('says whether OpenNote can save in it', () => {
    const yes = row({
      id: 'notebookWritable',
      status: 'pass',
      detail: { kind: 'writable', writable: true, reason: null },
    });
    expect(yes.summary).toBe('OpenNote can save in this folder.');
    const no = row({
      id: 'notebookWritable',
      status: 'fail',
      detail: { kind: 'writable', writable: false, reason: 'NotFound' },
    });
    expect(no.summary).toContain("OpenNote can't save in this folder.");
    expect(no.statusLabel).toBe('Problem');
  });

  it('names the drive and each thing worth knowing about it', () => {
    const storage = row({
      id: 'notebookStorage',
      status: 'warn',
      detail: {
        kind: 'storage',
        fileSystem: 'FAT32',
        notes: ['networkShare', 'noMetadataLog', { syncFolder: 'oneDrive' }, { syncFolder: 'other' }],
      },
    });
    expect(storage.summary).toBe('The notebook is on a FAT32 drive.');
    expect(storage.details).toEqual([
      'It is on a network share, so saves can be slow, and the folder can disappear.',
      'This drive keeps no change log, so a power cut can lose the last save.',
      'OneDrive syncs this folder. Syncing while OpenNote saves can cause conflicts.',
      'A sync app syncs this folder. Syncing while OpenNote saves can cause conflicts.',
    ]);
  });
});

describe('the notebook check', () => {
  const health = (over: Partial<Extract<Detail, { kind: 'health' }>>): Detail => ({
    kind: 'health',
    files: 40,
    problemCount: 0,
    byCode: [],
    problems: [],
    unsavedChanges: false,
    failed: null,
    ...over,
  });

  it('says it found nothing', () => {
    expect(row({ id: 'notebookHealth', status: 'pass', detail: health({}) }).summary).toBe(
      'Checked 40 files. No problems.',
    );
    expect(row({ id: 'notebookHealth', status: 'pass', detail: health({ files: 1 }) }).summary).toBe(
      'Checked 1 file. No problems.',
    );
  });

  it('lists the first problems with their files and counts the rest', () => {
    const problems = Array.from({ length: 8 }, (_, n) => ({
      code: 'page.checksum',
      file: `Lectures/Page ${n}/page.json`,
    }));
    const found = row({
      id: 'notebookHealth',
      status: 'fail',
      detail: health({ problemCount: 12, problems, byCode: [{ code: 'page.checksum', count: 12 }] }),
    });
    expect(found.summary).toBe('12 problems found in 40 files checked.');
    expect(found.details).toHaveLength(SHOWN_PROBLEMS + 1);
    expect(found.details[0]).toBe('Lectures/Page 0/page.json: page.checksum');
    expect(found.details.at(-1)).toBe('And 7 more.');
  });

  it('shows only the code when the file name was left out', () => {
    const shared = row({
      id: 'notebookHealth',
      status: 'fail',
      detail: health({ problemCount: 1, problems: [{ code: 'page.checksum', file: '' }] }),
    });
    expect(shared.details).toEqual(['page.checksum']);
  });

  it('mentions changes that are not saved yet, and a check that could not run', () => {
    const unsaved = row({ id: 'notebookHealth', status: 'warn', detail: health({ unsavedChanges: true }) });
    expect(unsaved.details).toEqual(['Some changes are not saved yet. They save within a few seconds.']);
    const failed = row({ id: 'notebookHealth', status: 'fail', detail: health({ failed: 'fs' }) });
    expect(failed.summary).toBe("The check couldn't run.");
  });
});

describe('updates', () => {
  const updates = (over: Partial<Extract<Detail, { kind: 'updates' }>>): Detail => ({
    kind: 'updates',
    lastCheck: null,
    daysSinceCheck: null,
    stagedVersion: null,
    pending: null,
    rolledBack: null,
    blockedVersions: [],
    ...over,
  });

  it('says when it last checked', () => {
    expect(row({ id: 'updates', status: 'pass', detail: updates({}) }).summary).toBe(
      'OpenNote has not checked for updates yet.',
    );
    expect(row({ id: 'updates', status: 'pass', detail: updates({ daysSinceCheck: 0 }) }).summary).toBe(
      'Last checked today.',
    );
    expect(row({ id: 'updates', status: 'pass', detail: updates({ daysSinceCheck: 1 }) }).summary).toBe(
      'Last checked 1 day ago.',
    );
    expect(row({ id: 'updates', status: 'pass', detail: updates({ daysSinceCheck: 5 }) }).summary).toBe(
      'Last checked 5 days ago.',
    );
    expect(row({ id: 'updates', status: 'warn', detail: updates({ daysSinceCheck: 20 }) }).summary).toBe(
      'OpenNote has not checked for updates in 20 days.',
    );
  });

  it('puts a problem first and the timing under it', () => {
    const rolled = row({
      id: 'updates',
      status: 'warn',
      detail: updates({
        daysSinceCheck: 1,
        stagedVersion: '0.6.0',
        blockedVersions: ['0.5.0'],
        pending: { version: '0.5.0', from: '0.4.0', attempts: 2 },
        rolledBack: { from: '0.5.0', to: '0.4.0', at: '2026-09-20T10:09:12Z' },
      }),
    });
    expect(rolled.summary).toBe('Version 0.5.0 did not start, so OpenNote went back to version 0.4.0.');
    expect(rolled.details).toEqual([
      'Version 0.5.0 has started 2 times without a clean start.',
      'Version 0.6.0 is downloaded and ready.',
      '1 version is skipped.',
      'Last checked 1 day ago.',
    ]);
  });

  it('does not call the first start of a new version a problem', () => {
    const first = row({
      id: 'updates',
      status: 'pass',
      detail: updates({ pending: { version: '0.5.0', from: '0.4.0', attempts: 1 }, daysSinceCheck: 0 }),
    });
    expect(first.summary).toBe('Last checked today.');
  });
});

describe('the whole screen', () => {
  const check: SelfCheck = {
    createdUnix: 1_790_000_000,
    items: [
      { id: 'diskNotebook', status: 'pass', detail: freeSpace(20 * GIB) },
      { id: 'diskApp', status: 'warn', detail: freeSpace(100 * MIB) },
      { id: 'notebookWritable', status: 'skipped', detail: { kind: 'notApplicable' } },
      { id: 'updates', status: 'skipped', detail: { kind: 'notApplicable' } },
      { id: 'crashReports', status: 'pass', detail: { kind: 'reports', count: 2 } },
    ],
  };

  it('headlines the worst result and counts the checks at it', () => {
    const view = selfCheckView(check);
    expect(view.overall).toBe('warn');
    expect(view.headline).toBe('1 thing needs attention.');
    expect(view.checkedAt).toMatch(/^Checked Sep \d{1,2}, 2026 at \d{1,2}:\d{2} [AP]M\.$/);
    expect(view.rows.map((r) => r.status)).toEqual(['pass', 'warn', 'skipped', 'skipped', 'pass']);
    expect(view.rows[2]?.summary).toBe('No notebook is open.');
    expect(view.rows[3]?.summary).toBe('Updates are off.');
    expect(view.rows[4]?.summary).toBe('2 crash reports are saved.');
  });

  it('says everything is in order, or that a problem was found, or that there was nothing to check', () => {
    const pass = selfCheckView({ ...check, items: [check.items[0] as CheckItem] });
    expect(pass.overall).toBe('pass');
    expect(pass.headline).toBe('Everything is in order.');
    const fail = selfCheckView({
      ...check,
      items: [
        { id: 'diskApp', status: 'fail', detail: freeSpace(MIB) },
        { id: 'diskNotebook', status: 'fail', detail: freeSpace(MIB) },
        check.items[1] as CheckItem,
      ],
    });
    expect(fail.overall).toBe('fail');
    expect(fail.headline).toBe('2 things are wrong.');
    expect(selfCheckView({ createdUnix: 0, items: [] })).toMatchObject({
      overall: 'skipped',
      headline: 'There was nothing to check.',
    });
  });

  it('gives every row a title and a status in words, so color is never the only signal', () => {
    for (const r of selfCheckView(check).rows) {
      expect(r.title.length).toBeGreaterThan(3);
      expect(['OK', 'Needs attention', 'Problem', 'Not checked']).toContain(r.statusLabel);
    }
  });
});
