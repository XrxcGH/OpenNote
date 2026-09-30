// The small panel a person sees when trying the ink spike by hand, without auto=1.
import { send } from './common';
import type { Renderer } from './ink-canvas';
import { MODES, type Mode, type PenState } from './ink-input';
import { summarize, type EventLog, type Summary } from './ink-metrics';

interface PanelOptions {
  mode: Mode;
  details: Record<string, unknown>;
  log: EventLog;
  renderer: Renderer;
  pen: () => PenState | null;
}

/** How many recent moves the live numbers cover. */
const RECENT = 500;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function describe(label: string, summary: Summary): string {
  if (summary.count === 0) return `${label}: draw to measure`;
  return `${label}: ${summary.p50.toFixed(1)} ms median, ${summary.p95.toFixed(1)} ms at p95 (${summary.count})`;
}

/** Software latency from the event's timestamp to its ink being drawn, and to the next frame. */
function measure(log: EventLog) {
  const moves = log.records.filter((record) => record.k === 'm').slice(-RECENT);
  return {
    drawn: summarize(moves.filter((r) => r.d > 0).map((r) => r.d - r.t)),
    frame: summarize(moves.filter((r) => r.f > 0).map((r) => r.f - r.t)),
    handler: summarize(moves.map((r) => r.e - r.s)),
  };
}

function modePicker(current: Mode): HTMLLabelElement {
  const label = element('label', 'Renderer ');
  const select = element('select');
  for (const mode of MODES) {
    const option = element('option', mode);
    option.value = mode;
    option.selected = mode === current;
    select.append(option);
  }
  select.addEventListener('change', () => {
    location.search = `?mode=${encodeURIComponent(select.value)}`;
  });
  label.append(select);
  return label;
}

function button(text: string, action: () => void): HTMLButtonElement {
  const node = element('button', text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

/** Shows the panel: a renderer switcher, live software latency, and buttons to clear and save. */
export function showPanel(options: PanelOptions): void {
  const { mode, details, log, renderer, pen } = options;
  const panel = element('aside');
  panel.className = 'panel';
  panel.setAttribute('aria-label', 'Ink latency spike');
  const [drawn, frame, penLine, status] = [element('p'), element('p'), element('p'), element('p')];
  const context = `Desynchronized: ${details.desynchronized ? 'yes' : 'no'}. Delegated ink: ${
    details.delegated ? 'yes' : 'no'
  }.`;
  const save = () => {
    send({
      type: 'result',
      mode,
      details,
      ...measure(log),
      events: log.records.length,
      savedAt: new Date().toISOString(),
    });
    status.textContent = window.ipc
      ? 'Saved to spikes/results/ink-manual.json.'
      : 'No harness, so the results went to the console.';
  };
  const actions = element('div');
  actions.append(
    button('Clear', () => renderer.clear()),
    button('Save results', save),
    button('Hide (H)', toggle),
  );
  panel.append(modePicker(mode), drawn, frame, penLine, element('p', context), actions, status);
  document.body.append(panel);

  function toggle() {
    panel.hidden = !panel.hidden;
  }
  window.addEventListener('keydown', (event) => {
    if (event.key === 'h' || event.key === 'H') toggle();
  });
  setInterval(() => {
    const numbers = measure(log);
    drawn.textContent = describe('Event to ink drawn', numbers.drawn);
    frame.textContent = describe('Event to next frame', numbers.frame);
    const state = pen();
    const tilt = state ? `tilt ${state.tiltX}° and ${state.tiltY}°` : '';
    penLine.textContent = state
      ? `Last input: ${state.pointerType}, pressure ${state.pressure.toFixed(2)}, ${tilt}`
      : 'Last input: none yet';
  }, 500);
}
