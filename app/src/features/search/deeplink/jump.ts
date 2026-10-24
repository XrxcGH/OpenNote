// Opening a link at its target: the page opens, then the view scrolls to the block or element and marks it for a
// moment. The page view mounts a moment after the location changes, so this looks again for a few seconds.
import { shownMounted } from '../../page';
import type { MountedPage } from '../../page';
import type { NotesService } from '../../../services/notes/types';
import { openPage } from '../locate';
import { flash } from './flash';

const ATTEMPTS = 40;
const STEP_MS = 100;

export { flash };

/** The elements of a text block as they appear in its DOM, in document order (SPEC 6.6). */
const ELEMENTS = 'p, h1, h2, h3, h4, h5, h6, li, pre, hr';

function elementNodes(root: Element): Element[] {
  return [...root.querySelectorAll(ELEMENTS)].filter((node) => {
    const parent = node.parentElement;
    return !(parent?.tagName === 'LI' && parent.firstElementChild === node);
  });
}

/** The DOM element a link target names in the page that is shown, or null while it isn't there yet. */
export function targetElement(mounted: MountedPage, target: string): Element | null {
  const blocks = mounted.layer.blocks();
  const block =
    blocks.find((candidate) => candidate.id === target) ??
    blocks.find((candidate) => Array.isArray(candidate.data.ids) && candidate.data.ids.includes(target));
  if (!block) return null;
  const wrapper = mounted.viewport.world.querySelector(`[data-block-id="${CSS.escape(block.id)}"]`);
  if (!wrapper) return null;
  if (block.id === target) return wrapper;
  const index = (block.data.ids as string[]).indexOf(target);
  const root = wrapper.querySelector('.ProseMirror') ?? wrapper;
  return elementNodes(root)[index] ?? wrapper;
}

/** Waits for the page to be shown, then reveals the target. Resolves false when it never appears. */
export function revealWhenShown(pageId: string, target: string): Promise<boolean> {
  return new Promise((resolve) => {
    let tries = 0;
    const attempt = () => {
      const mounted = shownMounted.get();
      const found = mounted && mounted.page.id === pageId ? targetElement(mounted, target) : null;
      if (found) {
        flash(found);
        resolve(true);
      } else if (++tries >= ATTEMPTS) {
        resolve(false);
      } else {
        setTimeout(attempt, STEP_MS);
      }
    };
    attempt();
  });
}

/** Opens the page and jumps to the target. Resolves false only when the page is gone. */
export async function openAndReveal(notes: NotesService, pageId: string, target: string | null): Promise<boolean> {
  const opened = await openPage(notes, pageId);
  if (opened && target) void revealWhenShown(pageId, target);
  return opened;
}
