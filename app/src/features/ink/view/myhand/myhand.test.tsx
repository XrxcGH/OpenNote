// My handwriting in a real browser. The calibration page takes synthetic pen input box by box, and redo and the
// keyboard work. Uploads stay locked until the page is done. Write in my handwriting makes ordinary ink on the
// paper's lines. None of the style ever reaches a log, or any call but the style store's own.
import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { PaperLattice } from '../../../../core/paperLattice';
import { resetFakeShell, setFakeShell } from '../../../../platform/shellqol';
import { charSampleId, sentenceSampleId } from '../../myhand/charset';
import { syntheticProgress } from '../../myhand/fixtures';
import type { InkStroke } from '../../model/types';
import type { InkHost } from '../host';
import type { InkSurface } from '../surface';
import { CalibrationDialog } from './Calibration';
import MyHandSection from './MyHandSection';
import { finishCalibration, loadStyle, resetStyleForTests, setProgressForTests, styleState } from './store';
import { showUploads } from './Uploads';
import { requestFor, toStrokes, writeSelection } from './writeInk';
import type { Written } from '../../myhand/write';
import { DEFAULT_WIDTH_MM, mmToPage } from '../../pens/tools';
import { settingsStore } from '../../../../state/settings';
import { drawState } from '../state';

beforeEach(() => {
  resetFakeShell();
  resetStyleForTests();
});
afterEach(() => resetFakeShell());

/** Writes a little zigzag in a box with pen events, the way a stylus sends them. */
function penWrite(box: HTMLElement, id = 7) {
  const rect = box.getBoundingClientRect();
  const at = (fx: number, fy: number) => ({
    clientX: rect.left + rect.width * fx,
    clientY: rect.top + rect.height * fy,
  });
  const send = (type: string, fx: number, fy: number, pressure: number) =>
    box.dispatchEvent(
      new PointerEvent(type, {
        ...at(fx, fy),
        pointerType: 'pen',
        pointerId: id,
        pressure,
        button: 0,
        buttons: pressure > 0 ? 1 : 0,
        bubbles: true,
      }),
    );
  send('pointerdown', 0.3, 0.4, 0.4);
  for (let i = 1; i <= 8; i++) send('pointermove', 0.3 + i * 0.05, 0.4 + (i % 2) * 0.25, 0.4 + i * 0.05);
  send('pointerup', 0.7, 0.65, 0);
}

