// The free-body diagram kit in a real browser: the starter beam is solved beside the drawing, parts are added from
// the toolbar, moved with the keyboard and by dragging, and every change is saved as one patch with a text fallback.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { starterFbd } from './model';
import type { FbdModel } from './model';
import { FbdPanel } from './FbdPanel';

afterEach(cleanup);

function setup(model: FbdModel = starterFbd()) {
  const patch = vi.fn();
  const announce = vi.fn();
  render(<FbdPanel data={{ model }} readOnly={false} patch={patch} announce={announce} />);
  return { patch, announce };
}

const results = () => within(screen.getByRole('group', { name: 'Results' }));
const lastModel = (patch: ReturnType<typeof vi.fn>) => patch.mock.calls.at(-1)![0].model as FbdModel;

describe('FbdPanel', () => {
  it('shows the sums and the reactions of the starter beam beside the drawing', () => {
    setup();
    // 10 kN down at x = 7 on supports at 4 and 12: Ay = 6.25 kN and B = 3.75 kN.
    expect(results().getByText('−10 kN')).toBeTruthy();
    expect(results().getByText('6.25 kN')).toBeTruthy();
    expect(results().getByText('3.75 kN')).toBeTruthy();
    expect(results().getByText(/every sum is zero/)).toBeTruthy();
  });

  it('adds a force from the toolbar and saves it with a text fallback', async () => {
    const { patch, announce } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Force' }));
    const model = lastModel(patch);
    expect(model.parts.filter((part) => part.kind === 'force')).toHaveLength(2);
    expect(patch.mock.calls.at(-1)![1]).toMatch(/^Free-body diagram: /);
    expect(announce).toHaveBeenCalledWith(expect.stringMatching(/^Force F2/));
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Force F2/));
  });

  it('moves and turns the selected force from the keyboard', () => {
    const { patch } = setup();
    const force = screen.getByRole('button', { name: /^Force F1/ });
    force.focus();
    fireEvent.keyDown(force, { key: 'ArrowRight' });
    expect(lastModel(patch).parts.find((part) => part.id === 'f1')).toMatchObject({ x: 7.5, y: 4.5 });
    fireEvent.keyDown(screen.getByRole('button', { name: /^Force F1/ }), { key: 'r' });
    expect(lastModel(patch).parts.find((part) => part.id === 'f1')).toMatchObject({ angle: 285 });
  });

  it('snaps a dragged force onto the corner of the body', () => {
    const { patch } = setup();
    const force = screen.getByRole('button', { name: /^Force F1/ });
    const svg = force.closest('svg')!;
    const box = svg.getBoundingClientRect();
    // The canvas is 16 × 9 units at 40 px with a 16 px margin; scale to its drawn size.
    const ratio = box.width / (16 * 40 + 32);
    const at = (x: number, y: number) => ({
      clientX: box.left + (16 + x * 40) * ratio,
      clientY: box.top + (16 + (9 - y) * 40) * ratio,
      pointerId: 3,
    });
    fireEvent.pointerDown(force.querySelector('circle')!, at(7, 4.5));
    // The body's top-right corner is (12, 4.5); a drop near it lands on it exactly.
    fireEvent.pointerMove(svg, at(11.8, 4.62));
    fireEvent.pointerUp(svg, at(11.8, 4.62));
    expect(lastModel(patch).parts.find((part) => part.id === 'f1')).toMatchObject({ x: 12, y: 4.5 });
  });

  it('removes a part with Delete and says the beam can no longer be held', () => {
    const { patch } = setup();
    const roller = screen.getByRole('button', { name: /^Roller support B/ });
    roller.focus();
    fireEvent.keyDown(roller, { key: 'Delete' });
    expect(lastModel(patch).parts.some((part) => part.id === 's2')).toBe(false);
    expect(results().getByText(/cannot hold the body/)).toBeTruthy();
  });

  it('draws without editing tools when the page is read-only', () => {
    render(<FbdPanel data={{ model: starterFbd() }} readOnly patch={vi.fn()} announce={vi.fn()} />);
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.getByRole('group', { name: 'Free-body diagram' })).toBeTruthy();
  });
});
