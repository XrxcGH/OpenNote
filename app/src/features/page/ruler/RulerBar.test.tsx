// The ruler in a real browser: drags at two zooms, the tap threshold, the keyboard, tab stops, and the 44 px targets.
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Indent, TabStop } from '../../../editor/paragraph/attributes';
import { announcements } from '../../../ui/announce';
import type { TabType } from './geometry';
import { RulerBar } from './RulerBar';
import type { RulerUnit } from './units';

const WIDTH = 468;

function setup(
  options: { zoom?: number; indent?: Indent; tabs?: TabStop[]; tabType?: TabType; unit?: RulerUnit } = {},
) {
  const onIndent = vi.fn();
  const onTabs = vi.fn();
  const view = render(
    <RulerBar
      unit={options.unit ?? 'in'}
      zoom={options.zoom ?? 1}
      width={WIDTH}
      indent={options.indent ?? { start: 0, end: 0, first: 0 }}
      tabs={options.tabs ?? []}
      tabType={options.tabType ?? 'start'}
      onTabType={() => undefined}
      onUnit={() => undefined}
      onIndent={onIndent}
      onTabs={onTabs}
    />,
  );
  const track = view.container.querySelector<HTMLElement>('[data-track]')!;
  const marker = (id: string) => view.container.querySelector<HTMLElement>(`[data-marker="${id}"]`)!;
  const pointer = (type: string, x: number, y: number, init: PointerEventInit = {}) =>
    track.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 7,
        pointerType: 'pen',
        button: 0,
        clientX: track.getBoundingClientRect().left + x,
        clientY: track.getBoundingClientRect().top + y,
        ...init,
      }),
    );
  /** Presses at `x` pixels and `y` from the track's top, moves by `dx`, and lets go. */
  const drag = (x: number, y: number, dx: number, dy = 0, init: PointerEventInit = {}) => {
    pointer('pointerdown', x, y, init);
    pointer('pointermove', x + dx / 2, y + dy / 2, init);
    pointer('pointermove', x + dx, y + dy, init);
    pointer('pointerup', x + dx, y + dy, init);
  };
  return { onIndent, onTabs, track, marker, drag, pointer, view };
}

describe('dragging a marker', () => {
  it('a 48 px drag of the first-line marker at 100 percent zoom sets first to 36 pt', () => {
    const { onIndent, drag } = setup({ zoom: 1 });
    drag(0, 9, 48);
    expect(onIndent).toHaveBeenCalledTimes(1);
    expect(onIndent).toHaveBeenCalledWith({ start: 0, end: 0, first: 36 });
  });

  it('the same drag at 200 percent zoom sets first to 18 pt', () => {
    const { onIndent, drag } = setup({ zoom: 2 });
    drag(0, 9, 48);
    expect(onIndent).toHaveBeenCalledWith({ start: 0, end: 0, first: 18 });
  });

  it('a drag of 3 px does not move a marker', () => {
    const { onIndent, onTabs, drag } = setup();
    drag(0, 9, 3);
    expect(onIndent).not.toHaveBeenCalled();
    expect(onTabs).not.toHaveBeenCalled();
  });

  it('snaps to 1/16 inch, and Alt drags freely', () => {
    const snapped = setup();
    snapped.drag(0, 9, 10);
    // 10 px is 7.5 pt; the nearest 1/16 inch (4.5 pt) is 9 pt.
    expect(snapped.onIndent).toHaveBeenCalledWith({ start: 0, end: 0, first: 9 });
    const free = setup();
    free.drag(0, 9, 10, 0, { altKey: true });
    expect(free.onIndent).toHaveBeenCalledWith({ start: 0, end: 0, first: 7.5 });
  });

  it('the left marker moves both indents, and the hanging marker keeps the first line where it is', () => {
    const left = setup({ indent: { start: 36, end: 0, first: 0 } });
    left.drag(48, 38, 48);
    expect(left.onIndent).toHaveBeenCalledWith({ start: 72, end: 0, first: 0 });
    const hanging = setup({ indent: { start: 36, end: 0, first: 0 } });
    hanging.drag(48, 24, 48);
    expect(hanging.onIndent).toHaveBeenCalledWith({ start: 72, end: 0, first: -36 });
  });

  it('the right marker sets the right indent from the right edge', () => {
    const { onIndent, drag } = setup();
    const edge = (WIDTH * 4) / 3;
    drag(edge, 24, -60);
    expect(onIndent).toHaveBeenCalledWith({ start: 0, end: 45, first: 0 });
  });
});

describe('tab stops', () => {
  it('clicking the bare ruler adds a stop of the selected type', () => {
    const { onTabs, pointer } = setup({ tabType: 'center' });
    pointer('pointerdown', 192, 20);
    pointer('pointerup', 192, 20);
    expect(onTabs).toHaveBeenCalledWith([{ pos: 144, align: 'center', leader: 'none' }]);
  });

  it('dragging a stop moves it, and dragging it off the ruler removes it', () => {
    const tabs: TabStop[] = [{ pos: 144, align: 'start', leader: 'none' }];
    const moved = setup({ tabs });
    moved.drag(192, 38, 60);
    expect(moved.onTabs).toHaveBeenCalledWith([{ pos: 189, align: 'start', leader: 'none' }]);
    const removed = setup({ tabs });
    removed.drag(192, 38, 0, 80);
    expect(removed.onTabs).toHaveBeenCalledWith([]);
  });
});

describe('the markers as sliders', () => {
  it('are sliders with a value in the unit, and a hit area of 44 px', () => {
    const { marker } = setup({ indent: { start: 36, end: 0, first: 0 } });
    const first = marker('first');
    expect(first.getAttribute('role')).toBe('slider');
    expect(first.getAttribute('aria-label')).toBe('First line indent');
    expect(first.getAttribute('aria-valuenow')).toBe('0.5');
    expect(first.getAttribute('aria-valuetext')).toBe('0.5 inches');
    expect(first.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    expect(first.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });

  it('arrow keys on a focused marker move it 1/16 inch and announce the value', () => {
    const { onIndent, marker } = setup({ indent: { start: 36, end: 0, first: 0 } });
    const hanging = marker('hanging');
    hanging.focus();
    hanging.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(onIndent).toHaveBeenCalledWith({ start: 40.5, end: 0, first: -4.5 });
    // 40.5 pt is 0.5625 inch, and the value is shown to two decimals.
    expect(announcements()).toContain('Hanging indent, 0.56 inches.');
  });

  it('Delete on a tab stop removes it', () => {
    const { onTabs, marker } = setup({ tabs: [{ pos: 144, align: 'end', leader: 'none' }] });
    marker('tab:144').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    expect(onTabs).toHaveBeenCalledWith([]);
  });
});
