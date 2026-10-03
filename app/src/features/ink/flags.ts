// Phase 5's flags (ARCHITECTURE.md section 2.2), and the loader of the ink view. app/flags.ts joins these to Phase
// 2's list, so this file loads at start-up, before the ink chunk: it is the feature's light public face, as
// index.ts is its full one. A feature turns on when it works end to end in the app; the rest stay off.
import type { FlagDef, FlagId } from '../../app/flags';

export type InkFlagId = Extract<FlagId, `ink.${string}` | 'dev.penRecorder'>;

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const on = { dev: true, nightly: true, beta: true, stable: true };

const flag = (id: InkFlagId, description: string, enabled: FlagDef['enabled']): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled,
});

export const INK_FLAGS: readonly FlagDef[] = [
  flag('ink.core', 'Pens, pencil, and highlighter, saved with the page, with undo and cached tiles.', on),
  flag('ink.erasers', 'The stroke eraser and the partial eraser.', on),
  flag('ink.lasso', 'The lasso: move, resize, recolor, and delete ink with text.', on),
  flag('ink.shapes', 'Shape recognition: hold to snap, and Ink to shape.', on),
  flag('ink.palm', 'Palm rejection for touch, and drawing with a finger.', on),
  flag('ink.penButtons', "The pen's eraser end and barrel button.", on),
  // ink.gestures, ink.anchoring, ink.insertSpace, ink.zoomBox, ink.steadyPen, ink.describe, ink.delegatedTrail,
  // ink.nativeTrail, ink.openSnapshot, and dev.penRecorder aren't built yet, so they have no entry and stay off.
];

/** The ink view: the pointer tools, the Draw tab, and the ink over the shown page. It loads with the first page. */
export const loadInkView = () => import('./view/install');
