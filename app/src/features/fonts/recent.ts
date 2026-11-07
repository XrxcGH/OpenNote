// The recent fonts and the person's substitutions, kept on this device (localStorage; a device setting, so they
// never travel with a notebook). Font names are the only content, and they never leave the device.
import { createStore } from '../../state/store';
import { validFontName } from './service';

const RECENT_KEY = 'opennote.fonts.recent';
const SUBS_KEY = 'opennote.fonts.substitutions';
export const RECENT_LIMIT = 8;
/** The most stand-ins kept, so a corrupted entry cannot grow the list without end. */
export const SUBSTITUTION_LIMIT = 200;

function read(key: string): unknown {
  try {
    const text = localStorage.getItem(key);
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The list lasts until the window closes.
  }
}

function names(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value
        .filter((one): one is string => typeof one === 'string' && validFontName(one) !== null)
        .slice(0, RECENT_LIMIT)
    : [];
}

function pairs(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        (pair): pair is [string, string] =>
          typeof pair[1] === 'string' && validFontName(pair[0]) !== null && validFontName(pair[1]) !== null,
      )
      .slice(0, SUBSTITUTION_LIMIT),
  );
}

export const recentFonts = createStore<readonly string[]>(names(read(RECENT_KEY)), 'recent fonts');

/** Puts a font first in the recent list, once, and keeps the newest few. */
export function noteRecentFont(name: string): void {
  if (validFontName(name) === null || name.startsWith('+')) return;
  const next = [name, ...recentFonts.get().filter((one) => one.toLowerCase() !== name.toLowerCase())];
  const kept = next.slice(0, RECENT_LIMIT);
  write(RECENT_KEY, kept);
  recentFonts.set(kept);
}

export const substitutions = createStore<Readonly<Record<string, string>>>(pairs(read(SUBS_KEY)), 'font substitutions');

/** Chooses the stand-in for a missing font, or null to go back to automatic. */
export function setSubstitution(missing: string, standIn: string | null): void {
  const next = Object.fromEntries(
    Object.entries(substitutions.get()).filter(([key]) => key.toLowerCase() !== missing.toLowerCase()),
  );
  if (standIn !== null && validFontName(standIn) !== null && Object.keys(next).length < SUBSTITUTION_LIMIT) {
    next[missing] = standIn;
  }
  write(SUBS_KEY, next);
  substitutions.set(next);
}
