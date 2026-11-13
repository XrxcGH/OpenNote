// The sentences of the Format pane, language and direction, and ruler commands (Beta 11 text lanes), kept here so
// featureCommands.ts stays under its size limit.

export const TEXT_PANE_TEXT: Readonly<Record<string, string>> = {
  'text.setLanguage': 'Sets the language of the selected text or paragraph, for spell check and hyphenation.',
  'text.noProof': 'Turns spell check off or on for the selected text or paragraph.',
  'text.paragraphRtl': 'Makes the paragraph read right to left, with its start on the right.',
  'text.paragraphLtr': 'Makes the paragraph read left to right.',
  'text.hyphenate': 'Turns automatic hyphenation on or off for the paragraph, by its language.',
  'format.fontDialog':
    'Opens the Format pane on the Text tab: font, size, color, underline, effects, and a preview of the selected text.',
  'format.paragraphDialog':
    'Opens the Format pane on the Paragraph tab: alignment, indents, spacing, line spacing, and pagination.',
  'format.reveal': 'Says where each format at the caret comes from: the run, the paragraph, or its style.',
  'view.ruler': 'Shows or hides the ruler above the text, with the indents and the tab stops.',
};
