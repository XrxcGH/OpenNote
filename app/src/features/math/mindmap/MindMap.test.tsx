// The mind map in a real browser: the pen builds it (tap to write, drag out for a branch, drag onto a branch to move),
// and the toolbar offers the three picture formats.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MindMap } from './MindMap';
import type { MapNode } from './tree';

afterEach(cleanup);

const start: MapNode = {
  id: 'r',
  text: 'Cells',
  children: [
    { id: 'a', text: 'Nucleus', children: [] },
    { id: 'b', text: 'Membrane', children: [] },
  ],
};

function chip(id: string): HTMLElement {
  return document.querySelector(`[data-node="${id}"] > div`) as HTMLElement;
}

function penDrag(from: HTMLElement, to: { x: number; y: number }) {
  const box = from.getBoundingClientRect();
  const x = box.left + 5;
  const y = box.top + 5;
  fireEvent.pointerDown(from, { pointerType: 'pen', clientX: x, clientY: y, pointerId: 7, isPrimary: true });
  fireEvent.pointerUp(from, { pointerType: 'pen', clientX: to.x, clientY: to.y, pointerId: 7, isPrimary: true });
}

describe('MindMap with a pen', () => {
  it('writes in a branch when the pen taps it', async () => {
    render(<MindMap data={{ root: start }} readOnly={false} onChange={vi.fn()} />);
    const target = chip('a');
    const box = target.getBoundingClientRect();
    penDrag(target, { x: box.left + 5, y: box.top + 5 });
    await waitFor(() => expect(screen.getByLabelText('Branch text')).toBeTruthy());
  });

  it('moves a branch under another when the pen drags it there', async () => {
    const onChange = vi.fn();
    render(<MindMap data={{ root: start }} readOnly={false} onChange={onChange} />);
    const over = chip('b').getBoundingClientRect();
    penDrag(chip('a'), { x: over.left + 10, y: over.top + 10 });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls.at(-1)?.[0] as MapNode;
    expect(next.children.map((child) => child.id)).toEqual(['b']);
    expect(next.children[0].children.map((child) => child.id)).toEqual(['a']);
  });

  it('adds a branch under the one the pen drags out of, into empty space', async () => {
    const onChange = vi.fn();
    render(<MindMap data={{ root: start }} readOnly={false} onChange={onChange} />);
    penDrag(chip('a'), { x: 2, y: 790 });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls.at(-1)?.[0] as MapNode;
    expect(next.children[0].children).toHaveLength(1);
  });

  it('ignores a mouse drag, and offers the three pictures', () => {
    const onChange = vi.fn();
    render(<MindMap data={{ root: start }} readOnly={false} onChange={onChange} />);
    const from = chip('a');
    fireEvent.pointerDown(from, { pointerType: 'mouse', clientX: 5, clientY: 5 });
    fireEvent.pointerUp(from, { pointerType: 'mouse', clientX: 300, clientY: 300 });
    expect(onChange).not.toHaveBeenCalled();
    for (const name of ['Save as SVG', 'Save as PNG', 'Save as PDF']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });
});
