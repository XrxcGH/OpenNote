// @vitest-environment jsdom
// The page's own caret asks for no frame on each key while the browser draws the caret (caret.ts). A frame asked
// for after every key kept the frame clock running, so the next key waited for its tick: the nightly
// perf-typing-gate's 20-page note and burst conditions.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MountedPage } from '../mount';
import { attachCaret } from './caret';
import { pageExtrasPrefs } from './prefs';

function fakePage(): { mounted: MountedPage; scroller: HTMLElement } {
  const scroller = document.createElement('div');
  document.body.append(scroller);
  const mounted = {
    host: { flag: (name: string) => name === 'page.thickCaret' },
    viewport: { viewport: scroller },
    pool: { active: () => null },
  } as unknown as MountedPage;
  return { mounted, scroller };
}

/** Frames that run when the test says, as the browser runs them after the task. */
const pending: FrameRequestCallback[] = [];
function fakeFrames() {
  return vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => pending.push(callback));
}
const runFrames = () => pending.splice(0).forEach((callback) => callback(performance.now()));

/** Lets the Windows caret read finish and draws the frame it asks for. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 20));
  runFrames();
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('the page caret', () => {
  it('asks for no frame on a key while the browser draws the caret', async () => {
    const frames = fakeFrames();
    const { mounted, scroller } = fakePage();
    const detach = attachCaret(mounted);
    await settle();
    frames.mockClear();
    document.dispatchEvent(new Event('selectionchange'));
    scroller.dispatchEvent(new Event('input', { bubbles: true }));
    scroller.dispatchEvent(new Event('scroll'));
    expect(frames).not.toHaveBeenCalled();
    runFrames();
    detach();
  });

  it('still follows the selection when it draws its own caret', async () => {
    const frames = fakeFrames();
    const before = pageExtrasPrefs.get();
    pageExtrasPrefs.set({ ...before, caretFollowsWindows: false, caretWidth: 3 });
    const { mounted } = fakePage();
    const detach = attachCaret(mounted);
    await settle();
    frames.mockClear();
    document.dispatchEvent(new Event('selectionchange'));
    expect(frames).toHaveBeenCalledTimes(1);
    runFrames();
    detach();
    pageExtrasPrefs.set(before);
  });
});
