// Runtime pack downloads for the interface (ADR 0070). A pack downloads only after the person saw its size and
// agreed. The shell does the work: it resumes, checks each file's SHA-256, and refuses while Work offline or safe
// mode is on. This file keeps the list, asks first, and polls while something downloads.
import { navigate } from '../../../app/location';
import { createStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { announce, confirm, showToast } from '../../../ui';
import type { PackInfo, PackList } from '../contracts';
import { errorCode, shellPacksClient } from './client';
import type { PacksClient } from './client';

export interface PacksState {
  /** The last list the shell gave, or null before the first. */
  list: PackList | null;
  /** Reading the list failed, or there is no shell. */
  failed: boolean;
}

export const packsState = createStore<PacksState>({ list: null, failed: false }, 'code packs');

/** How often the list is read while a download runs. */
export const POLL_MS = 700;

/** The id of the Code group in the Models panel, which Settings, then Code, then Downloads opens. */
export const CODE_DOWNLOADS_ID = 'code-downloads';

let client: PacksClient | null | undefined;

function shell(): PacksClient | null {
  if (client === undefined) client = shellPacksClient();
  return client;
}

/** Puts a stand-in for the shell in place, for tests. `undefined` goes back to the real one. */
export function setPacksClient(next: PacksClient | null | undefined): void {
  client = next;
}

const SIZE = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

/** A size in words people use: KB, MB, or GB. */
export function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${SIZE.format(bytes / 1e9)} GB`;
  if (bytes >= 1e6) return `${SIZE.format(bytes / 1e6)} MB`;
  return `${SIZE.format(Math.max(1, Math.round(bytes / 1e3)))} KB`;
}

const KNOWN_ERRORS = ['offline', 'safeMode', 'network', 'checksum', 'io', 'stopping', 'invalid'] as const;
type PackErrorCode = (typeof KNOWN_ERRORS)[number] | 'unknown';

/** The sentence for a failed call or a failed download. */
export function describePackError(code: string): string {
  const known: PackErrorCode = KNOWN_ERRORS.find((one) => one === code) ?? 'unknown';
  return t(`codeStudio.packs.errors.${known}`);
}

/** The status line of one pack. */
export function packStateLine(pack: PackInfo): string {
  const state = pack.state;
  switch (state.kind) {
    case 'absent':
      return t('codeStudio.packs.state.absent');
    case 'partial':
      return t('codeStudio.packs.state.partial', {
        done: formatSize(state.receivedBytes),
        size: formatSize(state.totalBytes),
      });
    case 'downloading':
      return t('codeStudio.packs.state.downloading', {
        done: formatSize(state.receivedBytes),
        size: formatSize(state.totalBytes),
      });
    case 'ready':
      return t('codeStudio.packs.state.ready');
    case 'failed':
      return t('codeStudio.packs.state.failed', { reason: describePackError(state.reason) });
    case 'blocked':
      return t('codeStudio.packs.state.blocked', {
        reason: describePackError(state.reason === 'safe-mode' ? 'safeMode' : 'offline'),
      });
  }
}

/** Reads the list from the shell. A failure keeps the old list and says so. */
export async function refreshPacks(): Promise<PackList | null> {
  const packs = shell();
  if (!packs) {
    packsState.set((state) => ({ ...state, failed: true }));
    return null;
  }
  try {
    const list = await packs.list();
    packsState.set({ list, failed: false });
    return list;
  } catch {
    packsState.set((state) => ({ ...state, failed: true }));
    return null;
  }
}

/** True while any pack is downloading, so a screen knows to keep polling. */
export function anyPackDownloading(list: PackList | null): boolean {
  return list?.packs.some((pack) => pack.state.kind === 'downloading') ?? false;
}

/** Starts or resumes a download without asking. A refusal, such as Work offline, is shown and returned as false. */
export async function startPack(pack: PackInfo): Promise<boolean> {
  const packs = shell();
  if (!packs) return false;
  try {
    await packs.download(pack.id);
  } catch (error) {
    showToast({ message: describePackError(errorCode(error)), tone: 'danger' });
    return false;
  } finally {
    await refreshPacks();
  }
  return true;
}

/**
 * Asks, with the size and license, and starts the download if the person agrees. A pack that is partly downloaded
 * resumes without asking again, because the person already agreed to it.
 */
export async function downloadPack(pack: PackInfo): Promise<boolean> {
  if (pack.state.kind !== 'partial') {
    const body = [
      t('codeStudio.packs.confirmBody', { size: formatSize(pack.bytes) }),
      pack.license ? t('codeStudio.packs.confirmLicense', { license: pack.license }) : '',
    ]
      .filter(Boolean)
      .join(' ');
    const yes = await confirm({
      title: t('codeStudio.packs.confirmTitle', { name: pack.name }),
      body,
      confirmLabel: t('codeStudio.packs.confirmYes'),
      cancelLabel: t('codeStudio.packs.confirmNo'),
    });
    if (!yes) return false;
  }
  return startPack(pack);
}

export async function cancelPack(pack: PackInfo): Promise<void> {
  try {
    await shell()?.cancel(pack.id);
  } finally {
    await refreshPacks();
  }
}

/** Deletes a pack after the person confirms. */
export async function removePack(pack: PackInfo): Promise<boolean> {
  const yes = await confirm({
    title: t('codeStudio.packs.removeTitle', { name: pack.name }),
    body: t('codeStudio.packs.removeBody'),
    confirmLabel: t('codeStudio.packs.removeYes'),
    cancelLabel: t('codeStudio.packs.cancel'),
    danger: true,
  });
  if (!yes) return false;
  // A running download takes a moment to stop first, so say that something is happening.
  if (pack.state.kind === 'downloading') announce(t('codeStudio.packs.removing'));
  try {
    await shell()?.remove(pack.id);
  } catch (error) {
    showToast({ message: describePackError(errorCode(error)), tone: 'danger' });
  }
  await refreshPacks();
  return true;
}

/**
 * Settings, then Code, then Downloads: the one place for large downloads is the Models panel, in Settings, then
 * On-device intelligence. This opens it and brings the Code group into view.
 */
export function openCodeDownloads(): void {
  navigate({ view: 'settings', section: 'intel' });
  const reveal = (tries: number) => {
    const group = document.getElementById(CODE_DOWNLOADS_ID);
    if (group) {
      group.scrollIntoView({ block: 'start' });
      group.focus({ preventScroll: true });
    } else if (tries > 0) {
      requestAnimationFrame(() => reveal(tries - 1));
    }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => reveal(60));
}
