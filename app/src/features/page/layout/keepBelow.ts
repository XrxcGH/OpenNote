// Keep-below (ARCHITECTURE.md section 6.4; owner WP3). When an edit made in this view changes a floating text box's
// height, the floating blocks just below it move with it, so it never grows over them.
// - Followers: floating, non-ink, unlocked blocks whose tops lie 0 to 24 units below the box's old bottom and
//   overlap it horizontally. Followers of followers join, breadth first, each block at most once.
// - Each follower moves by the height change, up or down, keeping its gap, and never above y 0.
// - A ResizeObserver applies the move in the frame the height changes, and the box's next flush carries the
//   moves, so one undo reverts the text and the moves together.
// Heights that change for any other reason (opening the page, fonts, styles, the theme) move nothing.
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { META_REMOTE } from '../../../editor/meta';
import type { BlockId, BlockJson, Edit } from '../../../services/pages/types';
import type { PageBlockLayer } from '../blocks/blockLayer';
import { isFloating } from '../blocks/textBlock';
import { frameValue } from '../objects/arrange';
import type { PagePool } from '../pool/pool';
import type { SyncQueue } from '../sync';

/** A follower's top lies at most this far below the box's old bottom. */
export const FOLLOW_BAND = 24;
/** An edit arms the box for this long: its height change lands in the next layout. */
const ARMED_MS = 1000;

export interface KeepBelow {
  /** Marks a block's next height change as made by an edit in this view. */
  arm(block: BlockId): void;
  stop(): void;
}

interface Span {
  block: BlockJson;
  left: number;
  right: number;
}

function span(layer: PageBlockLayer, block: BlockJson): Span {
  const width = layer.view(block.id)?.element.offsetWidth ?? 0;
  const left = block.frame?.x ?? 0;
  return { block, left, right: left + width };
}

/** The blocks that follow `mover`, breadth first, given its old bottom. */
export function followers(
  layer: PageBlockLayer,
  mover: BlockJson,
  oldBottom: number,
  heights: (id: BlockId) => number,
): BlockJson[] {
  const candidates = layer
    .blocks()
    .filter((block) => isFloating(block) && block.type !== 'ink' && !block.lock && block.id !== mover.id);
  const out: BlockJson[] = [];
  const queue: { span: Span; bottom: number }[] = [{ span: span(layer, mover), bottom: oldBottom }];
  const taken = new Set<BlockId>([mover.id]);
  while (queue.length > 0) {
    const { span: above, bottom } = queue.shift()!;
    for (const block of candidates) {
      if (taken.has(block.id)) continue;
      const below = span(layer, block);
      const gap = (block.frame?.y ?? 0) - bottom;
      if (gap < 0 || gap > FOLLOW_BAND || below.right <= above.left || below.left >= above.right) continue;
      taken.add(block.id);
      out.push(block);
      queue.push({ span: below, bottom: (block.frame?.y ?? 0) + heights(block.id) });
    }
  }
  return out;
}

export function createKeepBelow(layer: PageBlockLayer, sync: SyncQueue, pool: PagePool): KeepBelow {
  const armed = new Map<BlockId, number>();
  const heights = new Map<BlockId, number>();
  const watched = new Map<Element, BlockId>();
  const observer =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries) => {
          for (const entry of entries) {
            const id = watched.get(entry.target);
            if (id) resized(id, (entry.target as HTMLElement).offsetHeight);
          }
        });

  const resized = (id: BlockId, height: number) => {
    const before = heights.get(id);
    heights.set(id, height);
    const at = armed.get(id);
    const block = layer.block(id);
    if (before === undefined || before === height || at === undefined || !block) return;
    if (performance.now() - at > ARMED_MS) return void armed.delete(id);
    const delta = height - before;
    const oldBottom = (block.frame?.y ?? 0) + before;
    const heightOf = (other: BlockId) => heights.get(other) ?? layer.view(other)?.element.offsetHeight ?? 0;
    const moved = followers(layer, block, oldBottom, heightOf);
    const edits: Edit[] = [];
    for (const follower of moved) {
      const frame = { ...follower.frame, y: frameValue((follower.frame?.y ?? 0) + delta) };
      layer.upsert({ ...follower, frame });
      edits.push({ edit: 'moveBlock', block: follower.id, frame });
    }
    if (edits.length > 0) sync.addFollowerMoves(id, edits);
  };

  /** Watches every floating text box, and only those. */
  const watch = () => {
    if (!observer) return;
    const now = new Set<Element>();
    for (const block of layer.blocks()) {
      const element = layer.view(block.id)?.element;
      if (!element || block.type !== 'text' || !isFloating(block)) continue;
      now.add(element);
      if (watched.has(element)) continue;
      watched.set(element, block.id);
      observer.observe(element);
    }
    for (const element of [...watched.keys()]) {
      if (now.has(element)) continue;
      observer.unobserve(element);
      heights.delete(watched.get(element)!);
      watched.delete(element);
    }
  };

  let editor: Editor | null = null;
  const onTransaction = ({ transaction }: { transaction: Transaction }) => {
    const block = editor?.view.dom.getAttribute('data-block');
    if (block && transaction.docChanged && !transaction.getMeta(META_REMOTE)) armed.set(block, performance.now());
  };
  const follow = () => {
    editor?.off('transaction', onTransaction);
    editor = pool.active()?.editor ?? null;
    editor?.on('transaction', onTransaction);
  };
  const stopActive = pool.onActiveChange(follow);
  const stopLayer = layer.onChange(watch);
  watch();
  follow();
  return {
    arm: (block) => void armed.set(block, performance.now()),
    stop() {
      stopActive();
      stopLayer();
      editor?.off('transaction', onTransaction);
      observer?.disconnect();
    },
  };
}
