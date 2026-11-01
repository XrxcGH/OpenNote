// What works differently on macOS and Linux (ADR 0055). Settings, then About lists it, and "Show what works on
// this computer" opens that list. Each feature that needs Windows also says so where it is used: the intelligence
// settings name a missing engine, and the updater says how to update by hand.

import type { HostSystem } from './types';

/** A feature that is missing or works differently on a system, with the string key that explains it. */
export type SystemLimit =
  | 'textInPicturesTesseract'
  | 'handwriting'
  | 'readAloud'
  | 'hello'
  | 'pdf'
  | 'systemAudio'
  | 'shareTarget'
  | 'windowTools'
  | 'updates'
  | 'commandLine'
  | 'syncKeyring'
  | 'penPressure';

const BOTH: readonly SystemLimit[] = [
  'handwriting',
  'readAloud',
  'hello',
  'pdf',
  'shareTarget',
  'windowTools',
  'commandLine',
];

const LIMITS: Record<HostSystem, readonly SystemLimit[]> = {
  windows: [],
  macos: [...BOTH, 'systemAudio', 'updates'],
  linux: [...BOTH, 'textInPicturesTesseract', 'systemAudio', 'syncKeyring', 'penPressure'],
};

/** The limits of `system`, in the order the list shows them. Windows has none. */
export function systemLimits(system: HostSystem): readonly SystemLimit[] {
  return LIMITS[system];
}
