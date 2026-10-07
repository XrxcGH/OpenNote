// Images on a real page view in the browser: the block shows at its asset's size, a selected image shows its
// toolbar and handles, crop mode commits one batch, and the alt text dialog and crop fields pass axe.
import { fireEvent, screen } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Edit } from '../../../services/pages/types';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { imageHandle } from '../blocks/imageBlock';
import { selectOnPage } from '../seams/selectionStore';
import { cleanupPages, renderPage } from '../test/harness';
import { textPageFixture } from '../test/fixtures';
import { AltTextDialog } from './AltTextDialog';
import { CropFields } from './CropFields';
import { startCrop } from './cropMode';
import { insertImages } from './insert';

/** A real 400 by 200 PNG, drawn by the browser. */
async function png(): Promise<ArrayBuffer> {
  const canvas = new OffscreenCanvas(400, 200);
  canvas.getContext('2d')!.fillRect(0, 0, 400, 200);
  return (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
}

afterEach(async () => {
  selectOnPage({ blocks: [], strokes: [] });
  await cleanupPages();
});

async function pageWithImage() {
  const page = await renderPage({ fixture: textPageFixture('Photos'), flags: { 'page.images': true } });
  const [id] = await insertImages(
    page.mounted,
    [{ kind: 'bytes', bytes: await png(), name: 'dot.png', mime: 'image/png' }],
    { kind: 'point', x: 40, y: 200 },
  );
  return { page, id, handle: imageHandle(id)! };
}

const sentEdits = (page: Awaited<ReturnType<typeof renderPage>>): Edit[] => page.sent().flatMap((batch) => batch.edits);

describe('image blocks', () => {
  it('show at the asset size with the toolbar and handles when selected', async () => {
    const { page, id, handle } = await pageWithImage();
    const image = handle.element.querySelector('img')!;
    expect(image.getAttribute('width')).toBe('400');
    expect(image.getAttribute('height')).toBe('200');
    expect(handle.element.getAttribute('aria-label')).toBe('Image, no description');
    expect(sentEdits(page).some((edit) => edit.edit === 'addAsset')).toBe(true);
    selectOnPage({ blocks: [id], strokes: [] });
    await vi.waitFor(() => expect(handle.element.querySelector('[role="toolbar"]')).not.toBeNull(), {
      timeout: 10_000,
    });
    expect(handle.element.querySelectorAll('button[aria-label^="Resize"]')).toHaveLength(8);
    expect(handle.element.textContent).toContain('No alt text');
    await expectNoAxeViolations(handle.element);
  });

  it('crop mode keeps a crop as one patch and one move', async () => {
    const { page, handle } = await pageWithImage();
    const before = page.sent().length;
    startCrop(handle);
    const left = screen.getByRole('button', { name: 'Crop from the left' });
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Crop from/);
    await expectNoAxeViolations(handle.element);
    left.focus();
    for (let i = 0; i < 25; i++) fireEvent.keyDown(left, { key: 'ArrowRight' });
    fireEvent.keyDown(left, { key: 'Enter' });
    await vi.waitFor(() => expect(page.sent().length).toBe(before + 1));
    const [patch, move] = page.sent().at(-1)!.edits;
    expect(patch).toMatchObject({ edit: 'patchBlock', data: { crop: { x: 0.25, y: 0, w: 0.75, h: 1 } } });
    expect(move.edit).toBe('moveBlock');
  });

  it('crop mode cancels with Escape', async () => {
    const { page, handle } = await pageWithImage();
    const before = page.sent().length;
    startCrop(handle);
    await userEvent.keyboard('{ArrowRight}{Escape}');
    expect(handle.element.querySelector('[role="group"]')).toBeNull();
    expect(page.sent().length).toBe(before);
  });
});

describe('Size and position for an image', () => {
  it('shows the crop fields and Reset crop, and a crop is one patch and one move', async () => {
    const { page, id } = await pageWithImage();
    selectOnPage({ blocks: [id], strokes: [] });
    page.mounted.objects.command('sizeAndPosition');
    const left = await vi.waitFor(() => screen.getByLabelText('Crop left'), { timeout: 10_000 });
    expect(screen.getByRole('button', { name: 'Reset crop' })).toBeDisabled();
    const before = page.sent().length;
    await userEvent.clear(left);
    await userEvent.type(left, '20{Enter}');
    await vi.waitFor(() => expect(page.sent().length).toBe(before + 1));
    const [patch, move] = page.sent().at(-1)!.edits;
    expect(patch).toMatchObject({ edit: 'patchBlock', data: { crop: { x: 0.2, y: 0, w: 0.8, h: 1 } } });
    expect(move.edit).toBe('moveBlock');
    // The popover closes after the crop, because the image's frame changed with it.
    await vi.waitFor(() => expect(screen.queryByLabelText('Crop left')).toBeNull());
  });
});

describe('the alt text dialog', () => {
  it('saves a description, and the decorative mark disables the field', async () => {
    const onSave = vi.fn();
    renderUi(<AltTextDialog initial={{ alt: '', decorative: false }} onSave={onSave} onCancel={() => {}} />);
    const field = screen.getByLabelText('Description');
    await userEvent.type(field, 'A bar chart of rainfall');
    await expectNoAxeViolations(document.body);
    await userEvent.click(screen.getByLabelText('Decorative (screen readers skip it)'));
    expect(field).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ alt: 'A bar chart of rainfall', decorative: true });
  });
});

describe('the crop fields', () => {
  it('turn percent cuts into a crop and reset it', async () => {
    const onChange = vi.fn();
    const { rerender } = renderUi(
      <main>
        <CropFields crop={null} onChange={onChange} />
      </main>,
    );
    await expectNoAxeViolations(document.body);
    const left = screen.getByLabelText('Crop left');
    await userEvent.clear(left);
    await userEvent.type(left, '10{Enter}');
    expect(onChange).toHaveBeenLastCalledWith({ x: 0.1, y: 0, w: 0.9, h: 1 });
    rerender(
      <main>
        <CropFields crop={{ x: 0.1, y: 0, w: 0.9, h: 1 }} onChange={onChange} />
      </main>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reset crop' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
