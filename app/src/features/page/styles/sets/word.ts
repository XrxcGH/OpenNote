// checks-disable-file brand-consistency: the colors of other apps' style sets are data, not this app's look
// The Word style sets: Word 2013 to 2021 (the Office theme of Word 2016 to 2021) and Word for Microsoft 365 (the
// Office theme of 2023 and later). Sizes and spacing are in points, colors in lowercase #rrggbb, line spacing as a
// multiple on the 0.01 grid of SPEC R-PARA-1. The fixtures in fixtures/ are the source of truth; the set test
// checks every value here against them.
import type { StyleSheetJson } from '../model';
import type { ThemeFonts } from '../resolve';

const BASE = { weight: 400, italic: false, textColor: 'theme:text', tracking: 0, align: 'start', before: 0 } as const;
const HEADING = { keepNext: true, keepLines: true, after: 0 } as const;
const QUOTE_INDENT = { start: 43.2, end: 43.2, first: 0 };
const line = (value: number) => ({ rule: 'multiple', value });

export const WORD2016_THEME: ThemeFonts = { heading: 'Calibri Light', body: 'Calibri' };

export const WORD2016_SET: StyleSheetJson = {
  normal: { ...BASE, font: '+body', sizePt: 11, after: 8, line: line(1.08) },
  h1: { ...HEADING, font: '+heading', sizePt: 16, textColor: '#2f5496', before: 12 },
  h2: { ...HEADING, font: '+heading', sizePt: 13, textColor: '#2f5496', before: 2 },
  h3: { ...HEADING, font: '+heading', sizePt: 12, textColor: '#1f3763', before: 2 },
  h4: { ...HEADING, font: '+heading', italic: true, textColor: '#2f5496', before: 2 },
  h5: { ...HEADING, font: '+heading', textColor: '#2f5496', before: 2 },
  h6: { ...HEADING, font: '+heading', textColor: '#1f3763', before: 2 },
  h7: { ...HEADING, font: '+heading', italic: true, textColor: '#1f3763', before: 2 },
  h8: { ...HEADING, font: '+heading', sizePt: 10.5, textColor: '#272727', before: 2 },
  h9: { ...HEADING, font: '+heading', sizePt: 10.5, italic: true, textColor: '#272727', before: 2 },
  title: { font: '+heading', sizePt: 28, tracking: -0.5, after: 0, line: line(1), contextual: true },
  subtitle: { textColor: '#5a5a5a', tracking: 0.75, after: 8 },
  quote: { before: 10, after: 8, indent: QUOTE_INDENT, align: 'center', italic: true, textColor: '#404040' },
  quote2: { before: 18, after: 18, indent: QUOTE_INDENT, align: 'center', italic: true, textColor: '#4472c4' },
};

export const WORD365_THEME: ThemeFonts = { heading: 'Aptos Display', body: 'Aptos' };

export const WORD365_SET: StyleSheetJson = {
  normal: { ...BASE, font: '+body', sizePt: 12, after: 8, line: line(1.16) },
  h1: { ...HEADING, font: '+heading', sizePt: 20, textColor: '#0f4761', before: 18, after: 4 },
  h2: { ...HEADING, font: '+heading', sizePt: 16, textColor: '#0f4761', before: 8, after: 4 },
  h3: { ...HEADING, font: '+body', sizePt: 14, textColor: '#0f4761', before: 8, after: 4 },
  h4: { ...HEADING, font: '+body', italic: true, textColor: '#0f4761', before: 4, after: 2 },
  h5: { ...HEADING, font: '+body', textColor: '#0f4761', before: 4, after: 2 },
  h6: { ...HEADING, font: '+body', italic: true, textColor: '#595959', before: 2 },
  h7: { ...HEADING, font: '+body', textColor: '#595959', before: 2 },
  h8: { ...HEADING, font: '+body', italic: true, textColor: '#272727' },
  h9: { ...HEADING, font: '+body', textColor: '#272727' },
  title: { font: '+heading', sizePt: 28, tracking: -0.5, after: 4, line: line(1), contextual: true },
  subtitle: { sizePt: 14, textColor: '#595959', tracking: 0.75, after: 8 },
  quote: { before: 8, align: 'center', italic: true, textColor: '#404040' },
  quote2: { before: 18, after: 18, indent: QUOTE_INDENT, align: 'center', italic: true, textColor: '#0f4761' },
};
