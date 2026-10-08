// The self-check screen's data, turned into rows of plain sentences. The Rust side (crates/diagnostics) decides
// what is wrong and by how much. This file only says it in words, with the numbers filled in, so the screen can
// show a title, a status, one summary line, and the lines under it for each check.

import { formatDate, formatTime } from '../../strings/format';
import { t } from '../../strings/t';
import type { CheckId, CheckItem, Detail, SelfCheck, Status, StorageNote } from './types';

/** A check for updates this many days old counts as old, as in the Rust self-check. */
export const STALE_CHECK_DAYS = 14;

/** The most problem lines shown under the notebook check. The rest are counted. */
export const SHOWN_PROBLEMS = 5;

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** "512 MB" or "12.4 GB", as Windows counts them. */
export function formatBytes(bytes: number): string {
  return bytes >= GIB ? `${(bytes / GIB).toFixed(1)} GB` : `${Math.round(bytes / MIB)} MB`;
}

export interface SelfCheckRow {
  id: CheckId;
  status: Status;
  /** "Space for your notes". */
  title: string;
  /** "Needs attention". Color is never the only signal, so the screen shows this beside the icon. */
  statusLabel: string;
  /** One sentence. */
  summary: string;
  /** More sentences, such as each problem found. */
  details: string[];
}

export interface SelfCheckView {
  overall: Status;
  /** "Everything is in order." or "2 things need attention." */
  headline: string;
  /** "Checked Oct 2, 2026 at 2:05 PM." */
  checkedAt: string;
  rows: SelfCheckRow[];
}

function notApplicable(id: CheckId): string {
  switch (id) {
    case 'updates':
      return t('diagnostics.selfCheck.notApplicableUpdates');
    case 'crashReports':
      return t('diagnostics.selfCheck.notApplicableReports');
    default:
      return t('diagnostics.selfCheck.notApplicable');
  }
}

function storageNote(note: StorageNote): string {
  if (note === 'networkShare') return t('diagnostics.selfCheck.storage.networkShare');
  if (note === 'noMetadataLog') return t('diagnostics.selfCheck.storage.noMetadataLog');
  return t('diagnostics.selfCheck.storage.syncFolder', {
    tool: t(`diagnostics.selfCheck.storage.syncTool.${note.syncFolder}`),
  });
}

function describeUpdates(detail: Extract<Detail, { kind: 'updates' }>): { summary: string; details: string[] } {
  const problems: string[] = [];
  if (detail.rolledBack) {
    problems.push(
      t('diagnostics.selfCheck.updates.rolledBack', { from: detail.rolledBack.from, to: detail.rolledBack.to }),
    );
  }
  if (detail.pending && detail.pending.attempts >= 2) {
    problems.push(
      t('diagnostics.selfCheck.updates.stuck', { version: detail.pending.version, attempts: detail.pending.attempts }),
    );
  }
  const info: string[] = [];
  if (detail.stagedVersion) info.push(t('diagnostics.selfCheck.updates.staged', { version: detail.stagedVersion }));
  if (detail.blockedVersions.length > 0) {
    info.push(t('diagnostics.selfCheck.updates.blocked', { count: detail.blockedVersions.length }));
  }
  const days = detail.daysSinceCheck;
  let timing: string;
  if (days === null) {
    timing = t('diagnostics.selfCheck.updates.neverChecked');
  } else if (days >= STALE_CHECK_DAYS) {
    timing = t('diagnostics.selfCheck.updates.stale', { days });
  } else {
    timing = t('diagnostics.selfCheck.updates.lastChecked', { days });
  }
  // A problem is the summary, since it is what the person came to find. The timing then moves under it.
  const [first, ...rest] = problems;
  return first === undefined
    ? { summary: timing, details: info }
    : { summary: first, details: [...rest, ...info, timing] };
}

