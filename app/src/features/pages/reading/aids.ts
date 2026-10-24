// Reading aids (FEATURES.md, Phase 6) are a line focus band, soft page tints, wider spacing, a maximum line width, and
// syllable breaks. They change only how a page is shown, never the note, so they are a device setting and never reach
// page.json. This file reads and writes the setting and turns it into styles.

import { tokenVar } from '../paper/svg';

export type FocusLines = 0 | 1 | 3 | 5;
export type Tint = 'none' | 'cream' | 'sepia' | 'gray';
/** A step of extra spacing: 0 for none, then 1 to 3. */
export type Step = 0 | 1 | 2 | 3;

export interface ReadingAids {
  /** How many lines the focus band lights. 0 turns it off. */
  readonly focus: FocusLines;
  readonly tint: Tint;
  readonly wordSpace: Step;
  readonly paragraphSpace: Step;
  /** The longest line in characters, from 30 to 120, or null for no limit. */
  readonly maxLine: number | null;
  readonly syllables: boolean;
}

export const DEFAULT_READING: ReadingAids = {
  focus: 0,
  tint: 'none',
  wordSpace: 0,
  paragraphSpace: 0,
  maxLine: null,
  syllables: false,
};

export const FOCUS_SIZES: readonly FocusLines[] = [0, 1, 3, 5];
export const TINTS: readonly Tint[] = ['none', 'cream', 'sepia', 'gray'];
export const LINE_LIMITS = { min: 30, max: 120 } as const;

/** Extra space between words for each step, in em. */
export const WORD_SPACE_EM: readonly number[] = [0, 0.08, 0.16, 0.24];
/** Extra space between paragraphs for each step, in em. */
export const PARAGRAPH_SPACE_EM: readonly number[] = [0, 0.4, 0.8, 1.2];

/**
 * A tint is the page color mixed with a theme color, so it never adds a color of its own and follows both themes. The
 * shares are small enough to keep body text above the 7:1 contrast the page color is checked for (see the tests).
 */
export const TINT_MIX: Readonly<Record<Exclude<Tint, 'none'>, { readonly token: string; readonly percent: number }>> = {
  cream: { token: 'accent.clay', percent: 5 },
  sepia: { token: 'accent.clay', percent: 12 },
  gray: { token: 'border.control', percent: 10 },
};

export interface ReadingWarning {
  readonly kind: 'badValue';
  readonly path: keyof ReadingAids;
}

export interface ReadingRead {
  readonly aids: ReadingAids;
  readonly warnings: readonly ReadingWarning[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reads the stored setting. A value it cannot use falls back to its default and is reported. */
export function readReading(raw: unknown): ReadingRead {
  const source = isObject(raw) ? raw : {};
  const warnings: ReadingWarning[] = [];
  const pick = <K extends keyof ReadingAids>(key: K, ok: (v: unknown) => v is ReadingAids[K]): ReadingAids[K] => {
    if (!(key in source)) return DEFAULT_READING[key];
    if (ok(source[key])) return source[key];
    warnings.push({ kind: 'badValue', path: key });
    return DEFAULT_READING[key];
  };
  const step = (v: unknown): v is Step => v === 0 || v === 1 || v === 2 || v === 3;
  const aids: ReadingAids = {
    focus: pick('focus', (v): v is FocusLines => FOCUS_SIZES.includes(v as FocusLines)),
    tint: pick('tint', (v): v is Tint => TINTS.includes(v as Tint)),
    wordSpace: pick('wordSpace', step),
    paragraphSpace: pick('paragraphSpace', step),
    maxLine: pick(
      'maxLine',
      (v): v is number | null =>
        v === null || (typeof v === 'number' && Number.isInteger(v) && v >= LINE_LIMITS.min && v <= LINE_LIMITS.max),
    ),
    syllables: pick('syllables', (v): v is boolean => typeof v === 'boolean'),
  };
  return { aids, warnings };
}

/** The setting as stored: only what differs from the default, so a plain reader writes `{}`. */
export function writeReading(aids: ReadingAids): Partial<ReadingAids> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_READING) as (keyof ReadingAids)[]) {
    if (aids[key] !== DEFAULT_READING[key]) out[key] = aids[key];
  }
  return out as Partial<ReadingAids>;
}

/** True when any aid changes how the page looks. */
export function isActive(aids: ReadingAids): boolean {
  return (Object.keys(DEFAULT_READING) as (keyof ReadingAids)[]).some((k) => aids[k] !== DEFAULT_READING[k]);
}

/** The CSS color of a page tint, or null for none. */
export function tintColor(tint: Tint): string | null {
  if (tint === 'none') return null;
  const { token, percent } = TINT_MIX[tint];
  return `color-mix(in srgb, ${tokenVar('surface.page')} ${100 - percent}%, ${tokenVar(token)} ${percent}%)`;
}

export interface ReadingStyle {
  /** CSS custom properties for the reading view's root. A property with no value is left out. */
  readonly vars: Readonly<Record<string, string>>;
  /** Styles for the text of the page, as a stylesheet, using the properties above. */
  readonly css: string;
}

/** The styles of a reading view. The focus band and syllable breaks are not styles, so they are not here. */
export function readingStyle(aids: ReadingAids): ReadingStyle {
  const vars: Record<string, string> = {};
  const tint = tintColor(aids.tint);
  if (tint) vars['--reading-page'] = tint;
  if (aids.wordSpace > 0) vars['--reading-word-space'] = `${WORD_SPACE_EM[aids.wordSpace]}em`;
  if (aids.paragraphSpace > 0) vars['--reading-paragraph-space'] = `${PARAGRAPH_SPACE_EM[aids.paragraphSpace]}em`;
  if (aids.maxLine !== null) vars['--reading-measure'] = `${aids.maxLine}ch`;
  const rules: string[] = [];
  if (tint) rules.push('.reading-page { background: var(--reading-page); }');
  const text: string[] = [];
  if (aids.wordSpace > 0) text.push('word-spacing: var(--reading-word-space);');
  if (aids.maxLine !== null) text.push('max-inline-size: var(--reading-measure);');
  if (aids.syllables) text.push('hyphens: manual;');
  if (text.length > 0) rules.push(`.reading-text { ${text.join(' ')} }`);
  if (aids.paragraphSpace > 0) {
    rules.push('.reading-text > * + * { margin-block-start: var(--reading-paragraph-space); }');
  }
  return { vars, css: rules.join('\n') };
}
