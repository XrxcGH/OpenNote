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
  flag('ink.core', 'Pens and highlighters.', on),
  flag('ink.erasers', 'Erasers.', on),
  flag('ink.lasso', 'The lasso.', on),
  flag('ink.shapes', 'Shapes.', on),
  flag('ink.palm', 'Palm rejection.', on),
  flag('ink.penButtons', 'Pen buttons.', on),
  // ink.gestures, ink.anchoring, ink.insertSpace, ink.zoomBox, ink.steadyPen, ink.describe, ink.delegatedTrail,
  // ink.nativeTrail, ink.openSnapshot, and dev.penRecorder aren't built yet, so they have no entry and stay off.
];

/** The ink view: the pointer tools, the Draw tab, and the ink over the shown page. It loads with the first page. */
export const loadInkView = () => import('./view/install');
