// Spike page: Text on a freeform page. See spikes/README.md.
//
// Eight Tiptap editors sit at different places on a world that zooms and pans with one CSS transform, over and
// around about 5,000 ink strokes. The harness in spikes/harness/src/text types into them through the DevTools
// Protocol and reads the timings this page records. Without auto=1, a small panel shows live numbers.
import '@fontsource-variable/atkinson-hyperlegible-next';
import { isAuto, nextFrame, params, ready, register } from './common';
import { LONG_NOTE, SHORT_NOTE, noteSpecs, wordCount } from './text-content';
import { INK_MODES, InkLayer, type InkMode } from './text-ink';
import { Notes, type CaretPlace, type CaretRect } from './text-notes';
import { showPanel } from './text-panel';
import { makeStrokes } from './text-strokes';
import { EventLog, KeyTimer, eventCounts } from './text-timing';
import { MOTIONS, World, attachControls, runMotion, type Motion } from './text-world';

const viewport = document.getElementById('viewport') as HTMLElement;
const world = new World(viewport, document.getElementById('world') as HTMLElement);
const specs = noteSpecs();
const notes = new Notes(specs, world.element);
const keys = new KeyTimer();
const events = new EventLog();
notes.onTransaction = (docChanged) => keys.transaction(docChanged);

const inkStarted = performance.now();
const ink = new InkLayer(makeStrokes(Number(params.get('strokes') ?? 5000)), world.element, viewport);
const inkMs = performance.now() - inkStarted;
world.onChange((camera) => ink.draw(camera));

async function frames(count: number): Promise<void> {
  for (let index = 0; index < count; index++) await nextFrame();
}

/** Pans so the focused note is centered across and the caret's line sits a little above the middle, at `scale`.
 * The whole width of the note stays in view, so typed text never runs off the window. */
function centerOnCaret(scale: number): CaretRect | null {
  const caret = notes.caret();
  if (!caret) return null;
  const [, wy] = world.toWorld(caret.left, (caret.top + caret.bottom) / 2);
  const [width, height] = world.size;
  world.centerOn(notes.centerX(notes.focused()), wy, width / 2, height * 0.45, scale);
  return notes.caret();
}

function inkMode(value: unknown): InkMode {
  if (value === true) return 'svg';
  if (value === false) return 'off';
  if (INK_MODES.includes(value as InkMode)) return value as InkMode;
  throw new Error(`Unknown ink mode ${String(value)}.`);
}

/** CSS for each top-level block of the notes: normal, `content-visibility: auto`, or `contain: paint`. */
type Blocks = 'normal' | 'content-visibility' | 'contain-paint';

function setBlocks(blocks: Blocks): void {
  document.body.classList.toggle('lazy-blocks', blocks === 'content-visibility');
  document.body.classList.toggle('contained-blocks', blocks === 'contain-paint');
}

interface Setup {
  zoom: number;
  ink: InkMode | boolean;
  editors: number;
  target: 'short' | 'long';
  hideCaret?: boolean;
  layer?: boolean;
  spellcheck?: boolean;
  blocks?: Blocks;
}

/** Sets up one typing condition: fresh content in the target note, then focus, zoom, and pan to its caret. */
async function setup(args: Setup): Promise<Record<string, unknown>> {
  const index = args.target === 'long' ? LONG_NOTE : SHORT_NOTE;
  const place: CaretPlace = args.target === 'long' ? 'middle' : 'end';
  notes.setSpellcheck(args.spellcheck ?? true);
  setBlocks(args.blocks ?? 'normal');
  notes.setCount(args.editors, index);
  notes.create(index);
  ink.setMode(inkMode(args.ink), world.camera);
  world.setLayer(args.layer ?? false);
  document.body.classList.toggle('hide-caret', args.hideCaret ?? false);
  notes.focus(index, place);
  await frames(2);
  centerOnCaret(args.zoom);
  await document.fonts.ready;
  await ink.settled();
  await frames(3);
  return { caret: notes.caret(), editors: notes.count, ink: ink.mode, camera: world.camera };
}

