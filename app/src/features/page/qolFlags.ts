// The flags for the quality-of-life features of typed notes and the page chrome. Each is on in development,
// nightly, and Beta builds and off in Stable until the feature meets the definition of done. Settings for them
// live in qol/prefs.ts and show under Settings, then Editing.
import type { FlagDef } from '../../app/flags';

export type QolPageFlagId =
  | 'page.wrapImages'
  | 'page.attachments'
  | 'page.dropFiles'
  | 'page.checklistExtras'
  | 'page.pasteSize'
  | 'page.typewriter'
  | 'page.thickCaret'
  | 'page.linkTitles'
  | 'page.templates'
  | 'page.series'
  | 'page.markdownSource'
  | 'page.altDraft'
  | 'page.readingLock'
  | 'page.findReplace'
  | 'page.wordCount'
  | 'page.toc'
  | 'page.extractMerge'
  | 'page.embeds';

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const building = { dev: true, nightly: true, beta: true, stable: false };

const flag = (id: QolPageFlagId, description: string): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled: building,
});

export const QOL_PAGE_FLAGS: readonly FlagDef[] = [
  flag('page.wrapImages', 'Text that wraps around an image, or an image that stays in the line or alone.'),
  flag('page.attachments', 'Attached files that open in their own app and save back into the page.'),
  flag('page.dropFiles', 'Dropping files, PDFs, and links onto a page.'),
  flag('page.checklistExtras', 'Check all, finished-item order, and done counts for checklists.'),
  flag('page.pasteSize', 'The size of a pasted screenshot: actual size, fit to the column, or ask.'),
  flag('page.typewriter', 'Typewriter scrolling, which keeps the line you type at one height.'),
  flag('page.thickCaret', 'A caret that follows the Windows text cursor settings, or a width you choose.'),
  flag('page.linkTitles', 'Link titles on paste, which asks the site for its page title when you turn it on.'),
  flag('page.templates', 'Page templates and the template button.'),
  flag('page.series', 'New page in series.'),
  flag('page.markdownSource', 'The Markdown source view of a typed page.'),
  flag('page.altDraft', 'A first draft of alt text from the recognized text of an image.'),
  flag('page.readingLock', 'Reading mode, which locks a page against edits and ink.'),
  flag('page.findReplace', 'Find and replace on a page.'),
  flag('page.wordCount', 'Word count and reading time.'),
  flag('page.toc', 'The table of contents pane.'),
  flag('page.extractMerge', 'Extract to a new page, merge pages, and split at headings.'),
  flag('page.embeds', 'Page embeds, typed with ![[.'),
];
