// What a panel block is (Study tools and diagrams), in a module light enough for start-up: the registrations
// declare their kinds here, and the block's code loads when a page shows one.
import type { FlagId } from '../../../app/flags';
import type { MessageKey } from '../../../strings/t';
import type { BlockRendererDef } from '../blocks/types';
import { lazyBlockView } from '../tables/lazyView';
import { t } from '../../../strings/t';

/** What the page gives a feature to draw a block. */
export interface PanelProps {
  block: string;
  data: Record<string, unknown>;
  readOnly: boolean;
  /** Merges `data` into the block's data as one undo step. */
  patch(data: Record<string, unknown>): void;
  announce(text: string): void;
}

export interface PanelHandle {
  update(props: PanelProps): void;
  destroy(): void;
}

export interface PanelKind {
  /** The block's type in page.json. */
  type: string;
  label: MessageKey;
  flag: FlagId;
  load(): Promise<{ mount(container: HTMLElement, props: PanelProps): PanelHandle }>;
}

export function panelRenderer(kind: PanelKind): BlockRendererDef {
  return {
    id: `panel.${kind.type}`,
    types: [kind.type],
    priority: 1,
    flag: kind.flag,
    create: (block, ctx) =>
      lazyBlockView(
        block,
        ctx,
        async () => {
          const loaded = await import('./panelBlock');
          return {
            createInner: (wrapper, current, context) => loaded.createPanelInner(wrapper, current, context, kind),
          };
        },
        t(kind.label),
      ),
  };
}
