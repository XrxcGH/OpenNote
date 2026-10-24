// The quality-of-life choices the shell keeps in qol.json (docs/FEATURES.md, Portable mode keeps the file beside
// the program). Reads are cached for a moment so a screen that asks several times asks the shell once.

import { shellCall } from '../../platform/shellqol';

export interface HomeChoice {
  /** Section ids in the order shown. */
  readonly order?: readonly string[];
  readonly hidden?: readonly string[];
}

export interface QolPrefs {
  readonly startOnHome?: boolean;
  readonly lowPowerAuto?: boolean;
  readonly home?: HomeChoice;
  readonly dockWidth?: number;
  readonly [key: string]: unknown;
}

let cached: Promise<QolPrefs> | null = null;

export function readPrefs(): Promise<QolPrefs> {
  cached ??= shellCall<QolPrefs | null>('prefs.get').then(
    (prefs) => prefs ?? {},
    () => ({}),
  );
  return cached;
}

/** Changes some choices; a key set to null is forgotten. Resolves with all of them. */
export async function writePrefs(patch: Record<string, unknown>): Promise<QolPrefs> {
  cached = shellCall<QolPrefs | null>('prefs.set', { patch }).then(
    (prefs) => prefs ?? {},
    () => ({}),
  );
  return cached;
}

/** Forgets what was read, for tests. */
export function resetPrefsCache(): void {
  cached = null;
}
