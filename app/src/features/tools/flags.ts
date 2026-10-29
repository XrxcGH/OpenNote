// Flags for smart tables, charts, math, and the study tool windows (Phases 7 and 10). Each is on in every channel
// once its feature works end to end in the app; turning one off hides its commands, menu items, and blocks.
import type { FlagDef, FlagId } from '../../app/flags';

export type ExprFlagId = Extract<FlagId, `tables.${string}` | `math.${string}` | `study.${string}` | `tools.${string}`>;

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const on = { dev: true, nightly: true, beta: true, stable: true };
/** On in Beta while it is new; off in Stable. */
const beta = { dev: true, nightly: true, beta: true, stable: false };

const flag = (id: ExprFlagId, description: string, enabled: FlagDef['enabled'] = on): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled,
});

export const EXPR_FLAGS: readonly FlagDef[] = [
  flag('tables.smart', 'Formulas, number formats, totals, sorting, filtering, and fill in tables.'),
  flag('tables.charts', 'Charts made from a table or a range of it.'),
  flag('math.latex', 'Drawn equations in text, with LaTeX input.'),
  flag('math.grapher', 'The function grapher block.'),
  flag('math.actions', 'Solve and Simplify on an equation.'),
  flag('tools.windows', 'Timers, the calculator, and Upcoming in tool windows.'),
  flag('tables.calculated', 'Calculated columns in smart tables.'),
  flag('tables.views', 'Board, calendar, gallery, and timeline views of a smart table.'),
  flag('tables.choice', 'Choice columns in smart tables: named, colored options to pick one or several from.'),
  flag('tables.analysis', 'Statistics, regression, and matrix tools that work from the cells of a smart table.'),
  flag('tables.savedViews', 'Saved views of a smart table, each with its own filters and sort.'),
  flag('tables.chartTable', 'The text summary, arrow-key reading, and Show as table for charts.'),
  flag('math.quickMath', 'Type a sum and an equals sign in text, then Space, to add the answer.'),
  flag('math.notes', 'Variables and units on page lines, with answers after the equals sign.'),
  flag('math.diagrams', 'Diagrams drawn from Mermaid text.'),
  flag('math.codeCells', 'Code cells that run Python and JavaScript on this device in a sandbox.', beta),
  flag('math.mindmapExport', 'Save a mind map as an SVG, PNG, or PDF picture.'),
  flag('math.mindmapPen', 'Build and edit a mind map with the pen: tap to write, drag to add or move a branch.'),
  flag('math.mindMaps', 'Mind maps that turn to and from an outline.'),
  flag('study.cards', 'Flashcard decks, review, card types, inline cards, generation, and exam dates.'),
  flag('study.import', 'Deck import and export for Anki packages, CSV, and text.'),
  flag('study.tape', 'Study tape that hides parts of a page until tapped.'),
  flag('study.tapeBlanks', 'Print and export can turn study tape into blanks, with an answer key at the end.'),
  flag('tools.converter', 'The unit converter tool.'),
  flag('tools.reference', 'The reference tables tool.'),
  flag('tools.symbols', 'The symbol palette, with recent symbols and LaTeX-name autocompletion in page text.'),
  flag('tools.dictionary', 'The dictionary and thesaurus tool.'),
  flag('tools.exams', 'Exam countdowns in Upcoming.'),
  flag('tools.timetable', 'The class timetable in Upcoming.'),
  flag('tools.dueDates', 'Due dates read from checkboxes and tagged lines on pages.'),
  flag('tools.reminders', 'Windows notifications for due items and finished timers.'),
  flag('tools.citations', 'The citation helper with BibTeX, RIS, and Zotero.'),
  flag('tools.zotero', 'Zotero citations and bibliographies in the page, using the windows Zotero provides.'),
  flag('tools.constants', 'The scientific constants picker with CODATA 2022 values.'),
  flag('tools.sigfigs', 'The significant-figures helper and its mode in the calculator and on page lines.'),
  flag('math.latexInsert', 'The Insert LaTeX window with live preview, snippets, and paste conversion.'),
  flag('tools.chemCalc', 'Chemistry calculators: balancing, stoichiometry, gas laws, dilution, pH, and titration.'),
  flag('tools.structure', 'Chemical structure drawing: skeletal formulas as editable ink, with SVG export.'),
  flag('tools.properties', 'Steam, ideal-gas, and materials property tables with sources.'),
];

/**
 * What a tool window asks of the page that is open: text for the caret or a graph for a code block. The page
 * listens for it at start-up (features/page/registrations/smart.ts), so the name lives here, where start-up code
 * may read it without loading the tool windows.
 */
export const INSERT_EVENT = 'opennote:insert-into-page';

/**
 * What the Citations window asks of the page that is open: run a Zotero command on it. The page answers by setting
 * `result` to a promise (features/page/registrations/zotero.ts), so the window need not load the editor.
 */
export const ZOTERO_EVENT = 'opennote:zotero-command';

// The statistical models kit's tool list is plain data the command palette reads at start-up, so it is public here.
export { STATMODELS_TOOLS } from './statmodels/meta';
export { STATMODELS_FLAGS } from './statmodels/flags';
export type { StatModelsFlagId } from './statmodels/flags';
/**
 * What a subject kit's data field asks of the page that is open: its blocks, so the student can pick a table. The
 * page answers by setting `blocks` (features/page/registrations/kitSubjects.ts); no answer means no page is open.
 */
export const SUBJECT_TABLES_EVENT = 'opennote:subject-page-tables';

// The tool kits' flags live with the kits; they are public here, like every flag of the tools feature.
export { KIT_FLAGS } from './kits/flags';
export type { KitFlagId } from './kits/flags';
