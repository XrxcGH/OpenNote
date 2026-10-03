// The keys of object mode (ARCHITECTURE.md sections 11.2 and 11.3; owner WP3), like a tree row's fixed keys: they
// act on the focused wrapper and aren't commands. Commands with keys of their own (Delete, F2, and the z-order
// keys) are in registrations/page.ts, in the pageObject scope that every wrapper carries.
import type { BlockId } from '../../../services/pages/types';
import type { PageBlockLayer } from '../blocks/blockLayer';
import { FINE_NUDGE, NUDGE } from './objects';
import type { Objects } from './objects';

const ARROWS: Readonly<Record<string, [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** The block whose wrapper is the event's target itself (not text inside it). */
function wrapperBlock(event: KeyboardEvent, layer: PageBlockLayer): BlockId | null {
  const target = event.target instanceof HTMLElement ? event.target : null;
  const block = target?.dataset.blockId;
  return block && layer.view(block)?.element === target ? block : null;
}

/** Tab and Shift+Tab in object mode: the next or previous wrapper in reading order, or out of the page. */
function rove(objects: Objects, layer: PageBlockLayer, block: BlockId, back: boolean): boolean {
  const order = layer.blocks().map((other) => other.id);
  const next = order[order.indexOf(block) + (back ? -1 : 1)];
  if (!next) return false;
  objects.select([next], { focus: true, announce: false });
  return true;
}

function arrow(objects: Objects, block: BlockId, event: KeyboardEvent): boolean {
  const step = ARROWS[event.key];
  if (!step) return false;
  if (event.altKey && event.shiftKey) {
    if (step[1] === 0) return false;
    objects.reorderFlow(block, step[1] as -1 | 1);
    return true;
  }
  if (event.altKey || event.metaKey) return false;
  const size = event.ctrlKey ? FINE_NUDGE : NUDGE;
  if (event.shiftKey) {
    if (step[0] === 0) return false;
    objects.widen(step[0] * size);
  } else {
    objects.nudge(step[0] * size, step[1] * size);
  }
  return true;
}

/** Handles a key on a wrapper; returns whether it did anything. */
function wrapperKey(objects: Objects, layer: PageBlockLayer, block: BlockId, event: KeyboardEvent): boolean {
  switch (event.key) {
    case 'Tab':
      return rove(objects, layer, block, event.shiftKey);
    case 'Enter':
      objects.edit(block);
      return true;
    case 'Escape':
      objects.clear();
      layer.view(block)?.element.closest<HTMLElement>('[tabindex="-1"][data-scope="page"]')?.focus();
      return true;
    case ' ': {
      const selected = objects.selected();
      const next = selected.includes(block) ? selected.filter((id) => id !== block) : [...selected, block];
      objects.select(next, { announce: true });
      return true;
    }
    case 'Backspace':
      objects.command('delete');
      return true;
    case 'a':
      if (!event.ctrlKey || event.shiftKey || event.altKey) return false;
      objects.selectBlocks(
        layer.blocks().map((other) => other.id),
        'selectAll',
      );
      return true;
    default:
      return arrow(objects, block, event);
  }
}

/** Listens for object mode's keys on the page's blocks; escape.ts handles Escape from text. Returns a stop function. */
export function installObjectKeys(container: HTMLElement, objects: Objects, layer: PageBlockLayer): () => void {
  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    const block = wrapperBlock(event, layer);
    if (block && wrapperKey(objects, layer, block, event)) event.preventDefault();
  };
  const onFocus = (event: FocusEvent) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const block = target?.dataset.blockId;
    if (block && layer.view(block)?.element === target && !objects.selected().includes(block)) {
      objects.select([block], { announce: true });
    }
  };
  container.addEventListener('keydown', onKey);
  container.addEventListener('focusin', onFocus);
  return () => {
    container.removeEventListener('keydown', onKey);
    container.removeEventListener('focusin', onFocus);
  };
}
