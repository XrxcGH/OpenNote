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
  flag('ink.paperSnap', 'Lines, arrows, and shapes snap to the lines of ruled, grid, and dot paper.', beta),
  flag('ink.replay', 'Ink replay.', on),
  flag('ink.shapeTools', 'More shapes, editable handles, connectors, and shape libraries.', on),
  flag('ink.handwriting', 'Writing pen, convert with the lasso, and tidy handwriting.', on),
  flag('ink.gridTable', 'Draw a grid to make a table.', on),
  flag('ink.penEditing', 'Edit typed text with the pen.', on),
  // ink.delegatedTrail, ink.nativeTrail, ink.openSnapshot, and dev.penRecorder aren't built yet, so they have no
  // entry and stay off.
];

/** The ink view: the pointer tools, the Draw tab, and the ink over the shown page. It loads with the first page. */
export const loadInkView = () => import('./view/install');
