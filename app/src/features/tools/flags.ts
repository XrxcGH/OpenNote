// Flags for smart tables, charts, math, and the study tool windows (Phases 7 and 10). Each is on in every channel
// once its feature works end to end in the app; turning one off hides its commands, menu items, and blocks.
import type { FlagDef, FlagId } from '../../app/flags';

export type ExprFlagId = Extract<FlagId, `tables.${string}` | `math.${string}` | 'tools.windows'>;

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
];

/**
 * What a tool window asks of the page that is open: text for the caret or a graph for a code block. The page
 * listens for it at start-up (features/page/registrations/smart.ts), so the name lives here, where start-up code
 * may read it without loading the tool windows.
 */
export const INSERT_EVENT = 'opennote:insert-into-page';
