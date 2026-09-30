// Spike page: ink latency. See spikes/README.md and docs/adr/0004-ink-latency.md.
//
// ?mode= picks the renderer (see MODES in ink-input.ts). With auto=1 the harness drives the page and
// reads its timings; without it, a person can draw and compare renderers with the panel.
import { isAuto, params, ready, register } from './common';
import { CanvasRenderer, type Renderer } from './ink-canvas';
import { attachInput, modeSpec, requestPresenter } from './ink-input';
import { EventLog, FramePacer, frameIntervals } from './ink-metrics';
import { showPanel } from './ink-panel';
import { WebGlRenderer } from './ink-webgl';

/** The busy modes run a task this long on the main thread every BUSY_EVERY_MS. */
const BUSY_MS = 10;
const BUSY_EVERY_MS = 16;

/** Keeps the main thread busy most of the time, like an app doing layout and rendering work. */
function simulateBusyApp(): void {
  setInterval(() => {
    const end = performance.now() + BUSY_MS;
    while (performance.now() < end) {
      // Busy-wait on purpose: input that arrives now has to wait for this task to finish.
    }
  }, BUSY_EVERY_MS);
}

const spec = modeSpec(params.get('mode'));
const canvas = document.createElement('canvas');
canvas.className = 'ink';
document.body.append(canvas);

const renderer: Renderer = spec.webgl ? new WebGlRenderer(canvas) : new CanvasRenderer(canvas, spec.desync);
const presenter = spec.delegate ? await requestPresenter(canvas) : null;
const log = new EventLog();
const pen = attachInput(canvas, { spec, renderer, log, presenter });
const pacer = new FramePacer();

window.addEventListener('resize', () => renderer.resize());
if (spec.busy) simulateBusyApp();
register('clear', () => renderer.clear());
register('events', ({ from }: { from: number }) => log.records.slice(from));
register('frames', ({ count }: { count: number }) => frameIntervals(count));
register('pacingStart', () => pacer.start());
register('pacingStop', () => pacer.stop());
register('lastPen', () => pen());

const details = {
  mode: spec.mode,
  width: window.innerWidth,
  height: window.innerHeight,
  dpr: window.devicePixelRatio,
  desynchronized: renderer.desynchronized,
  delegated: presenter !== null,
  busy: spec.busy,
  predictedEvents: 'getPredictedEvents' in PointerEvent.prototype,
  rawUpdate: 'onpointerrawupdate' in window,
  userAgent: navigator.userAgent,
};
if (!isAuto) showPanel({ mode: spec.mode, details, log, renderer, pen });
ready(details);
