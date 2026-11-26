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

/** The Windows sentences about text in pictures and handwriting that read otherwise on a Mac and on Linux. */
const ELSEWHERE = {
  'intel.offer.ocr': 'offerOcr',
  'intel.offer.handwriting': 'offerHandwriting',
  'intel.settings.handwriting.help': 'handwritingHelp',
  'intel.problems.languageUnavailable': 'languageUnavailable',
  'intel.problems.handwritingUnavailable': 'handwritingUnavailable',
} as const satisfies Partial<Record<MessageKey, string>>;

/** `key` as this system says it: the Mac or Linux sentence for one that names Windows, or `key` itself. */
export function platformText(key: MessageKey): MessageKey {
  const system = hostSystem();
  if (system === 'windows' || !(key in ELSEWHERE)) return key;
  return `platformIntel.${system === 'macos' ? 'macos' : 'linux'}.${ELSEWHERE[key as keyof typeof ELSEWHERE]}`;
}

/** Whether the button that opens Windows Settings belongs here. */
export function offersWindowsSettings(): boolean {
  return hostSystem() === 'windows';
}
