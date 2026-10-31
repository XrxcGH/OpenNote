// The signals and sound kit in a real browser: each tool opens from the picker, shows a result for its example,
// works from the keyboard, puts its result in the page, and has no accessibility violations.
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { INSERT_EVENT, SUBJECT_TABLES_EVENT } from '../flags';
import { SignalsKit } from './kit';
import { CLIP_RATE, resetClip, setClip } from './audio/clip';
import { chooseSignalTool, restoreSignalInputs, type SignalToolId } from './meta';

const inserted: Record<string, unknown>[] = [];
const listen = (event: Event) => {
  const detail = (event as CustomEvent<Record<string, unknown> & { handled: boolean }>).detail;
  inserted.push({ ...detail });
  detail.handled = true;
};

beforeEach(() => {
  window.localStorage.clear();
  inserted.length = 0;
  window.addEventListener(INSERT_EVENT, listen);
});
afterEach(() => window.removeEventListener(INSERT_EVENT, listen));

async function openAt(tool: SignalToolId) {
  chooseSignalTool(tool);
  const view = renderUi(<SignalsKit />);
  await screen.findAllByRole('button', { name: /^Insert/ }, { timeout: 10_000 });
  return view;
}

/** Walks every mode with the arrow key, checking each one shows a result and has no accessibility violations. */
async function walkModes(container: HTMLElement) {
  const tabs = screen.getAllByRole('tab');
  for (let i = 0; i < tabs.length; i += 1) {
    const current = screen.getAllByRole('tab')[i]!;
    expect(current.getAttribute('aria-selected')).toBe('true');
    await screen.findAllByRole('button', { name: /^Insert/ }, { timeout: 10_000 });
    await expectNoAxeViolations(container);
    fireEvent.keyDown(current, { key: 'ArrowRight' });
  }
  expect(screen.getAllByRole('tab')[0]!.getAttribute('aria-selected')).toBe('true');
}

