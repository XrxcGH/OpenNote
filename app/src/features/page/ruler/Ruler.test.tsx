// The Ruler in a real browser, over a real text editor. Its track starts where the text starts at any zoom.
// A drag writes the indent back as one undo step. The units choice sticks.
import { render } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initFlags } from '../../../app/flags';
import { paraAt, paraTargets } from '../../../editor/commands/paragraph';
import { paraFormat } from '../../../editor/paragraph/attributes';
import { mountEditor } from '../../../editor/commands/testing';
import type { TestEditor } from '../../../editor/commands/testing';
import type { MountedPage } from '../mount';
import type { EditorPool } from '../pool/pool';
import { shownPool } from '../pool/shown';
import { Ruler } from './Ruler';
import { rulerState, setRulerShown, setRulerUnit } from './store';

let mounted: TestEditor | null = null;
let camera: (() => void) | null = null;

beforeEach(() => initFlags('dev', { 'text.ruler': true }));
afterEach(() => {
  mounted?.destroy();
  mounted = null;
  shownPool.set(null);
  camera = null;
  setRulerShown(false);
});

/** A page whose pool has the one editor active, with a camera the test can nudge. */
function fakePage(editor: Editor | null): MountedPage {
  const pool = {
    active: () => (editor ? { block: 'b1', editor } : null),
    editor: () => editor,
    onActiveChange: () => () => undefined,
  } as unknown as EditorPool;
  shownPool.set(pool);
  return {
    pool,
    viewport: {
      onCamera: (listener: () => void) => {
        camera = listener;
        return () => undefined;
      },
    },
  } as unknown as MountedPage;
}

/** An editor 600 px wide with 20 px of padding on each side, scaled like a zoomed page. */
function place(zoom: number, left = 100, source = 'hello'): TestEditor {
  const placed = mountEditor(source);
  const style = placed.root.style;
  style.position = 'absolute';
  style.top = '200px';
  style.left = `${left}px`;
  style.width = '600px';
  style.boxSizing = 'border-box';
  style.padding = '0 20px';
  style.transformOrigin = '0 0';
  style.transform = `scale(${zoom})`;
  return placed;
}

const frames = async (count: number): Promise<void> => {
  for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};
/** The camera moves, and the ruler re-measures within a frame or two. */
const frame = async (): Promise<void> => {
  camera?.();
  await frames(3);
};

async function show(zoom: number, left?: number) {
  mounted = place(zoom, left);
  setRulerShown(true);
  const view = render(<Ruler mounted={fakePage(mounted.editor)} />);
  await frame();
  await frames(3);
  const track = view.container.querySelector<HTMLElement>('[data-track]')!;
  const contentLeft = (mounted.editor.view.dom as HTMLElement).getBoundingClientRect().left + 20 * zoom;
  return { view, track, contentLeft, editor: mounted.editor };
}

describe.each([1, 2])('the track at zoom %i', (zoom) => {
  it('starts exactly where the editor content box starts, with the controls outside', async () => {
    const { view, track, contentLeft } = await show(zoom);
    await vi.waitFor(() => expect(track.getBoundingClientRect().left).toBeCloseTo(contentLeft, 0));
    const selector = view.container.querySelector<HTMLElement>('button')!;
    expect(selector.getBoundingClientRect().right).toBeLessThanOrEqual(track.getBoundingClientRect().left + 0.5);
  });
});

describe('the ruler when the page is panned', () => {
  it('keeps the track on the text when the content box starts left of the ruler', async () => {
    const { track, contentLeft } = await show(1, -60);
    expect(track.getBoundingClientRect().left).toBeCloseTo(contentLeft, 0);
    expect(contentLeft).toBeLessThan(0);
  });
});

