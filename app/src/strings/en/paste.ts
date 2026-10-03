// Paste messages and paste prompts (owner: WP5).
// Each namespace file has one owner, so parallel work never edits the same file.

export const paste = {
  tooLarge: 'This paste was too large to keep its formatting, so it was added as plain text.',
  pasted: 'Pasted.',
  plain: 'Paste as plain text',
  plainKeywords: 'paste text unformatted clean',
  copyAsMarkdown: 'Copy as Markdown',
  copyAsMarkdownKeywords: 'markdown obsidian copy text',
  copiedMarkdown: 'Copied as Markdown.',
  nothingToCopy: 'Select some text or blocks to copy.',
  source: 'Source: {host}',
  sourcePrompt: {
    message: 'Add source links to web pastes?',
    always: 'Always',
    never: 'Never',
  },
  joined: 'Joined broken lines.',
  undo: 'Undo',
  settings: {
    title: 'Paste',
    sourceLink: 'Source links below text from a browser',
    sourceLinkAsk: 'Ask the first time',
    sourceLinkAlways: 'Always add',
    sourceLinkNever: 'Never add',
    saveWebImages: 'Save images from web pastes',
    saveWebImagesHint: 'Downloads each image once, when you paste, so it stays in the page.',
    joinPdfLines: 'Join lines in text pasted from PDFs',
  },
} as const;
