// Ctrl+C on lassoed ink and Ctrl+V on another page (walk 9, T1-D03-5).
import { describe, expect, it, vi } from 'vitest';
import { makeStroke } from '../geometry/fixtures';
import type { InkStroke } from '../model/types';
import type { InkHost } from './host';
import { INK_CLIPBOARD_TYPE, installInkClipboard, PASTE_NUDGE } from './inkClipboard';
import type { InkSurface } from './surface';

const red = {
  ...makeStroke('s1', [
    { x: 10, y: 10 },
    { x: 60, y: 40 },
  ]),
  color: { r: 200, g: 30, b: 30, a: 255 },
  slot: 0,
  block: 'layer1',
} as unknown as InkStroke;

function page(strokes: InkStroke[], selected: string[]) {
  const added: InkStroke[] = [];
  const select = vi.fn();
  const host = { selection: { get: () => ({ strokes: selected, blocks: [] }) }, select } as unknown as InkHost;
  const surface = {
    readOnly: false,
    strokes: (ids: readonly string[]) => strokes.filter((s) => ids.includes(s.id)),
    layerFor: () => 'layer2',
    add: (more: InkStroke[]) => (added.push(...more), Promise.resolve(true)),
  } as unknown as InkSurface;
  return { host, surface, added, select };
}

const send = (type: 'copy' | 'paste', data: DataTransfer) => {
  const event = new ClipboardEvent(type, { clipboardData: data, bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  return event;
};

describe('copying lassoed ink', () => {
  it('puts the strokes on the clipboard and pastes them on another page with their colors', async () => {
    const first = page([red], ['s1']);
    const stopFirst = installInkClipboard(first.host, () => first.surface);
    const data = new DataTransfer();
    expect(send('copy', data).defaultPrevented).toBe(true);
    stopFirst();
    expect(data.getData(INK_CLIPBOARD_TYPE)).not.toBe('');

    const second = page([], []);
    const stopSecond = installInkClipboard(second.host, () => second.surface);
    expect(send('paste', data).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(second.added).toHaveLength(1));
    stopSecond();
    const [pasted] = second.added;
    expect(pasted!.color).toEqual(red.color);
    expect(pasted!.block).toBe('layer2');
    expect(pasted!.id).not.toBe('s1');
    expect(pasted!.points[0]).toMatchObject({ x: 10, y: 10 });
    expect(second.select).toHaveBeenCalledWith({ strokes: [pasted!.id], blocks: [] });
  });

  it('moves a paste onto the same page a little, so the copy does not hide the original', async () => {
    const one = page([red], ['s1']);
    const stop = installInkClipboard(one.host, () => one.surface);
    const data = new DataTransfer();
    send('copy', data);
    send('paste', data);
    await vi.waitFor(() => expect(one.added).toHaveLength(1));
    stop();
    expect(one.added[0]!.points[0]).toMatchObject({ x: 10 + PASTE_NUDGE, y: 10 + PASTE_NUDGE });
  });

  it('leaves copy alone with nothing lassoed', () => {
    const none = page([red], []);
    const stop = installInkClipboard(none.host, () => none.surface);
    expect(send('copy', new DataTransfer()).defaultPrevented).toBe(false);
    stop();
  });
});
