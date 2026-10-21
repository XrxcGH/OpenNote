// The chrome's grip names its text box by the box's first line. Typing goes to the editor, not the block layer's copy.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupPages, renderPage } from '../test/harness';
import { textPageFixture } from '../test/fixtures';

afterEach(cleanupPages);

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

describe('the grip of a text box', () => {
  it('is named by the text as typed, not as the page opened', async () => {
    const fixture = textPageFixture('Opened');
    const harness = await renderPage({ fixture });
    const id = fixture.page.blocks[0].id;
    await harness.type(id, ' and typed');
    harness.mounted.objects.select([id]);
    await frame();
    await frame();
    const grip = harness.mounted.chrome.element.querySelector<HTMLElement>('[data-handle="grip"]');
    expect(grip?.title).toBe('Move Opened and typed');
  });
});

describe('the outline of a text box', () => {
  it('follows the box when its content makes it taller', async () => {
    const fixture = textPageFixture('Opened');
    const harness = await renderPage({ fixture });
    const id = fixture.page.blocks[0].id;
    harness.mounted.objects.select([id]);
    await frame();
    await frame();
    const element = document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
    if (!element) throw new Error('The block is not on the page.');
    const outlineHeight = () =>
      Math.max(
        ...[...harness.mounted.chrome.element.children].map(
          (child) => parseFloat((child as HTMLElement).style.blockSize) || 0,
        ),
      );
    const before = outlineHeight();
    element.style.paddingBlockEnd = '300px';
    await vi.waitFor(() => expect(outlineHeight()).toBeGreaterThanOrEqual(before + 290));
  });
});
