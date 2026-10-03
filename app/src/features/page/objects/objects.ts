// Blocks as objects (ARCHITECTURE.md section 11; owner WP3). The page is in one of three states: text (focus in an
// editor or the title), objects (focus on the first selected block's wrapper), or none (focus on the page region).
// Escape from text selects the block; in object mode Tab and Shift+Tab move between wrappers in reading order,
// Enter or F2 goes back into the text, and Escape leaves to the page. Arrows move a floating block 8 units, and
// Ctrl+Arrows 1. Shift+Arrows change a text box's width the same way, and Alt+Shift+Up and Down reorder the flow.
import type { BlockId, BlockJson, Edit, EditBatch, Frame, OpenPage } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import type { PageBlockLayer } from '../blocks/blockLayer';
import { isFloating } from '../blocks/textBlock';
import type { PagePool } from '../pool/pool';
import { readingLock } from '../qol/stores';
import { pageSelection, selectOnPage } from '../seams/selectionStore';
import type { SyncQueue } from '../sync';
import type { ObjectCommandId } from '../viewport/shown';
import type { PageViewport } from '../viewport/viewport';
import { arrangeTarget, canArrange, frameValue } from './arrange';
import type { ArrangeKind } from './arrange';

export type ObjectCommand = ObjectCommandId;

/** Arrow keys move this far, and this far with Ctrl. */
export const NUDGE = 8;
export const FINE_NUDGE = 1;
/** Nudges closer together than this undo as one step. */
const NUDGE_RUN_MS = 1000;
/** A text box is never narrower than this. */
export const MIN_TEXT_WIDTH = 120;

export interface ObjectParts {
  readonly page: OpenPage;
  readonly sync: SyncQueue;
  readonly layer: PageBlockLayer;
  readonly pool: PagePool;
  readonly viewport: PageViewport;
  /** Opens the object menu for the selection at `anchor`. */
  openMenu(anchor: HTMLElement | { x: number; y: number }): void;
  /** Opens "Size and position" for a block. */
  openSizeAndPosition(block: BlockId): void;
  /** A text box's width is changing: its height change moves the blocks below it (keep-below). */
  widthChanging?(block: BlockId): void;
}

let gestures = 0;

export class Objects {
  private run: { kind: 'drag' | 'resize'; target: string; at: number } | null = null;
  private readonly stopSelection: () => void;

  constructor(private readonly parts: ObjectParts) {
    this.stopSelection = pageSelection.subscribe(() => this.paint());
  }

  selected(): BlockId[] {
    return pageSelection.get().blocks.filter((id) => this.parts.layer.block(id));
  }

  /** Selects blocks as objects and, with `focus`, moves focus to the first one's wrapper. */
  select(blocks: readonly BlockId[], options: { focus?: boolean; announce?: boolean } = {}): void {
    selectOnPage({ blocks: [...blocks], strokes: [] }, { announce: options.announce ?? false });
    const first = blocks[0] ? this.parts.layer.view(blocks[0])?.element : null;
    if (options.focus && first) first.focus({ preventScroll: true });
  }

  /** The editor host's selectBlocks: Escape from text, a second Ctrl+A, or Shift+Arrow past a block's edge. */
  selectBlocks(blocks: readonly BlockId[], reason: 'escalate' | 'selectAll' | 'escape'): void {
    this.select(blocks, { focus: true, announce: reason !== 'selectAll' });
    if (reason === 'selectAll') announce(t('page.selection.allBlocks'));
  }

  clear(): void {
    if (pageSelection.get().blocks.length > 0) selectOnPage({ blocks: [], strokes: pageSelection.get().strokes });
  }

  enabled(command: ObjectCommand): boolean {
    const blocks = this.selected();
    const first = blocks[0] ? this.parts.layer.block(blocks[0]) : null;
    if (!first || this.parts.page.readOnly || readingLock.get()) return command === 'edit' && first !== null;
    switch (command) {
      case 'bringToFront':
      case 'sendToBack':
      case 'bringForward':
      case 'sendBackward':
        return blocks.length === 1 && canArrange(command, first.id, this.parts.layer.blocks());
      case 'edit':
        return this.parts.layer.view(first.id)?.editRoot !== null;
      case 'unlock':
        return blocks.some((id) => this.parts.layer.block(id)?.lock);
      case 'lock':
      case 'lockPosition':
        return blocks.some((id) => this.parts.layer.block(id)?.lock === undefined);
      case 'float':
        return blocks.some((id) => !isFloating(this.parts.layer.block(id)!));
      case 'putInFlow':
        return blocks.some((id) => isFloating(this.parts.layer.block(id)!));
      case 'sizeAndPosition':
        return blocks.length === 1;
      default:
        return true;
    }
  }

