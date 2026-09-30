import { fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { getSettings } from '../../state/settings';
import { announcements, pressChord, renderApp } from '../../test';
import { steppedTextSize } from './zoom';

beforeEach(() => localStorage.clear());

const textSize = () => getSettings().appearance.textSize;
const wheel = (target: Element | Window, deltaY: number) => {
  fireEvent.wheel(target, { ctrlKey: true, deltaY, cancelable: true });
};

describe('steppedTextSize', () => {
  it('steps through the sizes and stops at the ends', () => {
    expect(steppedTextSize(100, 1)).toBe(110);
    expect(steppedTextSize(100, -1)).toBe(90);
    expect(steppedTextSize(200, 1)).toBe(200);
    expect(steppedTextSize(80, -1)).toBe(80);
  });
});

describe('text size', () => {
  it('steps with Ctrl+= and Ctrl+-, resets with Ctrl+0, and says the size', async () => {
    await renderApp();
    await pressChord('Ctrl+=');
    await expect.poll(textSize).toBe(110);
    await pressChord('Ctrl+-');
    await pressChord('Ctrl+-');
    await expect.poll(textSize).toBe(90);
    await pressChord('Ctrl+0');
    await expect.poll(textSize).toBe(100);
    expect(announcements()).toEqual(['Text size 110%', 'Text size 100%', 'Text size 90%', 'Text size 100%']);
  });

  it('steps with Ctrl+wheel outside the page, and leaves the page to zoom itself', async () => {
    const { container } = await renderApp();
    const page = document.createElement('div');
    page.dataset.region = 'page';
    container.append(page);
    wheel(page, -100);
    expect(textSize()).toBe(100);
    wheel(window, -100);
    await expect.poll(textSize).toBe(110);
    wheel(window, 40);
    expect(textSize()).toBe(110);
    wheel(window, 60);
    await expect.poll(textSize).toBe(100);
  });
});
