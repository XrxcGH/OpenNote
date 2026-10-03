// Phase 4's flags (ARCHITECTURE.md section 2.2; PLAN.md section 3.1, owned by WP0). Each unfinished feature stays
// behind its flag, hidden rather than disabled, until it meets the definition of done. app/flags.ts joins these to
// Phase 2's list, so they load at start-up, before the page's chunk.
import type { FlagDef, FlagId } from '../../app/flags';

export type PageFlagId = Extract<FlagId, `page.${string}` | 'editor.spelling' | 'editor.readAloud'>;

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
/** On in development, nightly, and Beta builds, for testers; off in Stable until the feature is done. */
const building = { dev: true, nightly: true, beta: true, stable: false };
const off = { dev: false, nightly: false, beta: false, stable: false };

const flag = (id: PageFlagId, description: string, enabled: FlagDef['enabled']): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled,
});

export const PAGE_FLAGS: readonly FlagDef[] = [
  flag('page.editor', 'Typed notes: the page view, text boxes, formatting, and undo.', building),
  flag('page.images', 'Images, crop, and alt text.', building),
  flag('page.tables', 'Tables.', building),
  flag('page.codeHighlight', 'Highlighting in code blocks.', building),
  flag('page.slashMenu', 'The slash menu and Turn into.', building),
  flag('page.styles', 'Editable text styles.', building),
  flag('page.outline', 'Outline moves and folding.', building),
  flag('page.typingHelpers', 'AutoCorrect, and the date and time helpers.', building),
  flag('page.pasteExtras', 'Source links, PDF line joining, and saving web images.', building),
  flag('page.formattingBar', 'The formatting bar after touch and pen selections.', building),
  flag('page.readingOrder', 'The Reading order pane.', building),
  flag('page.history', 'Compare versions, restoring parts, named versions, and deleting history.', building),
  flag('page.imageRenditions', 'Display-size image renditions, if spike S3 needs them.', off),
  flag('page.heicImport', 'Converting HEIC and TIFF images at import.', building),
  flag('editor.spelling', 'Spell check and its settings.', building),
  flag('editor.readAloud', 'Read aloud.', building),
];
