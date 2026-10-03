// A block view whose renderer loads on first use (owner: WP6). Registrations load at start-up, so the table
// renderer and its editor stay in their own chunk: the wrapper shows at once, and the real view fills it when the
// chunk arrives, with the newest block data.
import type { BlockJson } from '../../../services/pages/types';
import type { BlockRenderContext, BlockView } from '../blocks/types';

export interface InnerView extends Omit<BlockView, 'element'> {
  readonly element: HTMLElement;
}

type Load = () => Promise<{ createInner(wrapper: HTMLElement, block: BlockJson, ctx: BlockRenderContext): InnerView }>;

/** The wrapper's views, so tests and the E2E spec can wait for the real one. */
const ready = new WeakMap<HTMLElement, Promise<void>>();

export function whenViewReady(wrapper: HTMLElement): Promise<void> {
  return ready.get(wrapper) ?? Promise.resolve();
}

export function lazyBlockView(block: BlockJson, ctx: BlockRenderContext, load: Load, label: string): BlockView {
  const element = document.createElement('div');
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', label);
  element.tabIndex = -1;
  element.dataset.blockId = block.id;
  let latest = block;
  let inner: InnerView | null = null;
  let gone = false;
  ready.set(
    element,
    load().then(({ createInner }) => {
      if (gone) return;
      inner = createInner(element, latest, ctx);
    }),
  );
  return {
    element,
    get editRoot() {
      return inner?.editRoot ?? null;
    },
    update(next) {
      latest = next;
      inner?.update(next);
    },
    measure: () =>
      inner?.measure() ?? {
        x: element.offsetLeft,
        y: element.offsetTop,
        w: element.offsetWidth,
        h: element.offsetHeight,
      },
    destroy() {
      gone = true;
      inner?.destroy();
      element.remove();
    },
  };
}
