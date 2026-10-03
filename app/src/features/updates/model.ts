// What the chip, the popover, and the Updates section show for each updater status (ARCHITECTURE.md section
// 18.11). Plain functions, so every phase is tested without rendering.

import type { Settings, UpdaterPhase, UpdaterStatus } from '../../platform/types';
import { formatDate, formatTime } from '../../strings/format';
import { t } from '../../strings/t';

export type InstallPolicy = Settings['updates']['install'];
type ErrorCode = Extract<UpdaterPhase, { kind: 'error' }>['code'];
type DisabledReason = Extract<UpdaterPhase, { kind: 'disabled' }>['reason'];

/**
 * The chip's label, or null when there's no chip. "Update ready" once an update is downloaded and checked.
 * "Update available" when the person decides, under "Ask before installing" or "Only check when I ask". It also
 * shows while such a download runs, or while an automatic download waits for a network without a data limit.
 */
export function chipLabel(phase: UpdaterPhase, install: InstallPolicy): string | null {
  switch (phase.kind) {
    case 'ready':
    case 'applying':
      return t('updates.chip.ready');
    case 'available':
      return install !== 'auto' || phase.waitingForUnmetered ? t('updates.chip.available') : null;
    case 'downloading':
    case 'verifying':
      return install !== 'auto' ? t('updates.chip.available') : null;
    default:
      return null;
  }
}

/** A size in megabytes with one decimal, such as "21.9 MB". */
export function formatSize(bytes: number): string {
  const megabytes = Math.max(0.1, Math.round(bytes / 100_000) / 10);
  return t('updates.size', { size: megabytes.toFixed(1) });
}

/** What's said when an update becomes ready, once per version. */
export function readyAnnouncement(install: InstallPolicy): string {
  return install === 'auto' ? t('updates.announce.readyAuto') : t('updates.announce.readyAsk');
}

const ERRORS: Record<ErrorCode, () => string> = {
  offline: () => t('updates.errors.offline'),
  unreachable: () => t('updates.errors.unreachable'),
  verifyFailed: () => t('updates.errors.verifyFailed'),
  diskFull: () => t('updates.errors.diskFull'),
  swapFailed: () => t('updates.errors.swapFailed'),
  unknown: () => t('updates.errors.unknown'),
};

const DISABLED: Record<DisabledReason, () => string> = {
  devBuild: () => t('updates.status.devBuild'),
  noKey: () => t('updates.status.noKey'),
  manualMode: () => t('updates.status.manualMode'),
  notWritable: () => t('updates.status.notWritable'),
};

/** The one-line status for the phases that have no details card. */
export function statusLine(phase: UpdaterPhase): string | null {
  switch (phase.kind) {
    case 'disabled':
      return DISABLED[phase.reason]();
    case 'idle':
      return t('updates.status.idle');
    case 'checking':
      return t('updates.status.checking');
    case 'upToDate':
      return t('updates.status.upToDate');
    case 'error':
      return ERRORS[phase.code]();
    default:
      return null;
  }
}

/** "Last checked Sep 30, 2026 at 2:05 PM.", or null before the first check. */
export function lastCheckLine(status: UpdaterStatus): string | null {
  return status.lastCheck
    ? t('updates.status.lastCheck', { date: formatDate(status.lastCheck), time: formatTime(status.lastCheck) })
    : null;
}

/** "OpenNote tries again at 3:05 PM.", when a failed check has a retry time. */
export function retryLine(phase: UpdaterPhase): string | null {
  return phase.kind === 'error' && phase.retryAt
    ? t('updates.status.retryAt', { time: formatTime(phase.retryAt) })
    : null;
}

/** Whether "Check for updates" is offered at all: always, unless the updater is off in this copy. */
export function checkIsOffered(phase: UpdaterPhase): boolean {
  return phase.kind !== 'disabled' || phase.reason === 'manualMode';
}

/** Whether "Check for updates" can run now. It can't while the updater is off or busy. */
export function canCheck(phase: UpdaterPhase): boolean {
  if (phase.kind === 'disabled') return phase.reason === 'manualMode';
  return !['checking', 'downloading', 'verifying', 'applying'].includes(phase.kind);
}

/** The version an update phase is about, if any. */
export function phaseVersion(phase: UpdaterPhase): string | null {
  return 'version' in phase ? phase.version : null;
}
