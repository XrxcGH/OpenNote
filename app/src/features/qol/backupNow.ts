// Back up now, from the palette and from Settings > Storage. With no backup folder chosen yet the shell refuses,
// so this asks for one and offers the setting, instead of "The backup could not run." (full walk A-A03-5).

import { navigate } from '../../app/location';
import { shellCall } from '../../platform/shellqol';
import { t } from '../../strings/t';
import { showToast } from '../../ui';

/** Runs a backup now. Resolves true when it finished. */
export async function runBackupNow(): Promise<boolean> {
  const status = await shellCall<{ config?: { destination?: string } } | null>('backup.status').catch(() => null);
  if (!status?.config?.destination?.trim()) {
    showToast({
      message: t('qol.backup.needsFolder'),
      action: {
        label: t('qol.backup.choose'),
        run: () => navigate({ view: 'settings', section: 'storage' }),
      },
    });
    return false;
  }
  try {
    await shellCall('backup.run');
    showToast({ message: t('qol.backup.done') });
    return true;
  } catch {
    showToast({ message: t('qol.backup.failed'), tone: 'danger' });
    return false;
  }
}

/** How many copies each kind of backup keeps, as the shell clamps them (src-tauri/src/shellqol/backup.rs). */
export const COPY_RANGES = {
  daily: [1, 60],
  weekly: [0, 52],
  monthly: [0, 60],
} as const satisfies Record<string, readonly [number, number]>;

/** The whole number a copies box holds, or null when the text is not one in `range`. */
export function parseCopies(text: string, [min, max]: readonly [number, number]): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}
