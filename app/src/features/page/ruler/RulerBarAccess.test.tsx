// The ruler's slider semantics, palm rejection, and announcements, in a real browser.
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Indent } from '../../../editor/paragraph/attributes';
import { announcements } from '../../../ui/announce';
import type { TabType } from './geometry';
import { isPalm } from './palm';
import { RulerBar } from './RulerBar';

const WIDTH = 468;

function setup(options: { indent?: Indent; tabType?: TabType; onRelease?: () => void } = {}) {
  const onIndent = vi.fn();
  const onTabs = vi.fn();
  const view = render(
    <RulerBar
      unit="in"
      zoom={1}
      width={WIDTH}
      indent={options.indent ?? { start: 0, end: 0, first: 0 }}
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
  return { onIndent, onTabs, marker, tap };
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
    expect(onIndent).toHaveBeenLastCalledWith({ start: 0, end: WIDTH, first: 0 });
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
