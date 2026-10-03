// Quick capture as the shell keeps it: whether the global shortcut is on and which keys it uses, plus the link to
// Windows pen settings, where the pen top button can be set to open OpenNote.

import { shellCall } from '../../platform/shellqol';

export interface QuickStatus {
  readonly choice: { readonly enabled: boolean; readonly key: string };
  /** False when another program already holds the keys. */
  readonly registered: boolean;
}

export const DEFAULT_QUICK: QuickStatus = { choice: { enabled: true, key: 'Ctrl+Alt+Q' }, registered: false };

export async function quickStatus(): Promise<QuickStatus> {
  return (await shellCall<QuickStatus | null>('quick.status').catch(() => null)) ?? DEFAULT_QUICK;
}

export async function setQuick(enabled: boolean, key: string): Promise<QuickStatus> {
  return (await shellCall<QuickStatus | null>('quick.set', { enabled, key })) ?? DEFAULT_QUICK;
}

export function openQuickCapture(): Promise<unknown> {
  return shellCall('quick.open');
}

/** Opens Windows settings on the pen page. */
export function openPenSettings(): Promise<unknown> {
  return shellCall('window.openPenSettings').catch(() => undefined);
}
