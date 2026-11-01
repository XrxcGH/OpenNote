// What a recognition feature needs on the system the app runs on. Windows names its language pack and opens its
// own settings page; a Mac reads with Vision, which needs nothing added; Linux reads with Tesseract, a package the
// person installs. Read aloud and the rest keep their own text everywhere.

import { hostSystem } from '../../platform/system';
import type { MessageKey } from '../../strings/t';
import type { OnDeviceFeature } from './runtime';

const READS: readonly OnDeviceFeature[] = ['ocr', 'handwriting'];

/** The sentence that says what `feature` is missing here, or `fallback`, the Windows one. */
export function platformNeeds(feature: OnDeviceFeature, fallback: MessageKey): MessageKey {
  if (!READS.includes(feature)) return fallback;
  const system = hostSystem();
  if (system === 'linux') return 'platformIntel.needs.tesseract';
  if (system === 'macos') return 'platformIntel.needs.vision';
  return fallback;
}

/** Whether the button that opens Windows Settings belongs here. */
export function offersWindowsSettings(): boolean {
  return hostSystem() === 'windows';
}
