// The built-in style sets (text DESIGN.md 2.4): OpenNote, Word 2013 to 2021, Word for Microsoft 365, and Google
// Docs. Choosing one replaces the notebook's built-in styles with the set's and keeps its user styles.
import type { StyleJson, StyleSheetJson } from '../model';
import type { ThemeFonts } from '../resolve';
import { GOOGLE_DOCS_SET, GOOGLE_DOCS_THEME } from './googleDocs';
import { OPENNOTE_SET, OPENNOTE_THEME } from './opennote';
import { WORD2016_SET, WORD2016_THEME, WORD365_SET, WORD365_THEME } from './word';

export type StyleSetId = 'opennote' | 'word2016' | 'word365' | 'googleDocs';

export interface StyleSet {
  readonly id: StyleSetId;
  readonly styles: StyleSheetJson;
  readonly theme: ThemeFonts;
}

export const STYLE_SETS: readonly StyleSet[] = [
  { id: 'opennote', styles: OPENNOTE_SET, theme: OPENNOTE_THEME },
  { id: 'word2016', styles: WORD2016_SET, theme: WORD2016_THEME },
  { id: 'word365', styles: WORD365_SET, theme: WORD365_THEME },
  { id: 'googleDocs', styles: GOOGLE_DOCS_SET, theme: GOOGLE_DOCS_THEME },
];

/** The app's own styles: the OpenNote set (SPEC R-STY-1's Default column). */
export const APP_STYLES: StyleSheetJson = OPENNOTE_SET;

export function styleSet(id: string): StyleSet | undefined {
  return STYLE_SETS.find((set) => set.id === id);
}

/**
 * A set's styles as a notebook keeps them. The notebook has no theme of its own yet, so each token that the set's
 * theme names becomes that font; the app's own tokens stay tokens.
 */
export function setStylesForNotebook(set: StyleSet): StyleSheetJson {
  const out: Record<string, StyleJson> = {};
  for (const [name, style] of Object.entries(set.styles)) {
    const font = style.font;
    const key = typeof font === 'string' && font.startsWith('+') ? (font.slice(1) as keyof ThemeFonts) : null;
    const named = key ? set.theme[key] : undefined;
    out[name] = named ? { ...style, font: named } : { ...style };
  }
  return out;
}

/** The notebook's styles after choosing a set: the set's built-in styles, and the notebook's user styles kept. */
export function withStyleSet(current: StyleSheetJson, set: StyleSet): StyleSheetJson {
  const user = Object.fromEntries(Object.entries(current).filter(([name]) => name.startsWith('u-')));
  return { ...setStylesForNotebook(set), ...user };
}
