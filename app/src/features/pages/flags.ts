// Phase 6's flags (ARCHITECTURE.md section 2.2). Each feature is on in every channel once it works end to end in the
// running app, and off until then. app/flags.ts joins these to the rest, so they load at start-up.
import type { FlagDef, FlagId } from '../../app/flags';

export type PagesFlagId = Extract<FlagId, `pages.${string}`>;

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const on = { dev: true, nightly: true, beta: true, stable: true };

const flag = (id: PagesFlagId, description: string, enabled: FlagDef['enabled']): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled,
});

export const PAGES_FLAGS: readonly FlagDef[] = [
  flag('pages.view', 'Page breaks, paper size, and paper backgrounds in the View tab.', on),
  flag('pages.pdf', 'Print and Export as PDF through WebView2.', on),
  flag('pages.exportText', 'Export a page as Markdown or a web page.', on),
  flag('pages.exportImage', 'Export a selection or the page as a PNG or SVG picture.', on),
  flag('pages.gallery', 'The page gallery with thumbnails and reordering.', on),
  flag('pages.slides', 'Present a page as slides.', on),
  flag('pages.reading', 'Reading aids: line focus, page tints, spacing, and line width.', on),
  flag('pages.layouts', 'Template layouts, custom spacing, saved layout templates, and a notebook default.', on),
  flag('pages.sheets', 'The sheet navigator: thumbnails, Go to sheet, flipping, and adding a sheet.', on),
  flag('pages.accessiblePdf', 'Tagged PDF with bookmarks and a language through the DevTools route.', on),
  flag('pages.elements', 'The elements library: Save as element, folders, search, insert, and files.', on),
  flag('pages.exportSelection', 'Export or copy the lasso selection as PDF, PNG, SVG, Word, or an image.', on),
  flag('pages.laser', 'Present a whole page full screen with a laser pointer and ink that fades.', on),
  flag('pages.syllables', 'Syllable marks in the reading view, drawn over the text without changing it.', on),
];
