// The OpenNote style set: the app's own value of each style (SPEC R-STY-1's Default column). It comes from today's
// type tokens (theme/tokens.ts `type`), in points (px x 3/4, on the 0.5 pt grid of SPEC D.3). The fixture
// fixtures/opennote.json names the token of each value, and the set test reads the tokens through it.
import type { StyleSheetJson } from '../model';
import type { ThemeFonts } from '../resolve';

export const OPENNOTE_THEME: ThemeFonts = {};

export const OPENNOTE_SET: StyleSheetJson = {
  normal: { font: '+body', sizePt: 12 },
  title: { font: '+heading', sizePt: 27, weight: 600, order: 0 },
  subtitle: { font: '+heading', sizePt: 13, order: 1 },
  h1: { font: '+heading', sizePt: 22.5, weight: 700, keepNext: true, order: 3 },
  h2: { font: '+heading', sizePt: 18, weight: 700, keepNext: true, order: 4 },
  h3: { font: '+heading', sizePt: 15, weight: 600, keepNext: true, order: 5 },
  h4: { font: '+heading', sizePt: 13, weight: 600, keepNext: true, order: 6 },
  h5: { font: '+heading', sizePt: 12, weight: 600, keepNext: true, order: 7 },
  h6: { font: '+heading', sizePt: 11.5, weight: 600, keepNext: true, order: 8 },
  h7: { font: '+heading', sizePt: 11.5, weight: 600, italic: true, keepNext: true, order: 9, hidden: true },
  h8: { font: '+heading', sizePt: 11.5, weight: 500, keepNext: true, order: 10, hidden: true },
  h9: { font: '+heading', sizePt: 11.5, weight: 500, italic: true, keepNext: true, order: 11, hidden: true },
  quote: { italic: true, order: 12 },
  quote2: { italic: true, weight: 600, order: 13 },
  citation: { sizePt: 10, italic: true, order: 14 },
  code: { font: '+mono', sizePt: 10, order: 15 },
};
