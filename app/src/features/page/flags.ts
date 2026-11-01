// Phase 4's flags (ARCHITECTURE.md section 2.2; PLAN.md section 3.1, owned by WP0). Each unfinished feature stays
// behind its flag, hidden rather than disabled, until it meets the definition of done. app/flags.ts joins these to
// Phase 2's list, so they load at start-up, before the page's chunk.
import type { FlagDef, FlagId } from '../../app/flags';
import { QOL_PAGE_FLAGS } from './qolFlags';

export type { QolPageFlagId } from './qolFlags';

export type PageFlagId = Extract<FlagId, `page.${string}` | 'editor.spelling' | 'editor.readAloud'>;

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
/** On in every build. */
const off = { dev: false, nightly: false, beta: false, stable: false };

const flag = (id: PageFlagId, description: string, enabled: FlagDef['enabled']): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled,
});

export const PAGE_FLAGS: readonly FlagDef[] = [
  flag('page.editor', 'Typed notes: the page view, text boxes, formatting, and undo.', everywhere),
  flag('page.images', 'Images, crop, and alt text.', everywhere),
  flag('page.tables', 'Tables.', everywhere),
  flag('page.codeHighlight', 'Highlighting in code blocks.', everywhere),
  flag('page.slashMenu', 'The slash menu and Turn into.', everywhere),
  flag('page.styles', 'Editable text styles.', everywhere),
  flag('page.outline', 'Outline moves and folding.', everywhere),
  flag('page.typingHelpers', 'AutoCorrect, and the date and time helpers.', everywhere),
  flag('page.pasteExtras', 'Source links, PDF line joining, and saving web images.', everywhere),
  flag('page.formattingBar', 'The formatting bar after touch and pen selections.', everywhere),
  flag('page.readingOrder', 'The Reading order pane.', everywhere),
  flag('page.history', 'Compare versions, restoring parts, named versions, and deleting history.', everywhere),
  flag('page.heicImport', 'Converting HEIC and TIFF images at import.', everywhere),
  flag('editor.spelling', 'Spell check and its settings.', everywhere),
  flag('editor.readAloud', 'Read aloud.', everywhere),
  ...QOL_PAGE_FLAGS,
];
