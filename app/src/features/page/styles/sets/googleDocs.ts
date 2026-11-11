// checks-disable-file brand-consistency: the colors of other apps' style sets are data, not this app's look
// The Google Docs style set: the styles of a new Docs document. Docs has no theme fonts, so every style names
// Arial through Normal text. fixtures/googleDocs.xml is the source of truth; the set test checks these values.
import type { StyleSheetJson } from '../model';
import type { ThemeFonts } from '../resolve';

const HEADING = { keepNext: true, keepLines: true } as const;

export const GOOGLE_DOCS_THEME: ThemeFonts = {};

export const GOOGLE_DOCS_SET: StyleSheetJson = {
  normal: {
    font: 'Arial',
    sizePt: 11,
    weight: 400,
    italic: false,
    textColor: 'theme:text',
    tracking: 0,
    align: 'start',
    before: 0,
    after: 0,
    line: { rule: 'multiple', value: 1.15 },
  },
  title: { ...HEADING, sizePt: 26, before: 0, after: 3 },
  subtitle: { ...HEADING, sizePt: 15, textColor: '#666666', before: 0, after: 16 },
  h1: { ...HEADING, sizePt: 20, before: 20, after: 6 },
  h2: { ...HEADING, sizePt: 16, before: 18, after: 6 },
  h3: { ...HEADING, sizePt: 14, textColor: '#434343', before: 16, after: 4 },
  h4: { ...HEADING, sizePt: 12, textColor: '#666666', before: 14, after: 4 },
  h5: { ...HEADING, sizePt: 11, textColor: '#666666', before: 12, after: 4 },
  h6: { ...HEADING, sizePt: 11, italic: true, textColor: '#666666', before: 12, after: 4 },
};
