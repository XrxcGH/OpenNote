// The ruler's slider semantics, palm rejection, and announcements, in a real browser.
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Indent } from '../../../editor/paragraph/attributes';
import { announcements } from '../../../ui/announce';
import type { TabType } from './geometry';
import { isPalm } from './palm';
import { RulerBar } from './RulerBar';

const WIDTH = 468;

function setup(options: { indent?: Indent; tabType?: TabType; rtl?: boolean; onRelease?: () => void } = {}) {
  const onIndent = vi.fn();
  const onTabs = vi.fn();
  const view = render(
    <RulerBar
      unit="in"
      zoom={1}
      width={WIDTH}
      indent={options.indent ?? { start: 0, end: 0, first: 0 }}
      rtl={options.rtl}
      tabs={[]}
      tabType={options.tabType ?? 'center'}
      onIndent={onIndent}
      onTabs={onTabs}
      onRelease={options.onRelease}
    />,
  );
  const track = view.container.querySelector<HTMLElement>('[data-track]')!;
  const marker = (id: string) => view.container.querySelector<HTMLElement>(`[data-marker="${id}"]`)!;
  const tap = (x: number, init: PointerEventInit = {}) => {
    const box = track.getBoundingClientRect();
    const at = {
      bubbles: true,
      pointerId: 4,
      pointerType: 'mouse',
      button: 0,
      clientX: box.left + x,
      clientY: box.top + 20,
    };
    track.dispatchEvent(new PointerEvent('pointerdown', { ...at, ...init }));
    track.dispatchEvent(new PointerEvent('pointerup', { ...at, ...init }));
  };
  const pointer = (type: string, x: number, y: number) =>
    track.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 5,
        pointerType: 'mouse',
        button: 0,
        clientX: track.getBoundingClientRect().left + x,
        clientY: track.getBoundingClientRect().top + y,
      }),
    );
  /** A drag from x to x + dx at height y, as a mouse does it. */
  const drag = (x: number, y: number, dx: number) => {
    pointer('pointerdown', x, y);
    pointer('pointermove', x + dx / 2, y);
    pointer('pointermove', x + dx, y);
    pointer('pointerup', x + dx, y);
  };
  return { onIndent, onTabs, marker, tap, track, drag };
}

const key = (el: HTMLElement, name: string) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

describe('the right indent slider (ARIA slider pattern)', () => {
  it('shows its place from the left edge, so ArrowRight raises the value and shrinks the end indent', () => {
    const { onIndent, marker } = setup({ indent: { start: 0, end: 36, first: 0 } });
    const right = marker('right');
    expect(right.getAttribute('aria-valuenow')).toBe('6');
    expect(right.getAttribute('aria-valuemax')).toBe('6.5');
    key(right, 'ArrowRight');
    expect(onIndent).toHaveBeenCalledWith({ start: 0, end: 31.5, first: 0 });
  });

  it('Home goes to the minimum value and End to the maximum', () => {
    const { onIndent, marker } = setup({ indent: { start: 0, end: 36, first: 0 } });
    key(marker('right'), 'End');
    expect(onIndent).toHaveBeenLastCalledWith({ start: 0, end: 0, first: 0 });
    key(marker('right'), 'Home');
    // Home stops one column width (1/16 inch) right of the other markers, which are all at 0 here.
    expect(onIndent).toHaveBeenLastCalledWith({ start: 0, end: WIDTH - 4.5, first: 0 });
  });
});

describe('markers do not cross', () => {
  const crossed = { start: 216, end: 0, first: 0 };

  it('Home on the right marker stops right of the left indent, and the range says so', () => {
    const { onIndent, marker } = setup({ indent: crossed });
    expect(marker('right').getAttribute('aria-valuemin')).toBe('3.06');
    key(marker('right'), 'Home');
    expect(onIndent).toHaveBeenLastCalledWith({ start: 216, end: WIDTH - 216 - 4.5, first: 0 });
  });

  it('End on the left marker stops left of the right indent', () => {
    const { onIndent, marker } = setup({ indent: { start: 0, end: 72, first: 0 } });
    key(marker('left'), 'End');
    expect(onIndent).toHaveBeenLastCalledWith({ start: WIDTH - 72 - 4.5, end: 72, first: 0 });
    expect(marker('left').getAttribute('aria-valuemax')).toBe('5.44');
  });

  it('the first-line marker keeps clear of the right indent too, with a drag', () => {
    const { onIndent, drag } = setup({ indent: { start: 0, end: 72, first: 0 } });
    // The first-line glyph is at x 0; drag it far past the right marker (at 396 pt, 528 px).
    drag(0, 9, 700);
    expect(onIndent).toHaveBeenLastCalledWith({ start: 0, end: 72, first: WIDTH - 72 - 4.5 });
  });

  it('a drag of the right marker stops right of the left marker', () => {
    const { onIndent, drag } = setup({ indent: { start: 216, end: 36, first: 0 } });
    // The right marker is at 432 pt = 576 px. Drag it far left.
    drag(576, 0.55 * 44, -800);
    expect(onIndent).toHaveBeenLastCalledWith({ start: 216, end: WIDTH - 216 - 4.5, first: 0 });
  });
});

