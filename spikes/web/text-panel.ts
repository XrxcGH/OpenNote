// The live panel for trying the text spike by hand: current zoom, key-to-paint times, frame rate, and switches
// for the ink, the number of editors, and the compositor layer.
import { INK_MODES, type InkLayer, type InkMode } from './text-ink';
import type { Notes } from './text-notes';
import type { KeyRecord, KeyTimer } from './text-timing';
import { MOTIONS, runMotion, type World } from './text-world';

interface Parts {
  world: World;
  ink: InkLayer;
  notes: Notes;
  keys: KeyTimer;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const ms = (value: number) => (Number.isFinite(value) ? `${value.toFixed(1)} ms` : '-');

function control(label: string, element: HTMLElement): HTMLLabelElement {
  const wrapper = document.createElement('label');
  wrapper.append(`${label} `, element);
  return wrapper;
}

function select(options: readonly string[], value: string, change: (value: string) => void): HTMLSelectElement {
  const element = document.createElement('select');
  element.append(...options.map((option) => new Option(option, option, false, option === value)));
  element.addEventListener('change', () => change(element.value));
  return element;
}

function button(label: string, click: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', click);
  return element;
}

/** Counts frames with requestAnimationFrame and reports the rate over the last second. */
function frameRate(): () => number {
  const times: number[] = [];
  const tick = (time: number) => {
    times.push(time);
    while (times.length > 0 && time - times[0] > 1000) times.shift();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => times.length;
}

function controls({ world, ink, notes }: Parts): HTMLElement {
  const row = document.createElement('div');
  row.className = 'controls';
  const layer = document.createElement('input');
  layer.type = 'checkbox';
  layer.addEventListener('change', () => world.setLayer(layer.checked));
  row.append(
    control(
      'Ink',
      select(INK_MODES, ink.mode, (mode) => ink.setMode(mode as InkMode, world.camera)),
    ),
    control(
      'Editors',
      select(['1', '4', '8'], '8', (count) => notes.setCount(Number(count))),
    ),
    control('Layer', layer),
    ...MOTIONS.map((motion) => button(`Run ${motion}`, () => void runMotion(world, motion, 4000))),
  );
  return row;
}

export function showPanel(parts: Parts): void {
  const panel = document.createElement('aside');
  panel.id = 'panel';
  const readout = document.createElement('pre');
  const help = document.createElement('p');
  help.textContent = 'Ctrl+wheel zooms. The wheel, a middle drag, or Space+drag (outside a note) pans.';
  panel.append(readout, controls(parts), help);
  document.body.append(panel);
  const recent: number[] = [];
  parts.keys.onRecord = (record: KeyRecord) => {
    if (record.painted !== null) recent.push(record.painted - record.stamp);
    if (recent.length > 50) recent.shift();
  };
  const fps = frameRate();
  setInterval(() => {
    const { scale } = parts.world.camera;
    readout.textContent = [
      `Zoom ${(scale * 100).toFixed(0)}%   ${fps()} frames a second`,
      `Key to painted: last ${ms(recent[recent.length - 1])}, p95 ${ms(percentile(recent, 95))} (last 50)`,
      `Editors ${parts.notes.count}, ink ${parts.ink.mode}, canvas ink draw ${ms(parts.ink.lastDrawMs)}`,
    ].join('\n');
  }, 250);
}
