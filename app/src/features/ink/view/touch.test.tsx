// T2-12: a palm-sized touch must not press a control while the pen is in use, however long it rests; a pen's own tap
// and a finger's tap still press.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InkHost } from './host';
import { chooseTool } from './state';
import { TouchTool } from './touch';
import type { InkSurface } from './surface';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const surface = { readOnly: false } as unknown as InkSurface;

function pointer(type: string, init: PointerEventInit): void {
  const target = type === 'click' ? button : window;
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, ...init }));
}

let button: HTMLButtonElement;
let tool: TouchTool;
let pressed = 0;

beforeEach(async () => {
  chooseTool('pen');
  await import('./palm');
  button = document.body.appendChild(document.createElement('button'));
  pressed = 0;
  button.addEventListener('click', () => pressed++);
  tool = new TouchTool({} as InkHost, () => surface);
  await import('./palm');
  await wait(100);
});

afterEach(() => {
  tool.destroy();
  button.remove();
});

const palm = { pointerType: 'touch', pointerId: 5, width: 60, height: 60 };

describe('a palm-sized touch on a control while the pen is in use', () => {
  it('does not press it when the palm rests longer than a second and then lifts', async () => {
    pointer('pointermove', { pointerType: 'pen', pointerId: 2 });
    pointer('pointerdown', palm);
    await wait(1200);
    pointer('pointerup', palm);
    pointer('click', palm);
    expect(pressed).toBe(0);
  });

  it('does not press it when the palm landed before the pen wrote', async () => {
    pointer('pointerdown', palm);
    await wait(200);
    pointer('pointermove', { pointerType: 'pen', pointerId: 2 });
    pointer('pointerup', palm);
    pointer('click', palm);
    expect(pressed).toBe(0);
  });

  it('lets the pen tap right after the palm landed, and a finger tap', async () => {
    pointer('pointerdown', palm);
    pointer('pointerdown', { pointerType: 'pen', pointerId: 2 });
    pointer('pointerup', { pointerType: 'pen', pointerId: 2 });
    pointer('click', { pointerType: 'pen', pointerId: 2 });
    expect(pressed).toBe(1);
    pointer('pointerup', palm);
    await wait(100);
    const finger = { pointerType: 'touch', pointerId: 9, width: 10, height: 10 };
    pointer('pointerdown', finger);
    pointer('pointerup', finger);
    pointer('click', finger);
    expect(pressed).toBe(2);
  });
});