describe('negative indents', () => {
  const outdent = { start: -36, end: 0, first: 0 };

  it('ArrowLeft moves a negative marker further left, and the minimum is negative', () => {
    const { onIndent, marker } = setup({ indent: outdent });
    expect(Number(marker('left').getAttribute('aria-valuemin'))).toBeLessThan(0);
    key(marker('left'), 'ArrowLeft');
    expect(onIndent).toHaveBeenLastCalledWith({ start: -40.5, end: 0, first: 0 });
  });

  it('ArrowRight moves it right, toward the text', () => {
    const { onIndent, marker } = setup({ indent: outdent });
    key(marker('left'), 'ArrowRight');
    expect(onIndent).toHaveBeenLastCalledWith({ start: -31.5, end: 0, first: 0 });
  });

  it('a first-line marker outdented into the margin keeps its place on a key', () => {
    const { onIndent, marker } = setup({ indent: { start: 0, end: 0, first: -36 } });
    key(marker('first'), 'ArrowLeft');
    expect(onIndent).toHaveBeenLastCalledWith({ start: 0, end: 0, first: -40.5 });
  });
});

describe('the focus ring', () => {
  it.each(['first', 'hanging', 'left', 'right'])('shows on the %s marker, unclipped', (id) => {
    const { marker } = setup();
    const target = marker(id);
    target.focus();
    expect(document.activeElement).toBe(target);
    const ring = target.lastElementChild as HTMLElement;
    const style = getComputedStyle(ring);
    expect(style.display).not.toBe('none');
    expect(style.outlineStyle).toBe('solid');
    expect(style.outlineWidth).not.toBe('0px');
    // A clip-path on the ring, or on anything around it, would cut the outline off.
    expect(style.clipPath).toBe('none');
    expect(getComputedStyle(target).clipPath).toBe('none');
    expect(ring.getBoundingClientRect().width).toBeGreaterThan(0);
  });

  it('shows on a tab marker, and not on a marker that has no focus', () => {
    const view = render(
      <RulerBar
        unit="in"
        zoom={1}
        width={WIDTH}
        indent={{ start: 0, end: 0, first: 0 }}
        tabs={[{ pos: 144, align: 'center', leader: 'none' }]}
        tabType="start"
        onIndent={() => undefined}
        onTabs={() => undefined}
      />,
    );
    const tab = view.container.querySelector<HTMLElement>('[data-marker="tab:144"]')!;
    const ring = tab.lastElementChild as HTMLElement;
    expect(getComputedStyle(ring).display).toBe('none');
    tab.focus();
    expect(getComputedStyle(ring).display).not.toBe('none');
    expect(getComputedStyle(ring).clipPath).toBe('none');
  });
});

describe('a right-to-left paragraph', () => {
  it('draws the left indent from the right edge, and a drag toward the left raises it', () => {
    const { marker, track, onIndent, drag } = setup({ indent: { start: 36, end: 0, first: 0 }, rtl: true });
    const box = track.getBoundingClientRect();
    const at = marker('left').getBoundingClientRect();
    // 36 pt is 48 px from the right edge.
    expect(box.right - (at.left + at.width / 2)).toBeCloseTo(48, 0);
    // The pointer x is measured from the left of the track: 48 px from the right edge.
    drag(box.width - 48, 0.85 * 44, -24);
    expect(onIndent).toHaveBeenLastCalledWith({ start: 54, end: 0, first: 0 });
  });
});

describe('palm rejection on the ruler (ADR 0027)', () => {
  it('ignores a large touch contact, and a touch while the pen is near, but not a pen or a mouse', () => {
    const { onTabs, tap } = setup();
    tap(192, { pointerType: 'touch', width: 140, height: 160 });
    expect(onTabs).not.toHaveBeenCalled();
    // The pen hovers over the page: a fingertip right after is a resting hand.
    document.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'pen', pointerId: 3, bubbles: true }));
    expect(isPalm({ pointerType: 'touch', width: 30, height: 30 })).toBe(true);
    expect(isPalm({ pointerType: 'pen', width: 400, height: 400 })).toBe(false);
    expect(isPalm({ pointerType: 'mouse' })).toBe(false);
  });

  it('takes a fingertip when no pen was seen lately', async () => {
    await new Promise((resolve) => setTimeout(resolve, 1600));
    const { onTabs, tap } = setup();
    tap(192, { pointerType: 'touch', width: 30, height: 30 });
    expect(onTabs).toHaveBeenCalledTimes(1);
  });
});

describe('the first-line and hanging selector types', () => {
  it('announce the indent they set, and a finished click asks the host to refocus the text', () => {
    const onRelease = vi.fn();
    const { onIndent, tap } = setup({ tabType: 'hanging', onRelease });
    tap(48);
    expect(onIndent).toHaveBeenCalledTimes(1);
    expect(announcements()).toContain('Hanging indent, 0.5 inches.');
    expect(onRelease).toHaveBeenCalledTimes(1);
  });
});