  command(command: ObjectCommand): void {
    const blocks = this.selected();
    if (blocks.length === 0) return announce(t('page.object.nothingSelected'));
    if (command === 'edit') return this.edit(blocks[0]!);
    if (readingLock.get()) return announce(t('pageExtras.lock.blocked'));
    if (command === 'delete') return this.remove(blocks);
    if (command === 'sizeAndPosition') return this.parts.openSizeAndPosition(blocks[0]!);
    if (command === 'lock' || command === 'lockPosition' || command === 'unlock') return this.lock(blocks, command);
    if (command === 'float' || command === 'putInFlow') return this.place(blocks, command);
    this.arrange(blocks[0]!, command);
  }

  /** Moves focus into a block's text, which mounts its editor. */
  edit(block: BlockId): void {
    this.clear();
    this.parts.pool.mount(block, { kind: 'remembered' }, 'target');
  }

  /** Whether a block refuses to move, saying so. */
  locked(block: BlockJson): boolean {
    if (!block.lock) return false;
    announce(t('page.object.locked'));
    return true;
  }

  /** Arrow nudges: one moveBlock per key, sharing a gesture while keys come less than a second apart. */
  nudge(dx: number, dy: number): void {
    const blocks = this.movable();
    if (blocks.length === 0) return;
    const frames = new Map(blocks.map((block) => [block.id, this.offset(block, dx, dy)]));
    this.commitFrames(frames, this.gesture('drag'));
  }

  /** Shift+Arrows: a text box's width, never below 120 units. */
  widen(dw: number): void {
    const frames = new Map<BlockId, Frame>();
    for (const block of this.movable()) {
      if (block.type !== 'text' || !isFloating(block)) continue;
      const width = block.frame?.w ?? this.parts.layer.view(block.id)?.measure().w ?? MIN_TEXT_WIDTH;
      frames.set(block.id, { ...block.frame, w: frameValue(width + dw, MIN_TEXT_WIDTH) });
    }
    if (frames.size > 0) this.commitFrames(frames, this.gesture('resize'));
  }

  /** Alt+Shift+Up and Down: a flowing block steps past its flowing neighbor. */
  reorderFlow(block: BlockId, by: -1 | 1): void {
    const flowing = this.parts.layer.blocks().filter((other) => !isFloating(other));
    const at = flowing.findIndex((other) => other.id === block);
    const neighbor = flowing[at + by];
    if (at < 0 || !neighbor || this.locked(flowing[at]!)) return;
    const edit: Edit = { edit: 'moveBlock', block, ...(by > 0 ? { after: neighbor.id } : { before: neighbor.id }) };
    this.send({ edits: [edit] });
    announce(t('page.object.moved'));
  }

  /** Sends frames for blocks the pointer or the keyboard moved or resized, and shows them at once. */
  commitFrames(frames: ReadonlyMap<BlockId, Frame>, coalesce?: EditBatch['coalesce']): void {
    const edits: Edit[] = [];
    for (const [id, frame] of frames) {
      const block = this.parts.layer.block(id);
      if (!block) continue;
      if (frame.w !== block.frame?.w) this.widthChanging(id);
      this.parts.layer.upsert({ ...block, frame });
      edits.push({ edit: 'moveBlock', block: id, frame });
    }
    if (edits.length > 0) this.send({ edits, ...(coalesce ? { coalesce } : {}) });
  }

  /** Sends a batch and gives the blocks the order keys the core chose. */
  send(batch: EditBatch): void {
    void this.parts.sync
      .send(batch)
      .then((ack) => {
        for (const [id, order] of Object.entries(ack.orderKeys)) {
          const block = this.parts.layer.block(id);
          if (block && block.order !== order) this.parts.layer.upsert({ ...block, order });
        }
      })
      .catch(() => undefined);
  }

  widthChanging(block: BlockId): void {
    this.parts.widthChanging?.(block);
  }

  destroy(): void {
    this.stopSelection();
  }

  /** The selected blocks that may move, announcing a lock once. */
  private movable(): BlockJson[] {
    const blocks = this.selected().flatMap((id) => this.parts.layer.block(id) ?? []);
    const free = blocks.filter((block) => !block.lock && isFloating(block));
    if (free.length < blocks.filter(isFloating).length) announce(t('page.object.locked'));
    return free;
  }

  private offset(block: BlockJson, dx: number, dy: number): Frame {
    return { ...block.frame, x: frameValue((block.frame?.x ?? 0) + dx), y: frameValue((block.frame?.y ?? 0) + dy) };
  }

