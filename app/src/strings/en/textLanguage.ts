// Per-run language and text direction.
// Owner: text:language-direction (B11 and B12). text:scaffold registered it in the string index.
// Every interface string is a full sentence or a full label, never joined from pieces.

export const textLanguage = {
  language: 'Language',
  languageKeywords: 'language proofing spelling dictionary set language for selection paragraph',
  menuLabel: 'Language of the selected text',
  paragraphMenuLabel: 'Language of this paragraph',
  pageLanguage: 'Use the page language',
  noProof: 'Do not check spelling',
  noProofKeywords: 'do not check spelling proofing ignore skip no proof',
  rtl: 'Right-to-left text direction',
  rtlKeywords: 'right to left direction rtl bidi arabic hebrew persian urdu',
  ltr: 'Left-to-right text direction',
  ltrKeywords: 'left to right direction ltr bidi',
  hyphenate: 'Automatic hyphenation',
  hyphenateKeywords: 'hyphenation hyphenate hyphens break words',
  needsText: 'Select some text first.',
  setTo: 'Language set to {name}.',
  setToPage: 'The text now uses the page language.',
  noProofOn: 'Spelling will not be checked here.',
  noProofOff: 'Spelling will be checked here again.',
  rtlOn: 'The paragraph now reads right to left.',
  ltrOn: 'The paragraph now reads left to right.',
  hyphenateOn: 'Automatic hyphenation is on for this paragraph.',
  hyphenateOff: 'Automatic hyphenation is off for this paragraph.',
} as const;
