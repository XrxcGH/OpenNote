// Per-device choices for the quality-of-life features. They are conveniences for this PC (a caret width, whether
// the line you type stays centered), so they live in the browser's storage, not in the notes folder. Every read
// and write is guarded: where storage is missing or full the defaults stay in effect for the session.
import { createStore, useStore } from '../../../state/store';

export type PasteSize = 'actual' | 'fit' | 'ask';

export interface PageExtrasPrefs {
  /** Keep the line with the caret at one height while typing. Off by default. */
  typewriter: boolean;
  /** Where the line sits, as a percentage of the page's height from the top. */
  typewriterAt: number;
  /** Draw the caret at the Windows text cursor width, or at `caretWidth`. */
  caretFollowsWindows: boolean;
  /** 1 to 6 px, used when the caret does not follow Windows. */
  caretWidth: number;
  /** A caret that does not blink. */
  caretSteady: boolean;
  /** How a pasted screenshot or image is sized. */
  pasteSize: PasteSize;
  /** Ask a site for its title when a web address is pasted. Off by default. */
  linkTitles: boolean;
  /** Show "3 of 5 done" beside a checklist. */
  doneCount: boolean;
  /** The table of contents pane is open. */
  toc: boolean;
  /** Show the word count and reading time under the page. */
  wordCount: boolean;
}

export const DEFAULT_PREFS: PageExtrasPrefs = {
  typewriter: false,
  typewriterAt: 50,
  caretFollowsWindows: true,
  caretWidth: 2,
  caretSteady: false,
  pasteSize: 'fit',
  linkTitles: false,
  doneCount: false,
  toc: false,
  wordCount: true,
};

const KEY = 'opennote.pageExtras';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));

/** Keeps only valid values, so a hand-edited or older entry never breaks the page. */
export function cleanPrefs(raw: unknown): PageExtrasPrefs {
  const found = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const bool = (key: keyof PageExtrasPrefs): boolean =>
    typeof found[key] === 'boolean' ? (found[key] as boolean) : (DEFAULT_PREFS[key] as boolean);
  const num = (key: keyof PageExtrasPrefs, min: number, max: number): number =>
    typeof found[key] === 'number' && Number.isFinite(found[key])
      ? clamp(found[key] as number, min, max)
      : (DEFAULT_PREFS[key] as number);
  const size = found.pasteSize;
  return {
    typewriter: bool('typewriter'),
    typewriterAt: num('typewriterAt', 20, 80),
    caretFollowsWindows: bool('caretFollowsWindows'),
    caretWidth: num('caretWidth', 1, 6),
    caretSteady: bool('caretSteady'),
    pasteSize: size === 'actual' || size === 'fit' || size === 'ask' ? size : DEFAULT_PREFS.pasteSize,
    linkTitles: bool('linkTitles'),
    doneCount: bool('doneCount'),
    toc: bool('toc'),
    wordCount: bool('wordCount'),
  };
}

function load(): PageExtrasPrefs {
  try {
    const text = globalThis.localStorage?.getItem(KEY);
    return cleanPrefs(text ? JSON.parse(text) : null);
  } catch {
    return DEFAULT_PREFS;
  }
}

export const pageExtrasPrefs = createStore<PageExtrasPrefs>(load(), 'page extras prefs');

/** Changes some choices and keeps them on this device. */
export function setPrefs(change: Partial<PageExtrasPrefs>): void {
  const next = cleanPrefs({ ...pageExtrasPrefs.get(), ...change });
  pageExtrasPrefs.set(next);
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    // The choice holds for this session.
  }
}

export function usePrefs<S>(select: (prefs: PageExtrasPrefs) => S): S {
  return useStore(pageExtrasPrefs, select);
}