register('setup', setup);
register('focusEditor', async ({ index, place }: { index: number; place?: CaretPlace }) => {
  notes.focus(index, place ?? (index === LONG_NOTE ? 'middle' : 'end'));
  await frames(2);
  return notes.caret();
});
register('caretRect', () => notes.caret());
register('setZoom', async ({ scale }: { scale: number }) => {
  if (!centerOnCaret(scale)) world.zoomAt(scale, world.size[0] / 2, world.size[1] / 2);
  await frames(2);
  return world.camera;
});
register('setInk', async ({ on, mode }: { on?: boolean; mode?: InkMode }) => {
  ink.setMode(inkMode(mode ?? on), world.camera);
  await ink.settled();
  return ink.mode;
});
register('setBlocks', ({ blocks }: { blocks: Blocks }) => setBlocks(blocks));
register('setEditorCount', ({ n, keep }: { n: number; keep?: number }) => {
  notes.setCount(n, keep ?? SHORT_NOTE);
  return notes.count;
});
/** Adds or removes the world's compositor layer, and returns the longest of the next 8 frame intervals. */
register('setLayer', async ({ on }: { on: boolean }) => {
  let last = await nextFrame();
  world.setLayer(on);
  let longest = 0;
  for (let index = 0; index < 8; index++) {
    const time = await nextFrame();
    longest = Math.max(longest, time - last);
    last = time;
  }
  return { longestFrameMs: longest };
});

interface View {
  x: number;
  y: number;
  scale: number;
  frames?: number;
}

/** Moves the camera so the world point (x, y) is at the window's center at `scale`, over `frames` frames. */
register('view', async ({ x, y, scale, frames: steps }: View) => {
  const [width, height] = world.size;
  const [fromX, fromY] = world.toWorld(width / 2, height / 2);
  const from = world.camera.scale;
  const count = Math.max(1, steps ?? 1);
  for (let step = 1; step <= count; step++) {
    const t = step / count;
    world.centerOn(fromX + (x - fromX) * t, fromY + (y - fromY) * t, width / 2, height / 2, from * (scale / from) ** t);
    await nextFrame();
  }
  await frames(2);
  return world.camera;
});
register('startLog', () => {
  keys.reset();
  events.reset();
  return eventCounts();
});
register('stats', async () => {
  // Event Timing entries arrive after the frame is presented, so give the last key time to report.
  await frames(3);
  await new Promise((resolve) => setTimeout(resolve, 150));
  return { keys: keys.records, events: events.entries, eventTiming: events.supported, counts: eventCounts() };
});
register('animate', async ({ motion, ms }: { motion: Motion; ms: number }) => {
  if (!MOTIONS.includes(motion)) throw new Error(`Unknown motion ${motion}.`);
  (document.activeElement as HTMLElement | null)?.blur();
  ink.takeTileMs();
  const report = await runMotion(world, motion, ms);
  const layer = world.element.classList.contains('layer');
  return { ...report, inkMode: ink.mode, editors: notes.count, layer, tileMs: ink.takeTileMs() };
});

/** The text height of a US Letter page with 1-inch margins, in CSS pixels (9 inches at 96 per inch). */
const LETTER_TEXT_HEIGHT = 9 * 96;

function start(): void {
  const started = performance.now();
  notes.setCount(specs.length);
  const editorsMs = performance.now() - started;
  const svgStarted = performance.now();
  ink.setMode(inkMode(params.get('ink') ?? 'svg'), world.camera);
  const svgMs = performance.now() - svgStarted;
  world.centerOn(1400, 900, world.size[0] / 2, world.size[1] / 2, 0.6);
  attachControls(world);
  if (!isAuto) showPanel({ world, ink, notes, keys });
  const setupMs = { editors: editorsMs, perEditor: [...notes.createMs], inkOutlines: inkMs, inkLayer: svgMs };
  document.fonts.ready.then(() => {
    // Measured once the font has loaded, since it sets the line heights.
    const heightPx = notes.height(LONG_NOTE);
    const letterPages = Math.round((heightPx / LETTER_TEXT_HEIGHT) * 10) / 10;
    ready({
      notes: specs.length,
      strokes: ink.count,
      words: specs.map((spec) => wordCount(spec.content)),
      longNote: { heightPx, letterPages },
      setupMs,
      devicePixelRatio: window.devicePixelRatio,
    });
  });
}

start();