  /** The gesture a key belongs to: the same one while keys come less than a second apart. Announces new runs. */
  private gesture(kind: 'drag' | 'resize'): EditBatch['coalesce'] {
    const now = performance.now();
    if (!this.run || this.run.kind !== kind || now - this.run.at > NUDGE_RUN_MS) {
      this.run = { kind, target: `keys-${(gestures += 1)}`, at: now };
      announce(kind === 'drag' ? t('page.object.moved') : t('page.object.resized', { width: this.widthOfFirst() }));
    }
    this.run.at = now;
    return { kind, target: this.run.target };
  }

  private widthOfFirst(): number {
    const first = this.selected()[0];
    return Math.round(first ? (this.parts.layer.block(first)?.frame?.w ?? 0) : 0);
  }

  private arrange(block: BlockId, kind: ArrangeKind): void {
    const target = arrangeTarget(kind, block, this.parts.layer.blocks(), (id) => {
      return this.parts.layer.view(id)?.measure() ?? null;
    });
    if (!target) return announce(t(kind === 'bringToFront' ? 'page.object.alreadyFront' : 'page.object.alreadyBack'));
    this.send({ edits: [{ edit: 'moveBlock', block, ...target }] });
    announce(t(`page.object.${kind}`));
  }

  private lock(blocks: BlockId[], command: 'lock' | 'lockPosition' | 'unlock'): void {
    const lock = command === 'lock' ? 'all' : command === 'lockPosition' ? 'position' : null;
    const edits: Edit[] = blocks.map((block) => ({ edit: 'patchBlock', block, lock }));
    for (const id of blocks) {
      const block = this.parts.layer.block(id);
      if (!block) continue;
      const { lock: _old, ...rest } = block;
      this.parts.layer.upsert(lock ? { ...rest, lock } : rest);
    }
    this.send({ edits });
    const said = { lock: 'page.object.lockedNow', lockPosition: 'page.object.lockedPositionNow' } as const;
    announce(t(command === 'unlock' ? 'page.object.unlockedNow' : said[command]));
  }

  /** Float gives a flowing block a frame where it is; Put in flow places it after the flowing block above it. */
  private place(blocks: BlockId[], command: 'float' | 'putInFlow'): void {
    const edits: Edit[] = [];
    for (const id of blocks) {
      const block = this.parts.layer.block(id);
      const rect = this.parts.layer.view(id)?.measure();
      if (!block || !rect || this.locked(block) || isFloating(block) === (command === 'float')) continue;
      if (command === 'float') {
        const frame = { ...block.frame, x: frameValue(rect.x), y: frameValue(rect.y) };
        this.parts.layer.upsert({ ...block, frame });
        edits.push({ edit: 'moveBlock', block: id, frame });
        continue;
      }
      const above = this.parts.layer
        .blocks()
        .filter((other) => !isFloating(other) && (this.parts.layer.view(other.id)?.measure().y ?? 0) <= rect.y)
        .at(-1);
      const frame = block.frame?.w === undefined ? {} : { w: block.frame.w };
      const { frame: _old, ...rest } = block;
      this.parts.layer.upsert(frame.w === undefined ? rest : { ...rest, frame });
      edits.push({ edit: 'moveBlock', block: id, frame, ...(above ? { after: above.id } : {}) });
    }
    if (edits.length > 0) this.send({ edits });
  }

  private remove(blocks: BlockId[]): void {
    const order = this.parts.layer.blocks().map((block) => block.id);
    const next = order.slice(order.indexOf(blocks.at(-1)!) + 1).find((id) => !blocks.includes(id));
    this.clear();
    void this.parts.sync.send({ edits: [{ edit: 'deleteBlocks', blocks }] }).catch(() => undefined);
    blocks.forEach((id) => this.parts.layer.remove(id));
    const after = next ? this.parts.layer.view(next)?.element : null;
    if (after) this.select([next!], { focus: true });
    else this.parts.viewport.viewport.focus({ preventScroll: true });
    const message = t('page.object.deleted', { count: blocks.length });
    showToast({
      message,
      action: { label: t('page.object.undo'), run: () => this.parts.sync.undo() },
    });
  }

  /** Marks the selected wrappers, and makes the first one the page's Tab stop. */
  private paint(): void {
    const selected = new Set(this.selected());
    const first = this.selected()[0];
    for (const block of this.parts.layer.blocks()) {
      const view = this.parts.layer.view(block.id);
      if (!view) continue;
      view.element.toggleAttribute('data-selected', selected.has(block.id));
      // Blocks without text, such as images, keep their own Tab stop.
      if (view.editRoot) view.element.tabIndex = block.id === first ? 0 : -1;
    }
  }
}
