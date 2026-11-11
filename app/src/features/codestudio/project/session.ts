// A project's personal session state on this device: breakpoints, watch expressions, open tabs, scroll
// positions, and console history, keyed by block ID (ADR 0069). It never goes into the page, so two devices never
// conflict over where a cursor was. Reading and writing never throw: blocked storage just means a fresh session.

import { applyMergePatch } from '../../../platform/mergePatch';

const PREFIX = 'opennote.codestudio.session.';

/** The most console lines kept, newest last. */
export const CONSOLE_HISTORY = 200;

export interface ProjectSession {
  /** 1-based line numbers by file ID. */
  breakpoints: Record<string, number[]>;
  watches: string[];
  /** File IDs in tab order. */
  openTabs: string[];
  activeTab: string | null;
  scroll: Record<string, { top: number; left: number }>;
  /** Commands typed in the console, newest last. */
  console: string[];
}

export const EMPTY_SESSION: ProjectSession = {
  breakpoints: {},
  watches: [],
  openTabs: [],
  activeTab: null,
  scroll: {},
  console: [],
};

const fresh = (): ProjectSession => structuredClone(EMPTY_SESSION);

const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** A stored session with every malformed part dropped. */
function clean(value: unknown): ProjectSession {
  const session = fresh();
  if (!isMap(value)) return session;
  if (isMap(value.breakpoints)) {
    for (const [file, lines] of Object.entries(value.breakpoints)) {
      if (!Array.isArray(lines)) continue;
      const kept = lines.filter((line): line is number => Number.isInteger(line) && line > 0);
      session.breakpoints[file] = [...new Set(kept)].sort((a, b) => a - b);
    }
  }
  session.watches = strings(value.watches);
  session.openTabs = strings(value.openTabs);
  session.activeTab = typeof value.activeTab === 'string' ? value.activeTab : null;
  if (isMap(value.scroll)) {
    for (const [file, at] of Object.entries(value.scroll)) {
      if (isMap(at) && typeof at.top === 'number' && typeof at.left === 'number') {
        session.scroll[file] = { top: at.top, left: at.left };
      }
    }
  }
  session.console = strings(value.console).slice(-CONSOLE_HISTORY);
  return session;
}

export function loadSession(block: string): ProjectSession {
  try {
    const text = localStorage.getItem(PREFIX + block);
    return text === null ? fresh() : clean(JSON.parse(text));
  } catch {
    return fresh();
  }
}

/** Merges a change into the block's session (RFC 7396: null removes a key) and returns the session saved. */
export function updateSession(block: string, patch: Record<string, unknown>): ProjectSession {
  const next = clean(applyMergePatch(loadSession(block) as unknown as Record<string, unknown>, patch));
  try {
    localStorage.setItem(PREFIX + block, JSON.stringify(next));
  } catch {
    // The studio keeps working; it just will not remember.
  }
  return next;
}

/** Adds a console command to the history, dropping the oldest past the cap. */
export function rememberCommand(block: string, command: string): ProjectSession {
  return updateSession(block, { console: [...loadSession(block).console, command].slice(-CONSOLE_HISTORY) });
}

export function clearSession(block: string): void {
  try {
    localStorage.removeItem(PREFIX + block);
  } catch {
    // Nothing to clear.
  }
}
