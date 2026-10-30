// The music and studio tool kit: tool titles, field labels, row labels, worked-step sentences, and the problems an
// input can have. Courses are never named here. Each tool's text lives in its own file under ./kitMusic.
import { camera } from './kitMusic/camera';
import { common } from './kitMusic/common';
import { rhythm } from './kitMusic/rhythm';
import { ear } from './kitMusic/ear';
import { partwriting } from './kitMusic/partwriting';
import { script } from './kitMusic/script';
import { score } from './kitMusic/score';
import { studio } from './kitMusic/studio';
import { theory } from './kitMusic/theory';

export const kitMusic = {
  window: 'Music, script, camera, and studio tools',
  tabs: 'Tools',
  open: 'Open the music, script, camera, and studio tools',
  openKeywords: 'music script screenplay camera film lighting color scale studio theory tuning rhythm',
  insert: 'Insert',
  insertAnswer: 'Answer line',
  insertTable: 'Result table',
  insertSteps: 'Worked steps',
  insertPicture: 'Picture',
  insertCode: 'Code block',
  inserted: 'Inserted into the page.',
  noPage: 'Click in a page first, then insert.',
  assumptions: 'Assumptions',
  results: 'Results',
  steps: 'Worked steps',
  source: 'Source: {source}',
  loading: 'Loading the tool',
  sound: 'Sound',
  play: 'Play',
  stop: 'Stop',
  tap: 'Tap tempo',
  playing: 'Playing.',
  noAudio: 'This device cannot play sound here.',
  t: { ...theory.t, ...score.t, ...ear.t, ...partwriting.t, ...script.t, ...camera.t, ...studio.t, ...rhythm.t },
  f: { ...theory.f, ...score.f, ...ear.f, ...partwriting.f, ...script.f, ...camera.f, ...studio.f, ...rhythm.f },
  r: { ...theory.r, ...score.r, ...ear.r, ...partwriting.r, ...script.r, ...camera.r, ...studio.r, ...rhythm.r },
  s: { ...theory.s, ...score.s, ...ear.s, ...partwriting.s, ...script.s, ...camera.s, ...studio.s, ...rhythm.s },
  e: {
    ...common.e,
    ...theory.e,
    ...score.e,
    ...ear.e,
    ...partwriting.e,
    ...script.e,
    ...camera.e,
    ...studio.e,
    ...rhythm.e,
  },
  n: { ...theory.n, ...score.n, ...ear.n, ...partwriting.n, ...script.n, ...camera.n, ...studio.n, ...rhythm.n },
} as const;
