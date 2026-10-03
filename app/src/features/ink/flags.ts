// Phase 5's flags (ARCHITECTURE.md section 2.2). app/flags.ts joins these to Phase 2's list, so they load at
// start-up, before the ink chunk. A feature turns on when it works end to end in the app; the rest stay off.
import type { FlagDef, FlagId } from '../../app/flags';

export type InkFlagId = Extract<FlagId, `ink.${string}` | 'dev.penRecorder'>;

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const on = { dev: true, nightly: true, beta: true, stable: true };
const off = { dev: false, nightly: false, beta: false, stable: false };

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
  flag('ink.gestures', 'Scribble to erase, circle and tap, and two- and three-finger taps.', off),
  flag('ink.anchoring', 'Ink anchored to text.', off),
  flag('ink.insertSpace', 'Insert space.', off),
  flag('ink.zoomBox', 'The zoom writing box.', off),
  flag('ink.steadyPen', 'The steady pen.', off),
  flag('ink.describe', 'Descriptions of ink for screen readers.', off),
  flag('ink.delegatedTrail', 'Delegated ink trails in WebView2.', off),
  flag('ink.nativeTrail', 'A native ink layer.', off),
  flag('ink.openSnapshot', 'A snapshot of the ink at page open.', off),
  flag('dev.penRecorder', 'Record pen sessions for the palm accuracy corpus.', off),
];