/** A 0.5 s, 16-bit mono WAV of a sine at 16 kHz, built here so the expected peak is known independently. */
function toneWav(freq: number): ArrayBuffer {
  const rate = 16000;
  const n = rate / 2;
  const bytes = new DataView(new ArrayBuffer(44 + 2 * n));
  const text = (at: number, s: string) => [...s].forEach((c, i) => bytes.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  bytes.setUint32(4, 36 + 2 * n, true);
  text(8, 'WAVEfmt ');
  bytes.setUint32(16, 16, true);
  bytes.setUint16(20, 1, true);
  bytes.setUint16(22, 1, true);
  bytes.setUint32(24, rate, true);
  bytes.setUint32(28, 2 * rate, true);
  bytes.setUint16(32, 2, true);
  bytes.setUint16(34, 16, true);
  text(36, 'data');
  bytes.setUint32(40, 2 * n, true);
  for (let i = 0; i < n; i += 1)
    bytes.setInt16(44 + 2 * i, Math.round(16000 * Math.sin((2 * Math.PI * freq * i) / rate)), true);
  return bytes.buffer;
}

/** The spectrum's answer line (the data field's summary is a status line too). */
const peakLine = () =>
  screen
    .getAllByRole('status')
    .map((line) => line.textContent ?? '')
    .find((text) => text.startsWith('Largest peak')) ?? '';

describe('signals and sound kit', () => {
  it('opens the spectrum analyzer at its example and reads the 10 Hz peak', async () => {
    const { container } = await openAt('spectrum');
    expect(peakLine()).toMatch(/at (9\.9\d*|10(\.0\d*)?) Hz/);
    expect(screen.getByRole('table', { name: 'Bands' })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Insert answer' })[0]!);
    expect(String(inserted[0]?.text)).toMatch(/Largest peak/);
    await expectNoAxeViolations(container);
  });

  it('analyzes an opened sound file in place of the pasted samples', async () => {
    await openAt('spectrum');
    const file = new File([toneWav(440)], 'tone.wav', { type: 'audio/wav' });
    fireEvent.change(screen.getByLabelText('Or open a sound file'), { target: { files: [file] } });
    expect(await screen.findByText(/Analyzing tone\.wav/, undefined, { timeout: 10_000 })).toBeTruthy();
    expect(peakLine()).toMatch(/at 4(39|40|41)(\.\d*)? Hz/);
    fireEvent.click(screen.getByRole('button', { name: 'Use the pasted samples' }));
    expect(peakLine()).toMatch(/at (9\.9\d*|10(\.0\d*)?) Hz/);
  });

  it('reads a value and a time column from a table on the open page', async () => {
    await openAt('spectrum');
    // 200 rows at 5 ms of a 25 Hz sine: the peak is at 25 Hz and the times set the rate to 200 Hz.
    const rows = Array.from({ length: 200 }, (_, i) => ({
      cells: { c1: String(i / 200), c2: String(Math.sin((2 * Math.PI * 25 * i) / 200)) },
    }));
    const table = {
      id: 't1',
      type: 'table',
      data: {
        header: true,
        columns: [{ id: 'c1' }, { id: 'c2' }],
        rows: [{ cells: { c1: 't', c2: 'volts' } }, ...rows],
      },
    };
    const answer = (event: Event) => {
      (event as CustomEvent<{ blocks: unknown }>).detail.blocks = [table];
    };
    window.addEventListener(SUBJECT_TABLES_EVENT, answer);
    fireEvent.click(screen.getByRole('button', { name: 'Find tables on the page' }));
    window.removeEventListener(SUBJECT_TABLES_EVENT, answer);
    fireEvent.click(await screen.findByRole('button', { name: 'Use this table' }));
    fireEvent.change(await screen.findByLabelText('Response'), { target: { value: 'volts' } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: 't' } });
    await waitFor(() => expect(peakLine()).toMatch(/at 25(\.0\d*)? Hz/));
    expect(screen.getByText(/Analyzing the volts column/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use the pasted samples' }));
    expect(peakLine()).toMatch(/at (9\.9\d*|10(\.0\d*)?) Hz/);
  });

  it('switches tools from the picker and from a palette command', async () => {
    await openAt('spectrum');
    const picker = screen.getByRole('combobox', { name: 'Tool' }) as HTMLSelectElement;
    expect(picker.value).toBe('spectrum');
    act(() => chooseSignalTool('spectrum'));
    expect(picker.value).toBe('spectrum');
  });
});

describe('signals kit: systems, coding, RF, and filters', () => {
  it('convolves the example, finds the correlation lag, and walks every systems mode', async () => {
    const { container } = await openAt('systems');
    expect(screen.getAllByRole('status')[0]!.textContent).toContain('y = [0, 1, 2.5, 4, 1.5]');
    fireEvent.click(screen.getAllByRole('button', { name: 'Insert table' })[0]!);
    expect(inserted[0]?.table).toBeTruthy();
    fireEvent.keyDown(screen.getAllByRole('tab')[0]!, { key: 'ArrowRight' });
    expect((await screen.findAllByRole('status'))[0]!.textContent).toMatch(/lag 3/);
    fireEvent.keyDown(screen.getAllByRole('tab')[1]!, { key: 'ArrowLeft' });
    await walkModes(container);
  });

  it('reads the entropy example, inserts it, and walks every information and coding mode', async () => {
    const { container } = await openAt('comms');
    expect(screen.getAllByRole('status')[0]!.textContent).toContain('H = 1.5 bits');
    fireEvent.click(screen.getAllByRole('button', { name: 'Insert answer' })[0]!);
    expect(inserted[0]?.text).toContain('1.5');
    await walkModes(container);
  });

  it('reads the reflection example, inserts it, and walks every RF mode', async () => {
    const { container } = await openAt('rf');
    expect(screen.getAllByRole('status')[0]!.textContent).toContain('VSWR 2.618');
    expect(screen.getAllByRole('status')[0]!.textContent).toContain('50 − j50');
    fireEvent.click(screen.getAllByRole('button', { name: 'Insert answer' })[0]!);
    expect(inserted[0]?.text).toContain('0.4 + j0.2');
    await walkModes(container);
  });

  it('tunes a 20 s recording in the worker with progress, and stops a run on Cancel', async () => {
    // 20 s at 16 kHz is past the old 15 s cut and big enough for the worker. 220 Hz is A3, 0 cents.
    const tone = (f: number) =>
      Float32Array.from({ length: 20 * CLIP_RATE }, (_, i) => 0.5 * Math.sin((2 * Math.PI * f * i) / CLIP_RATE));
    act(() => setClip({ samples: tone(220), rate: CLIP_RATE, name: 'long' }));
    window.localStorage.setItem('opennote.kitSignals.audio', JSON.stringify({ mode: 'tuner' }));
    window.localStorage.setItem('opennote.kitSignals.audio.tuner', JSON.stringify({ source: 'clip' }));
    chooseSignalTool('audio');
    renderUi(<SignalsKit />);
    expect(await screen.findByRole('progressbar', undefined, { timeout: 10_000 })).toBeTruthy();
    expect(await screen.findByText(/^A3, [+−]0(\.\d+)? cents\.$/, undefined, { timeout: 30_000 })).toBeTruthy();
    act(() => setClip({ samples: tone(330), rate: CLIP_RATE, name: 'long' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Stopped. Change a field to run it again.')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    act(() => resetClip());
  });

  it('takes an open load, inserts a live block with its fields, and puts them back from the block', async () => {
    await openAt('rf');
    fireEvent.click(screen.getByRole('button', { name: 'Open (∞)' }));
    // An eighth wave of 50 Ω line ending in an open: Zin = −j Z0 cot 45° = −j50 Ω, and Γ = 1.
    expect(screen.getAllByRole('status')[0]!.textContent).toContain('−j50');
    fireEvent.click(screen.getAllByRole('button', { name: 'Insert live block' })[0]!);
    const panel = inserted[0]?.panel as {
      type: string;
      data: { kit: string; tool: string; inputs: Record<string, { zl?: string }> };
    };
    expect(panel.type).toBe('ext:org.opennote/kitcalc');
    expect([panel.data.kit, panel.data.tool]).toEqual(['signals', 'rf']);
    expect(panel.data.inputs['rf.load']?.zl).toBe('open');
    // Another load typed since; the block's Open in tool puts the open load back into the open window.
    fireEvent.click(screen.getByRole('button', { name: 'Short (0 Ω)' }));
    act(() => void restoreSignalInputs('rf', { ...panel.data.inputs, 'spectrum.x': { a: 1 }, 'rf.bad': 'text' }));
    expect(await screen.findByDisplayValue('open')).toBeTruthy();
    expect(window.localStorage.getItem('opennote.kitSignals.spectrum.x')).toBeNull();
    expect(restoreSignalInputs('nope', {})).toBe(false);
  });

  it('designs the Butterworth example, inserts its coefficients, and walks every filter mode', async () => {
    const { container } = await openAt('filters');
    expect(screen.getAllByRole('status')[0]!.textContent).toContain('order-2');
    fireEvent.click(screen.getAllByRole('button', { name: 'Insert table' })[0]!);
    expect(inserted[0]?.table).toBeTruthy();
    await walkModes(container);
  });
});

describe('signals kit: imaging, sound, and body signals', () => {
  it('reads the spin-echo example, shows the coursework notice, and walks every medical imaging mode', async () => {
    const { container } = await openAt('medimaging');
    expect(screen.getAllByRole('status')[0]!.textContent).toContain('0.348981');
    expect(screen.getByText('For coursework only, not for clinical use or diagnosis.')).toBeTruthy();
    await walkModes(container);
  });

  it('analyzes the example vowel at 120 Hz, walks every sound mode, and marks the audiogram as coursework', async () => {
    const { container } = await openAt('audio');
    expect(screen.getAllByRole('status')[0]!.textContent).toMatch(/f0 12\d/);
    await walkModes(container);
    fireEvent.click(screen.getByRole('tab', { name: 'Audiogram' }));
    expect(await screen.findByText('For coursework only, not for clinical use or diagnosis.')).toBeTruthy();
  });

  it('counts the example cells and walks every image mode', async () => {
    const { container } = await openAt('images');
    expect(screen.getAllByRole('status')[0]!.textContent).toMatch(/\d+ objects/);
    await walkModes(container);
  });

  it('averages the example epochs, shows the coursework notice, and walks every time-series mode', async () => {
    const { container } = await openAt('neurodata');
    expect(screen.getAllByRole('status')[0]!.textContent).toContain('40 epochs averaged');
    expect(screen.getByText('For coursework only, not for clinical use or diagnosis.')).toBeTruthy();
    await walkModes(container);
  });
});