describe('the calibration page', () => {
  it('takes pen writing in a box with its pressure, and Delete and Redo clear it', async () => {
    await loadStyle();
    render(<CalibrationDialog done={() => undefined} />);
    const dialog = await screen.findByRole('dialog', { name: 'Calibration page' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    const box = within(dialog).getByRole('group', { name: 'small a, 1 of 3' });
    expect(box).toHaveAttribute('aria-description', 'Empty. Write here with your pen.');
    penWrite(box);
    await waitFor(() => expect(styleState.get().doc.progress.samples[charSampleId('a', 0)]).toBeTruthy());
    const sample = styleState.get().doc.progress.samples[charSampleId('a', 0)];
    expect(sample.strokes).toHaveLength(1);
    const pressures = sample.strokes[0].filter((_, i) => i % 4 === 2);
    expect(Math.max(...pressures)).toBeGreaterThan(0.6);
    expect(box).toHaveAttribute('aria-description', 'Written');
    // A second stroke adds to the same box.
    penWrite(box, 8);
    await waitFor(() => expect(styleState.get().doc.progress.samples[charSampleId('a', 0)].strokes).toHaveLength(2));
    box.focus();
    await userEvent.keyboard('{Delete}');
    await waitFor(() => expect(styleState.get().doc.progress.samples[charSampleId('a', 0)]).toBeUndefined());
    penWrite(box);
    await waitFor(() => expect(within(box).getByRole('button', { name: 'Redo', hidden: true })).toBeTruthy());
    within(box).getByRole('button', { name: 'Redo', hidden: true }).click();
    await waitFor(() => expect(styleState.get().doc.progress.samples[charSampleId('a', 0)]).toBeUndefined());
  });

  it('moves between boxes with the arrow keys, one box in the tab order', async () => {
    await loadStyle();
    render(<CalibrationDialog done={() => undefined} />);
    const dialog = await screen.findByRole('dialog', { name: 'Calibration page' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    const first = within(dialog).getByRole('group', { name: 'small a, 1 of 3' });
    expect(first).toHaveAttribute('tabindex', '0');
    first.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(dialog).getByRole('group', { name: 'small a, 2 of 3' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(dialog).getByRole('group', { name: 'small b, 2 of 3' })).toHaveFocus();
    expect(first).toHaveAttribute('tabindex', '-1');
  });

  it('remembers the step and finishes only once every box has writing, then shows the style', async () => {
    await loadStyle();
    const progress = syntheticProgress();
    const samples = { ...progress.samples };
    delete samples[sentenceSampleId(5)];
    await setProgressForTests({ samples, step: 6 });
    render(<CalibrationDialog done={() => undefined} />);
    const dialog = await screen.findByRole('dialog', { name: 'Calibration page' });
    expect(
      within(dialog).getByText('1 boxes are still empty. Every box needs writing before your style can be made.'),
    ).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Finish' })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Go to the first empty box' }));
    const box = await within(dialog).findByRole('group', { name: /^Sentence 6:/ });
    await waitFor(() => expect(box).toHaveFocus());
    penWrite(box);
    await waitFor(() => expect(styleState.get().doc.progress.samples[sentenceSampleId(5)]).toBeTruthy());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(await within(dialog).findByRole('img', { name: 'A sample of your handwriting' })).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(styleState.get().doc.style).not.toBeNull());
  });
});

describe('Settings, My handwriting', () => {
  it('keeps uploads locked, with a calm reason, until the calibration page is done', async () => {
    render(<MyHandSection />);
    expect(await screen.findByText('No handwriting style yet.')).toBeTruthy();
    expect(screen.getByText(/Uploads open once your calibration page is done/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Choose files…' })).toBeNull();
    // Uploads can never make a style.
    await showUploads([new File(['x'], 'notes.png', { type: 'image/png' })], false);
    expect(screen.queryByRole('dialog')).toBeNull();
    await setProgressForTests(syntheticProgress());
    await finishCalibration();
    expect(await screen.findByText('Your handwriting style is ready.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose files…' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'A sample of your handwriting' })).toBeTruthy();
  });

  it('deletes the style and its key after asking', async () => {
    const calls: string[] = [];
    await loadStyle();
    await setProgressForTests(syntheticProgress());
    await finishCalibration();
    render(<MyHandSection />);
    setFakeShell((name) => {
      calls.push(name);
      return { ok: true };
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Delete my handwriting' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete your handwriting style?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete my handwriting' }));
    await waitFor(() => expect(calls).toContain('handstyle.delete'));
    expect(styleState.get().doc.style).toBeNull();
  });
});

const ruled: PaperLattice = {
  kind: 'ruled',
  step: 32,
  origin: { x: 0, y: 96 },
  area: { x: 0, y: 0, w: 800, h: 1e6 },
  sheet: null,
  margin: 80,
};

describe('Write in my handwriting', () => {
  it('writes the selected text and math as ordinary ink on the ruled lines, and replaces the text', async () => {
    await loadStyle();
    await setProgressForTests(syntheticProgress());
    await finishCalibration();
    localStorage.setItem('opennote.myhand.writeChoice', 'replace');
    const added: InkStroke[][] = [];
    const surface = {
      readOnly: false,
      layerFor: () => 'layer-1',
      add: vi.fn(async (strokes: InkStroke[]) => (added.push(strokes), true)),
    } as unknown as InkSurface;
    const remove = vi.fn(async () => true);
    const host = {
      viewport: { get: () => ({ toWorld: (x: number, y: number) => ({ x, y }), world: { offsetWidth: 800 } }) },
      paper: { get: () => ruled },
      select: vi.fn(),
      text: {
        remove,
        selection: async () => ({
          block: 'b1',
          from: 3,
          to: 40,
          runs: [
            { kind: 'text', text: 'Energy is ' },
            { kind: 'math', latex: 'E = mc^2', display: false },
          ],
          start: { x: 120, y: 140 },
          rect: { x: 100, y: 140, w: 500, h: 30 },
          fontSize: 16,
        }),
      },
    } as unknown as InkHost;
    await writeSelection(host, surface);
    expect(added).toHaveLength(1);
    const strokes = added[0];
    expect(strokes.length).toBeGreaterThan(8);
    for (const stroke of strokes) {
      // Ordinary ink: the fields every stroke has, and nothing that marks it as generated.
      expect(Object.keys(stroke).sort()).toEqual([
        'block',
        'color',
        'id',
        'points',
        'slot',
        'startTime',
        'tool',
        'width',
      ]);
      expect(stroke.block).toBe('layer-1');
      expect(stroke.points.every((p) => p.pressure! > 0 && p.pressure! <= 1)).toBe(true);
    }
    // The ink rests on a rule of the paper, and stays inside the text's width.
    const ys = strokes.flatMap((s) => s.points.map((p) => p.y));
    const xs = strokes.flatMap((s) => s.points.map((p) => p.x));
    // Most strokes end on the baseline: the commonest bottom, to two units, is a rule of the paper.
    const bins = new Map<number, number>();
    for (const s of strokes) {
      const bin = Math.round(Math.max(...s.points.map((p) => p.y)) / 2);
      bins.set(bin, (bins.get(bin) ?? 0) + 1);
    }
    const rest = [...bins.entries()].sort((a, b) => b[1] - a[1])[0][0] * 2;
    const rule = ruled.origin.y + Math.round((rest - ruled.origin.y) / ruled.step) * ruled.step;
    expect(Math.abs(rest - rule)).toBeLessThan(3);
    expect(Math.min(...ys)).toBeGreaterThan(rule - ruled.step * 1.2);
    expect(Math.max(...xs)).toBeLessThan(605);
    expect(remove).toHaveBeenCalledWith('b1', 3, 40);
  });

  it('writes with a pen’s width, not a highlighter’s, when the current pen is a highlighter', () => {
    const original = settingsStore.get();
    const pens = original.settings.ink.pens.map((p, i) =>
      i === 0 ? { ...p, tool: 'highlighter' as const, width: 8 } : p,
    );
    settingsStore.set({ ...original, settings: { ...original.settings, ink: { ...original.settings.ink, pens } } });
    drawState.set({ tool: 'pen', previous: 'select', slot: pens[0].id });
    try {
      const written = { paths: [[{ x: 1, y: 2, pressure: 0.5, time: 0 }]] } as unknown as Written;
      const [stroke] = toStrokes(written, { layerFor: () => 'layer-1' } as unknown as InkSurface);
      expect(stroke.tool).toBe('pen');
      expect(stroke.width).toBe(mmToPage(DEFAULT_WIDTH_MM.pen));
    } finally {
      settingsStore.set(original);
      drawState.set({ tool: 'select', previous: 'select', slot: 'p1' });
    }
  });

  it('puts the handwriting beside the text when asked, or below it when there is no room', () => {
    const page = { start: { x: 100, y: 100 }, box: { x: 100, y: 100, w: 200, h: 40 }, pageWidth: 800, fontSize: 16 };
    expect(requestFor('beside', page).at.x).toBeGreaterThan(300);
    const narrow = requestFor('beside', { ...page, pageWidth: 360 });
    expect(narrow.at).toEqual({ x: 100, y: 148 });
    expect(requestFor('replace', page).startX).toBe(100);
  });
});

describe('the style stays private', () => {
  it('never reaches a log, and goes to no call but the style store’s', async () => {
    const logged: unknown[] = [];
    for (const level of ['log', 'info', 'debug', 'trace'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(...args));
    }
    const calls: { name: string; args: string }[] = [];
    const memory: { doc: unknown } = { doc: null };
    setFakeShell((name, args) => {
      calls.push({ name, args: JSON.stringify(args) });
      if (name === 'handstyle.load') return memory.doc ? { state: 'ok', doc: memory.doc } : { state: 'none' };
      if (name === 'handstyle.save') memory.doc = args.doc;
      return { ok: true };
    });
    await loadStyle();
    await setProgressForTests(syntheticProgress());
    await finishCalibration();
    render(<MyHandSection />);
    await screen.findByText('Your handwriting style is ready.');
    expect(logged).toEqual([]);
    const carrying = calls.filter((call) => call.args.includes('"strokes"'));
    expect(carrying.length).toBeGreaterThan(0);
    expect(carrying.every((call) => call.name === 'handstyle.save')).toBe(true);
    expect(calls.every((call) => call.name.startsWith('handstyle.'))).toBe(true);
  });
});