function describeHealth(detail: Extract<Detail, { kind: 'health' }>): { summary: string; details: string[] } {
  const details: string[] = [];
  if (detail.failed) return { summary: t('diagnostics.selfCheck.health.failed'), details };
  const shown = detail.problems.slice(0, SHOWN_PROBLEMS);
  for (const problem of shown) {
    details.push(
      problem.file
        ? t('diagnostics.selfCheck.health.problemLine', { file: problem.file, code: problem.code })
        : problem.code,
    );
  }
  if (detail.problemCount > shown.length) {
    details.push(t('diagnostics.selfCheck.health.moreProblems', { count: detail.problemCount - shown.length }));
  }
  if (detail.unsavedChanges) details.push(t('diagnostics.selfCheck.health.unsaved'));
  const summary =
    detail.problemCount === 0
      ? t('diagnostics.selfCheck.health.clean', { count: detail.files })
      : t('diagnostics.selfCheck.health.problems', { count: detail.problemCount, files: detail.files });
  return { summary, details };
}

function describe(item: CheckItem): { summary: string; details: string[] } {
  const detail = item.detail;
  switch (detail.kind) {
    case 'notApplicable':
      return { summary: notApplicable(item.id), details: [] };
    case 'freeSpace': {
      const key = item.status === 'fail' ? 'critical' : item.status === 'warn' ? 'low' : 'ok';
      return { summary: t(`diagnostics.selfCheck.disk.${key}`, { size: formatBytes(detail.freeBytes) }), details: [] };
    }
    case 'unavailable':
      return {
        summary: t(
          item.id === 'notebookStorage'
            ? 'diagnostics.selfCheck.storage.unknown'
            : 'diagnostics.selfCheck.disk.unknown',
        ),
        details: [],
      };
    case 'writable':
      return {
        summary: t(detail.writable ? 'diagnostics.selfCheck.writable.yes' : 'diagnostics.selfCheck.writable.no'),
        details: [],
      };
    case 'storage':
      return {
        summary: t('diagnostics.selfCheck.storage.fileSystem', { fileSystem: detail.fileSystem }),
        details: detail.notes.map(storageNote),
      };
    case 'health':
      return describeHealth(detail);
    case 'updates':
      return describeUpdates(detail);
    case 'reports':
      return {
        summary:
          detail.count === 0
            ? t('diagnostics.selfCheck.reports.none')
            : t('diagnostics.selfCheck.reports.some', { count: detail.count }),
        details: [],
      };
  }
}

/** One check as a row. */
export function selfCheckRow(item: CheckItem): SelfCheckRow {
  return {
    id: item.id,
    status: item.status,
    title: t(`diagnostics.selfCheck.item.${item.id}`),
    statusLabel: t(`diagnostics.selfCheck.status.${item.status}`),
    ...describe(item),
  };
}

/** The headline for the worst status and the number of checks at that status. */
function headline(items: readonly CheckItem[]): { overall: Status; text: string } {
  const failed = items.filter((item) => item.status === 'fail').length;
  const warned = items.filter((item) => item.status === 'warn').length;
  if (failed > 0) return { overall: 'fail', text: t('diagnostics.selfCheck.overall.fail', { count: failed }) };
  if (warned > 0) return { overall: 'warn', text: t('diagnostics.selfCheck.overall.warn', { count: warned }) };
  if (items.some((item) => item.status === 'pass'))
    return { overall: 'pass', text: t('diagnostics.selfCheck.overall.pass') };
  return { overall: 'skipped', text: t('diagnostics.selfCheck.overall.skipped') };
}

/** The whole screen's data. */
export function selfCheckView(check: SelfCheck): SelfCheckView {
  const { overall, text } = headline(check.items);
  const iso = new Date(check.createdUnix * 1000).toISOString();
  return {
    overall,
    headline: text,
    checkedAt: t('diagnostics.selfCheck.lastRun', { date: formatDate(iso), time: formatTime(iso) }),
    rows: check.items.map(selfCheckRow),
  };
}
