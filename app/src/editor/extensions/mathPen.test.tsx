// The writing area for math: strokes from a pen, a finger, or a mouse, with a resting palm ignored once a pen is seen.
import { describe, expect, it } from 'vitest';
import { createPenPad } from './mathPen';

function stroke(canvas: HTMLElement, type: string, from: [number, number], to: [number, number]) {
  const make = (name: string, [x, y]: [number, number]) =>
    new PointerEvent(name, {
      pointerType: type,
      pointerId: 1,
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    });
  canvas.dispatchEvent(make('pointerdown', from));
  canvas.dispatchEvent(make('pointermove', [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]));
  canvas.dispatchEvent(make('pointermove', to));
  canvas.dispatchEvent(make('pointerup', to));
}

describe('the math writing area', () => {
  it('collects what is written and clears it', () => {
    const done: number[] = [];
    const pad = createPenPad(() => done.push(1));
    document.body.append(pad.element);
    const canvas = pad.element.querySelector('canvas') as HTMLElement;
    stroke(canvas, 'pen', [10, 10], [60, 40]);
    stroke(canvas, 'mouse', [20, 50], [80, 50]);
    expect(pad.strokes()).toHaveLength(2);
    expect(pad.strokes()[0]?.length).toBeGreaterThanOrEqual(3);
    const [use, clear] = [...pad.element.querySelectorAll('button')];
    clear?.click();
    expect(pad.strokes()).toHaveLength(0);
    use?.click();
    expect(done).toEqual([1]);
    pad.element.remove();
  });

  it('ignores a palm touching the pad after the pen has been used', () => {
    const pad = createPenPad(() => undefined);
    document.body.append(pad.element);
    const canvas = pad.element.querySelector('canvas') as HTMLElement;
    stroke(canvas, 'touch', [5, 5], [30, 30]);
    expect(pad.strokes()).toHaveLength(1);
    stroke(canvas, 'pen', [10, 10], [60, 40]);
    stroke(canvas, 'touch', [100, 100], [120, 120]);
    expect(pad.strokes()).toHaveLength(2);
    pad.element.remove();
  });

  it('has names for assistive technology', () => {
    const pad = createPenPad(() => undefined);
    expect(pad.element.getAttribute('aria-label')).toBe('Writing area for math');
    expect(pad.element.querySelector('canvas')?.getAttribute('aria-label')).toContain('pen or finger');
    expect([...pad.element.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Use writing', 'Clear']);
  });
});
