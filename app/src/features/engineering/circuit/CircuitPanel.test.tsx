// The circuit block in a real browser. The starter divider is solved. A part is added from the toolbar, turned
// with a key, and given a value with a prefix. A wire is drawn by dragging between grid points.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { starterCircuit } from './model';
import type { CircuitModel } from './model';
import { CircuitPanel } from './CircuitPanel';

afterEach(cleanup);

function setup() {
  const patch = vi.fn();
  render(<CircuitPanel data={{ model: starterCircuit() }} readOnly={false} patch={patch} announce={vi.fn()} />);
  return { patch, last: () => patch.mock.calls.at(-1)![0].model as CircuitModel };
}

const results = () => within(screen.getByRole('group', { name: 'Results' }));

describe('CircuitPanel', () => {
  it('shows node voltages and branch currents for the starter divider', () => {
    setup();
    expect(results().getByText('12 V')).toBeTruthy();
    expect(results().getByText('8 V')).toBeTruthy();
    expect(results().getAllByText(/^1 mA from /).length).toBe(3);
    expect(results().getByText('R2 takes 8 mW')).toBeTruthy();
    expect(results().getByText('V1 delivers 12 mW')).toBeTruthy();
  });

  it('adds a resistor, turns it with R, and sets its value with a prefix', () => {
    const { last } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Resistor' }));
    const added = last().parts.at(-1)!;
    expect(added).toMatchObject({ kind: 'resistor', label: 'R3', value: 1000 });
    const glyph = screen.getByRole('button', { name: /^Resistor R3/ });
    fireEvent.keyDown(glyph, { key: 'r' });
    expect(last().parts.at(-1)!.rotation).toBe(90);
    fireEvent.focus(screen.getByRole('button', { name: /^Resistor R3/ }));
    const field = screen.getByRole('textbox', { name: 'Value' });
    fireEvent.change(field, { target: { value: '4.7k' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(last().parts.at(-1)!.value).toBe(4700);
  });

  it('says a ground is needed when the ground is removed', () => {
    setup();
    const ground = screen.getByRole('button', { name: /^Ground at/ });
    ground.focus();
    fireEvent.keyDown(ground, { key: 'Delete' });
    expect(results().getByText('Add a ground so the voltages have a reference.')).toBeTruthy();
  });

  it('draws a wire between two grid points in wire mode', () => {
    const { last } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Draw wires' }));
    const svg = screen.getByRole('group', { name: 'Circuit' });
    const box = svg.getBoundingClientRect();
    const ratio = box.width / (16 * 40 + 32);
    const at = (x: number, y: number) => ({
      clientX: box.left + (16 + x * 40) * ratio,
      clientY: box.top + (16 + (10 - y) * 40) * ratio,
      pointerId: 4,
    });
    fireEvent.pointerDown(svg.querySelector('[data-grid]')!, at(12.1, 8.2));
    fireEvent.pointerMove(svg, at(14, 8));
    fireEvent.pointerUp(svg, at(13.9, 7.8));
    expect(last().parts.at(-1)).toMatchObject({ kind: 'wire', x: 12, y: 8, x2: 14, y2: 8 });
  });
});
