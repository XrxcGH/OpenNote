// The beam and truss blocks in a real browser: the starter problems are solved beside the drawing, the shear and
// moment diagrams are drawn with text alternatives, and parts are added, moved, and joined from the toolbar,
// the keyboard, and the pointer.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { starterBeam } from './beam';
import type { BeamModel } from './beam';
import { BeamPanel } from './BeamPanel';
import { starterTruss } from './truss';
import type { TrussModel } from './truss';
import { TrussPanel } from './TrussPanel';

afterEach(cleanup);

const results = () => within(screen.getByRole('region', { name: 'Results' }));

describe('BeamPanel', () => {
  const setup = () => {
    const patch = vi.fn();
    render(<BeamPanel data={{ model: starterBeam() }} readOnly={false} patch={patch} announce={vi.fn()} />);
    return { patch, last: () => patch.mock.calls.at(-1)![0].model as BeamModel };
  };

  it('solves the starter beam and draws both diagrams with their ranges', () => {
    setup();
    // 10 kN at 2 m and 4 kN/m over the last 3 m of a 6 m span: RB = (20 + 54) / 6 = 12.333 kN, RA = 9.667 kN.
    expect(results().getByText('9.667 kN')).toBeTruthy();
    expect(results().getByText('12.33 kN')).toBeTruthy();
    expect(screen.getByRole('img', { name: /^Shear force V diagram: from −12.33 kN to 9.667 kN$/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: /^Bending moment M diagram: from 0 kN·m/ })).toBeTruthy();
  });

  it('adds a support from the toolbar and moves a load along the beam with the arrow keys', () => {
    const { last } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Fixed' }));
    expect(last().supports.some((s) => s.kind === 'fixed')).toBe(true);
    expect(results().getByText(/indeterminate/)).toBeTruthy();
    const load = screen.getByRole('button', { name: /^Point load of 10 kN down at 2 m/ });
    load.focus();
    fireEvent.keyDown(load, { key: 'ArrowRight' });
    expect(last().loads.find((l) => l.id === 'p1')).toMatchObject({ x: 2.25 });
  });

  it('edits the selected load in its fields', () => {
    const { last } = setup();
    fireEvent.focus(screen.getByRole('button', { name: /^Point load of 10 kN/ }));
    const field = screen.getByRole('textbox', { name: 'Magnitude' });
    fireEvent.change(field, { target: { value: '20' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(last().loads.find((l) => l.id === 'p1')).toMatchObject({ value: 20 });
  });
});

describe('TrussPanel', () => {
  const setup = () => {
    const patch = vi.fn();
    render(<TrussPanel data={{ model: starterTruss() }} readOnly={false} patch={patch} announce={vi.fn()} />);
    return { patch, last: () => patch.mock.calls.at(-1)![0].model as TrussModel };
  };

  it('lists member forces in tension and compression', () => {
    setup();
    expect(results().getByText(/Statically determinate: 7 members, 3 reactions, 5 joints/)).toBeTruthy();
    expect(results().getAllByText(/\(C\)$/).length).toBeGreaterThan(0);
    expect(results().getAllByText(/\(T\)$/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /^Member AD: .* \(C\)$/ })).toBeTruthy();
  });

  it('adds a joint on an empty grid point and joins it with a member from the fields', () => {
    const { last } = setup();
    const svg = screen.getByRole('group', { name: 'Truss' });
    const box = svg.getBoundingClientRect();
    const ratio = box.width / (16 * 40 + 32);
    const paper = svg.querySelector('[data-grid]')!;
    fireEvent.pointerDown(paper, {
      clientX: box.left + (16 + 12 * 40) * ratio,
      clientY: box.top + (16 + (8 - 6) * 40) * ratio,
      pointerId: 1,
    });
    const added = last().joints.at(-1)!;
    expect(added).toMatchObject({ x: 12, y: 6, label: 'F' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Add member to…' }), { target: { value: 'j5' } });
    expect(last().members.at(-1)).toMatchObject({ a: added.id, b: 'j5' });
  });

  it('draws a member by dragging from joint to joint in member mode', () => {
    const { last } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Draw members' }));
    const svg = screen.getByRole('group', { name: 'Truss' });
    const box = svg.getBoundingClientRect();
    const ratio = box.width / (16 * 40 + 32);
    const at = (x: number, y: number) => ({
      clientX: box.left + (16 + x * 40) * ratio,
      clientY: box.top + (16 + (8 - y) * 40) * ratio,
      pointerId: 2,
    });
    const a = screen.getByRole('button', { name: /^Joint A / });
    fireEvent.pointerDown(a.querySelector('circle')!, at(2, 2));
    fireEvent.pointerMove(svg, at(6, 4));
    fireEvent.pointerUp(svg, at(6.4, 4.4));
    expect(last().members.at(-1)).toMatchObject({ a: 'j1', b: 'j5' });
  });
});