describe('writing back', () => {
  it('a drag of the left indent sets the paragraph indent, and one undo restores it', async () => {
    const { track, editor } = await show(1);
    const box = track.getBoundingClientRect();
    const send = (type: string, dx: number) =>
      track.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 9,
          pointerType: 'mouse',
          button: 0,
          clientX: box.left + dx,
          clientY: box.top + 0.85 * box.height,
        }),
      );
    const changes: number[] = [];
    editor.on(
      'transaction',
      ({ transaction }) => void (transaction.docChanged && changes.push(transaction.steps.length)),
    );
    send('pointerdown', 0);
    send('pointermove', 24);
    send('pointermove', 48);
    send('pointerup', 48);
    expect(paraAt(editor.state).indent).toEqual({ start: 36, end: 0, first: 0 });
    // One drag is one transaction, so one undo step of the page's history takes the whole drag back.
    expect(changes).toHaveLength(1);
  });
});

describe('writing back, with several paragraphs selected', () => {
  it('a first-line drag changes only the first field of each, so every left indent stays', async () => {
    mounted = place(1, 100, '[one\n\ntwo]');
    const run = mounted.editor;
    const targets = paraTargets(run.state.doc, 0, run.state.doc.content.size);
    expect(targets).toHaveLength(2);
    const tr = run.state.tr;
    tr.setNodeAttribute(targets[0].pos, 'indent', { start: 36, end: 0, first: 0 });
    tr.setNodeAttribute(targets[1].pos, 'indent', { start: 72, end: 0, first: 0 });
    run.view.dispatch(tr);
    setRulerShown(true);
    const view = render(<Ruler mounted={fakePage(run)} />);
    await frame();
    await frames(3);
    const track = view.container.querySelector<HTMLElement>('[data-track]')!;
    const box = track.getBoundingClientRect();
    const send = (type: string, dx: number) =>
      track.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 9,
          pointerType: 'mouse',
          button: 0,
          clientX: box.left + 48 + dx,
          clientY: box.top + 0.2 * box.height,
        }),
      );
    // The first-line marker of the first paragraph is at 36 pt = 48 px.
    send('pointerdown', 0);
    send('pointermove', 12);
    send('pointermove', 24);
    send('pointerup', 24);
    const after = paraTargets(run.state.doc, 0, run.state.doc.content.size).map(
      ({ node }) => paraFormat(node.attrs).indent,
    );
    expect(after).toEqual([
      { start: 36, end: 0, first: 18 },
      { start: 72, end: 0, first: 18 },
    ]);
  });
});

describe('the ruler follows the text block', () => {
  it('re-measures when the block is resized with no camera move', async () => {
    const { track, editor } = await show(1);
    expect(track.getBoundingClientRect().width).toBeCloseTo(560, 0);
    (editor.view.dom as HTMLElement).style.width = '440px';
    await vi.waitFor(() => expect(track.getBoundingClientRect().width).toBeCloseTo(400, 0));
  });
});

describe('typing with the ruler shown', () => {
  it('reads the paragraph only: no style or layout measurement per keystroke', async () => {
    const { editor } = await show(1);
    const real = window.getComputedStyle.bind(window);
    const fromRuler: string[] = [];
    const measured = vi.spyOn(window, 'getComputedStyle').mockImplementation((...args) => {
      if (new Error().stack?.includes('Ruler.tsx')) fromRuler.push('measured');
      return real(...args);
    });
    for (const char of 'abcde') editor.view.dispatch(editor.state.tr.insertText(char, editor.state.selection.to));
    await frames(3);
    expect(fromRuler).toEqual([]);
    measured.mockRestore();
  });
});

describe('the units choice', () => {
  it('changes the unit of the store and the ruler', async () => {
    const { view } = await show(1);
    setRulerUnit('cm');
    await frame();
    expect(rulerState.get().unit).toBe('cm');
    expect(view.container.querySelector('select')!.value).toBe('cm');
  });
});

describe('no text block', () => {
  it('says to click in a text block', async () => {
    setRulerShown(true);
    const view = render(<Ruler mounted={fakePage(null)} />);
    await frame();
    expect(view.container.textContent).toContain('Click in a text block to see its ruler.');
  });
});
