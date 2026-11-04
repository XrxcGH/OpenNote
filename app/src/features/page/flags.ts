// Phase 4's flags (ARCHITECTURE.md section 2.2; PLAN.md section 3.1, owned by WP0). Each unfinished feature stays
// behind its flag, hidden rather than disabled, until it meets the definition of done. app/flags.ts joins these to
// Phase 2's list, so they load at start-up, before the page's chunk.
import type { FlagDef, FlagId } from '../../app/flags';
import { QOL_PAGE_FLAGS } from './qolFlags';

export type { QolPageFlagId } from './qolFlags';

/**
 * The flags of the text formatting program (Beta 9 to Beta 12). text:scaffold registers them all, off everywhere, so
 * each lane turns on only its own with an override. The Layout and Review tabs of the command bar read
 * text.layout and text.review. The lane that builds a feature owns its flag and removes it from WAITING in
 * app/flagUsage.test.ts when it reads the flag.
 */
export type TextFlagId =
  | 'text.runFormats'
  | 'text.paraFormats'
  | 'text.fontPicker'
  | 'text.styles2'
  | 'text.formatPane'
  | 'text.ruler'
  | 'text.symbols'
  | 'text.language'
  | 'text.footnotes'
  | 'text.review'
  | 'text.layout'
  | 'text.pasteFidelity'
  | 'text.findFormat';

export type PageFlagId = Extract<FlagId, `page.${string}` | 'editor.spelling' | 'editor.readAloud'>;

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
/** On in every build. */
const everywhere = { dev: true, nightly: true, beta: true, stable: true };

const flag = (id: PageFlagId | TextFlagId, description: string, enabled: FlagDef['enabled']): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled,
});

const nowhere = { dev: false, nightly: false, beta: false, stable: false };

const textFlag = (id: TextFlagId, description: string): FlagDef => flag(id, description, nowhere);

/** The text formatting flags. Off in Nightly, Beta, and Stable until the feature meets the definition of done. */
const TEXT_FLAGS: readonly FlagDef[] = [
  textFlag(
    'text.runFormats',
    'Character formatting that version 2 pages keep: weights, underline styles, spacing, and case.',
  ),
  textFlag(
    'text.paraFormats',
    'Paragraph formatting that version 2 pages keep: alignment, indents, spacing, and tabs.',
  ),
  textFlag('text.fontPicker', 'The font picker and the size box.'),
  textFlag('text.styles2', 'Text styles with paragraph and character parts.'),
  textFlag('text.formatPane', 'The Format pane for text.'),
  textFlag('text.ruler', 'The ruler above the page.'),
  textFlag('text.symbols', 'The symbol and special character picker.'),
  textFlag('text.language', 'Per-run language and text direction.'),
  textFlag('text.footnotes', 'Footnotes and endnotes.'),
  textFlag('text.review', 'The Review tab: comments, changes, and proofing.'),
  textFlag('text.layout', 'The Layout tab: breaks, columns, and vertical text.'),
  textFlag('text.pasteFidelity', 'Keeping text formatting when pasting.'),
  textFlag('text.findFormat', 'Finding and replacing by format.'),
];

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
  ...TEXT_FLAGS,
];
