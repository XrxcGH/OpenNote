// Phase 6's flags (ARCHITECTURE.md section 2.2). Each feature is on in every channel once it works end to end in the
// running app, and off until then. app/flags.ts joins these to the rest, so they load at start-up.
import type { FlagDef, FlagId } from '../../app/flags';

export type PagesFlagId = Extract<FlagId, `pages.${string}`>;

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const building = { dev: true, nightly: true, beta: false, stable: false };

const flag = (id: PagesFlagId, description: string, enabled: FlagDef['enabled']): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled,
});

export const PAGES_FLAGS: readonly FlagDef[] = [
  flag('pages.view', 'Page breaks, paper size, and paper backgrounds in the View tab.', building),
  flag('pages.pdf', 'Print and Export as PDF through WebView2.', building),
  flag('pages.exportText', 'Export a page as Markdown or a web page.', building),
  flag('pages.exportImage', 'Export a selection or the page as a PNG or SVG picture.', building),
  flag('pages.gallery', 'The page gallery with thumbnails and reordering.', building),
  flag('pages.slides', 'Present a page as slides.', building),
  flag('pages.reading', 'Reading aids: line focus, tint, spacing, and syllable breaks.', building),
];
