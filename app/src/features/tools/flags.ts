// Flags for smart tables, charts, math, and the study tool windows (Phases 7 and 10). Each is on in every channel
// once its feature works end to end in the app; turning one off hides its commands, menu items, and blocks.
import type { FlagDef, FlagId } from '../../app/flags';

export type ExprFlagId = Extract<FlagId, `tables.${string}` | `math.${string}` | `study.${string}` | `tools.${string}`>;

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const on = { dev: true, nightly: true, beta: true, stable: true };

const flag = (id: ExprFlagId, description: string): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled: on,
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
  flag('tables.chartTable', 'The text summary, arrow-key reading, and Show as table for charts.'),
  flag('math.quickMath', 'Type a sum and an equals sign in text, then Space, to add the answer.'),
  flag('math.notes', 'Variables and units on page lines, with answers after the equals sign.'),
  flag('math.diagrams', 'Diagrams drawn from Mermaid text.'),
  flag('math.mindMaps', 'Mind maps that turn to and from an outline.'),
  flag('study.cards', 'Flashcard decks, review, card types, inline cards, generation, and exam dates.'),
  flag('study.import', 'Deck import and export for Anki packages, CSV, and text.'),
  flag('study.tape', 'Study tape that hides parts of a page until tapped.'),
  flag('tools.converter', 'The unit converter tool.'),
  flag('tools.reference', 'The reference tables tool.'),
  flag('tools.dictionary', 'The dictionary and thesaurus tool.'),
  flag('tools.exams', 'Exam countdowns in Upcoming.'),
  flag('tools.timetable', 'The class timetable in Upcoming.'),
  flag('tools.dueDates', 'Due dates read from checkboxes and tagged lines on pages.'),
  flag('tools.reminders', 'Windows notifications for due items and finished timers.'),
  flag('tools.citations', 'The citation helper with BibTeX, RIS, and Zotero.'),
];

/**
 * What a tool window asks of the page that is open: text for the caret or a graph for a code block. The page
 * listens for it at start-up (features/page/registrations/smart.ts), so the name lives here, where start-up code
 * may read it without loading the tool windows.
 */
export const INSERT_EVENT = 'opennote:insert-into-page';
