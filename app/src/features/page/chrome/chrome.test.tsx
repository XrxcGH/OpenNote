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

describe('the grip of a text box under a floating panel', () => {
  it('stops short of a study tape just above the box, so the tape can be pressed', async () => {
    const fixture = textPageFixture('Below');
    const base = fixture.page.blocks[0]!;
    const tape = {
      ...base,
      id: '01k6f0000000000000000t0002',
      type: 'ext:org.opennote/tape',
      order: 'a0',
      frame: { x: 40, y: 100, w: 260, h: 34 },
      data: { hidden: true },
    };
    const box = { ...base, order: 'a1', frame: { x: 40, y: 142, w: 300 } };
    fixture.page.blocks = [tape, box];
    const harness = await renderPage({ fixture, flags: { 'study.tape': true } });
    await vi.waitFor(
      () => expect(harness.mounted.layer.view(tape.id)!.element.querySelector('button')).not.toBeNull(),
      {
        timeout: 10_000,
      },
    );
    harness.mounted.objects.select([box.id]);
    await frame();
    await frame();
    const grip = harness.mounted.chrome.element.querySelector<HTMLElement>(
      `[data-handle="grip"][data-block="${box.id}"]`,
    )!;
    const tapeElement = harness.mounted.layer.view(tape.id)!.element.getBoundingClientRect();
    const gripBox = grip.getBoundingClientRect();
    expect(gripBox.height).toBeGreaterThanOrEqual(8);
    expect(gripBox.top).toBeGreaterThanOrEqual(tapeElement.bottom - 1);
  });
});
