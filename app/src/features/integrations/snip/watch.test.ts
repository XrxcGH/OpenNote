// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ClipboardClient, ClipboardContent } from '../../../platform/types';
import { createSnipWatcher } from './watch';

function setup(canAdd = true) {
  const state = { sequence: 1, image: false };
  const clipboard: ClipboardClient = {
    facts: () =>
      Promise.resolve({
        sequence: state.sequence,
        textSha256: null,
        sourceUrl: null,
        hasOneNote: false,
        wordImages: [],
      }),
    read: () =>
      Promise.resolve({
        sequence: state.sequence,
        textSha256: null,
        sourceUrl: null,
        hasOneNote: false,
        wordImages: [],
        html: null,
        text: null,
        imageBmp: state.image ? new ArrayBuffer(16) : null,
      } satisfies ClipboardContent),
  };
  const offers: (() => void)[] = [];
  const watcher = createSnipWatcher(
    { clipboard, canAdd: () => canAdd, offer: (add) => void offers.push(add) },
    () => undefined,
  );
  return { state, watcher, offers };
}

describe('the screenshot offer', () => {
  it('offers once when a picture arrives on the clipboard while the window was away', async () => {
    const { state, watcher, offers } = setup();
    await watcher.blurred();
    state.sequence = 2;
    state.image = true;
    await watcher.focused();
    expect(offers).toHaveLength(1);
    await watcher.blurred();
    await watcher.focused();
    expect(offers).toHaveLength(1);
  });

  it('stays quiet when the clipboard did not change, holds no picture, or no page is open', async () => {
    const same = setup();
    same.state.image = true;
    await same.watcher.blurred();
    await same.watcher.focused();
    expect(same.offers).toHaveLength(0);

    const text = setup();
    await text.watcher.blurred();
    text.state.sequence = 5;
    await text.watcher.focused();
    expect(text.offers).toHaveLength(0);

    const closed = setup(false);
    await closed.watcher.blurred();
    closed.state.sequence = 3;
    closed.state.image = true;
    await closed.watcher.focused();
    expect(closed.offers).toHaveLength(0);
  });
});
