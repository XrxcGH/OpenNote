// What works differently on macOS and Linux (ADR 0055). Settings, then About lists it, and "Show what works on
// this computer" opens that list. Each feature that needs Windows also says so where it is used: the intelligence
// settings name a missing engine, and the updater says how to update by hand.

import type { HostSystem } from './types';

/** A feature that is missing or works differently on a system, with the string key that explains it. */
export type SystemLimit =
  | 'textInPicturesTesseract'
  | 'handwritingTesseract'
  | 'systemTools'
  | 'hello'
  | 'systemAudio'
  | 'shareTarget'
  | 'windowTools'
  | 'syncKeyring'
  | 'penPressure';

const BOTH: readonly SystemLimit[] = ['hello', 'shareTarget', 'windowTools'];

const LIMITS: Record<HostSystem, readonly SystemLimit[]> = {
  windows: [],
  macos: [...BOTH, 'systemAudio'],
  linux: [
    ...BOTH,
    'textInPicturesTesseract',
    'handwritingTesseract',
    'systemTools',
    'systemAudio',
    'syncKeyring',
    'penPressure',
  ],
};

/** The limits of `system`, in the order the list shows them. Windows has none. */
export function systemLimits(system: HostSystem): readonly SystemLimit[] {
  return LIMITS[system];
}
