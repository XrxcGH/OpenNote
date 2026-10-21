// @vitest-environment jsdom
// A panel's patch draws at once: the page core keeps the data but never tells the view (study tape did not redraw).
import { describe, expect, it, vi } from 'vitest';
import type { BlockJson } from '../../../services/pages/types';
import type { BlockRenderContext } from '../blocks/types';
import { createPanelInner } from './panelBlock';
import type { PanelKind, PanelProps } from './kinds';

describe('panel block', () => {
  it('redraws with the patched data and drops null keys', async () => {
    const seen: Record<string, unknown>[] = [];
    let props!: PanelProps;
    const kind = {
      load: async () => ({
        mount: (_container: HTMLElement, first: PanelProps) => {
          props = first;
          seen.push(first.data);
          return { update: (next: PanelProps) => seen.push(next.data), destroy: () => undefined };
        },
      }),
    } as unknown as PanelKind;
    const send = vi.fn(async () => ({}));
    const ctx = {
      page: { readOnly: null },
      sync: { send },
      host: { announce: () => undefined },
    } as unknown as BlockRenderContext;
    const block = {
      id: 'b1',
      type: 'ext:org.opennote/tape',
      data: { hidden: true, x: 1 },
      order: 'a',
    } as unknown as BlockJson;
    createPanelInner(document.createElement('div'), block, ctx, kind);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    props.patch({ hidden: false, x: null });
    expect(seen.at(-1)).toEqual({ hidden: false });
    expect(send).toHaveBeenCalledOnce();
  });
});
