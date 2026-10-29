// Phase 5's flags (ARCHITECTURE.md section 2.2), and the loader of the ink view. app/flags.ts joins these to Phase
// 2's list, so this file loads at start-up, before the ink chunk. It is the feature's light public face; index.ts
// is its full one. A feature turns on when it works end to end in the app, and the rest stay off.
import type { FlagDef, FlagId } from '../../app/flags';

export type InkFlagId = Extract<FlagId, `ink.${string}` | 'dev.penRecorder'>;

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const on = { dev: true, nightly: true, beta: true, stable: true };
/** On through Beta while it gets its first hands-on use, and off in Stable until then. */
const beta = { dev: true, nightly: true, beta: true, stable: false };

const flag = (id: InkFlagId, description: string, enabled: FlagDef['enabled']): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled,
});

export const INK_FLAGS: readonly FlagDef[] = [
  flag('ink.core', 'Pens and highlighters.', on),
  flag('ink.erasers', 'Erasers.', on),
  flag('ink.lasso', 'The lasso.', on),
  flag('ink.shapes', 'Shapes.', on),
  flag('ink.palm', 'Palm rejection.', on),
  flag('ink.penButtons', 'Pen buttons.', on),
  flag('ink.gestures', 'Scribble to erase, circle and tap, and two- and three-finger taps.', on),
  flag('ink.insertSpace', 'Insert space: drag a line to push content down.', on),
  flag('ink.anchoring', 'Ink that follows the text it was drawn on.', on),
  flag('ink.zoomBox', 'The zoom writing box.', on),
  flag('ink.steadyPen', 'Pressure curves and the steady pen.', on),
  flag('ink.describe', 'Describe a drawing (alt text for ink).', on),
  flag('ink.hover', 'Pen hover preview.', on),
  flag('ink.canvasLock', 'Canvas lock.', on),
  flag('ink.snapTools', 'Ruler, protractor, and snap to grid.', on),
  flag('ink.geometry', 'A measuring ruler in centimeters or inches, the measure, and the geometry compass.', beta),
  flag('ink.paperSnap', 'Lines, arrows, and shapes snap to the lines of ruled, grid, and dot paper.', beta),
  flag('ink.replay', 'Ink replay.', on),
  flag(
    'ink.shapeTools',
    'More shapes (including irregular polygons), editable handles, connectors, and shape libraries.',
    on,
  ),
  flag(
    'ink.splines',
    'Editable curves: lines, connectors, shapes, and ink become curves with points and handles to bend them.',
    beta,
  ),
  flag('ink.handwriting', 'Writing pen, convert with the lasso, and tidy handwriting.', on),
  flag('ink.gridTable', 'Draw a grid to make a table.', on),
  flag('ink.penEditing', 'Edit typed text with the pen.', on),
  flag('ink.groups', 'Group ink, text boxes and images into one object (ADR 0036).', beta),
  flag('ink.penLibrary', 'Fountain, brush, calligraphy, dashed and dotted pens, and saved pen sets.', beta),
  flag('ink.links', 'Make handwriting a link to a page, a heading, a web address or a recording moment.', beta),
  flag('ink.layers', 'Named ink layers that can be hidden, locked, renamed and reordered (ADR 0037).', beta),
  flag('ink.delegatedTrail', 'A trail the browser draws behind the pen ahead of the page (ADR 0004).', beta),
  flag(
    'ink.myHandwriting',
    'My handwriting: calibrate with the pen, then write typed text and math in your own hand.',
    beta,
  ),
  flag('ink.penFields', 'The pen opens the handwriting panel in the search box, rename fields and table cells.', beta),
  flag('dev.penRecorder', 'The Palm lab: record labeled pen and touch sessions for the palm corpus.', {
    dev: true,
    nightly: true,
    beta: true,
    stable: false,
  }),
];

/** The ink view: the pointer tools, the Draw tab, and the ink over the shown page. It loads with the first page. */
export const loadInkView = () => import('./view/install');

/** The Settings sections for pen and touch and My handwriting: listed from start-up, loaded when opened. */
export const loadPenSettings = () => import('./view/PenSettings');
export const loadMyHandSection = () => import('./view/myhand/MyHandSection');
