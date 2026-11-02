// The words and checks of the Sync page, kept apart from the screens so they can be tested alone.

import { formatDate, formatTime } from '../../strings/format';
import { hostSystem } from '../../platform/system';
import { t } from '../../strings/t';
import { formatBytes } from '../diagnostics';
import { SyncFailure } from './types';
import type { BackendConfig, DeviceRow, Summary, SyncErrorCode, SyncState, SyncView } from './types';

/** The calm sentence for an error code. */
export function errorText(code: SyncErrorCode): string {
  return t(`sync.errors.${code}`);
}

/** The error code of anything a sync call threw. */
export function codeOf(error: unknown): SyncErrorCode {
  return error instanceof SyncFailure ? error.code : 'unknown';
}

export function stateText(state: SyncState): string {
  return t(`sync.state.${state}`);
}

/** "Sep 30, 2026, 2:05 PM". */
export function whenText(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${formatDate(iso)}, ${formatTime(iso)}`;
}

/** After this many days without syncing, a device's row says it is holding up the others' cleanup. */
export const QUIET_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days since another device last synced (or joined, if it never did); 0 for this device. */
function quietDays(device: DeviceRow, now: number): number {
  if (device.thisDevice) return 0;
  return Math.floor((now - (device.lastSync ?? device.added)) / DAY_MS);
}

/** Whether another device has been quiet for [QUIET_DAYS] or more, so its row offers Remove up front. */
export function isQuiet(device: DeviceRow, now: number): boolean {
  return quietDays(device, now) >= QUIET_DAYS;
}

/** A device's second line: when it joined and when it last synced, and a word when it has gone quiet. */
export function deviceLines(device: DeviceRow, now: number): string[] {
  const lines = [t('sync.devices.added', { when: whenText(device.added) })];
  if (device.thisDevice) return lines;
  const last = device.lastSync ?? null;
  lines.push(last === null ? t('sync.devices.neverSynced') : t('sync.devices.lastSync', { when: whenText(last) }));
  if (isQuiet(device, now)) lines.push(t('sync.devices.quiet', { days: quietDays(device, now) }));
  return lines;
}

/** The sentences that say where this device keeps its secrets, which is a different store on each system. */
type KeyStoreLine = 'sync.explainer.item4' | 'sync.wizard.passwordHelp';

/** `key` as this system says it: Credential Manager on Windows, the Keychain on a Mac, the keyring on Linux. */
export function keyStoreText(key: KeyStoreLine): string {
  const system = hostSystem();
  if (system === 'macos') return t(`${key}Macos`);
  if (system === 'linux') return t(`${key}Linux`);
  return t(key);
}

export function placeText(backend: BackendConfig): string {
  const place =
    backend.kind === 'folder'
      ? t('sync.whereFolder', { path: backend.path })
      : t('sync.whereServer', { url: backend.url });
  return t('sync.where', { place });
}

/** The lines of a preview, without empty ones. */
export function summaryLines(summary: Summary): string[] {
  const lines: string[] = [];
  if (summary.upload.length) {
    lines.push(t('sync.summary.upload', { count: summary.upload.length, size: formatBytes(summary.bytesUp) }));
  }
  if (summary.download.length) {
    lines.push(t('sync.summary.download', { count: summary.download.length, size: formatBytes(summary.bytesDown) }));
  }
  if (summary.delete.length) lines.push(t('sync.summary.delete', { count: summary.delete.length }));
  if (summary.conflicts.length) lines.push(t('sync.summary.conflicts', { count: summary.conflicts.length }));
  return lines.length ? lines : [t('sync.summary.nothing')];
}

/** The two groups of the recovery key the person types back, 1-based, and different for each key. */
export function checkGroups(key: string): [number, number] {
  const groups = key.split('-').length;
  if (groups < 3) return [1, Math.max(groups, 1)];
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const first = (hash % (groups - 1)) + 1;
  const second = first + 1 + ((hash >>> 8) % (groups - first));
  return [first, Math.min(second, groups)];
}

/** Whether what was typed matches the group, ignoring case and spaces, and reading O as 0 and I or L as 1. */
export function groupMatches(key: string, group: number, typed: string): boolean {
  const norm = (text: string) => text.replace(/\s/g, '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
  const want = key.split('-')[group - 1];
  return want !== undefined && norm(typed) === norm(want);
}

export const MIN_PASSPHRASE = 10;

/** What is wrong with a new passphrase and its confirmation, or null. */
export function passphraseProblem(passphrase: string, again: string): string | null {
  if ([...passphrase].length < MIN_PASSPHRASE) return t('sync.wizard.tooShort');
  if (passphrase !== again) return t('sync.wizard.mismatch');
  return null;
}

/** Whether the place is filled in. */
export function placeReady(backend: BackendConfig): boolean {
  return backend.kind === 'folder' ? backend.path.trim().length > 0 : /^https?:\/\/\S+$/i.test(backend.url.trim());
}

/** The title bar notice's label, or null when there is nothing to show. */
export function chipText(view: SyncView | null): string | null {
  if (!view?.configured) return null;
  const state = view.status.state;
  return state === 'off' ? null : t(`sync.chip.${state}`);
}

/** An SVG path of the dark modules of a QR code, with a 4-module quiet zone. */
export function qrPath(rows: readonly string[], quiet = 4): string {
  const parts: string[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '1') parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
  });
  return parts.join('');
}
