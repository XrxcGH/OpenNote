// The router's `objects` tool (ARCHITECTURE.md sections 5.6, 11.4, and 11.5; owner WP3), at priority 30.
// - A grip drag moves the selected blocks: a transform while it moves, one batch of moveBlock when it ends.
// - A flowing block's grip drag reorders the flow, with an insertion line.
// - A width handle drag changes a text box's width live, and stores w when it ends.
// - A mouse or pen drag on empty page draws a marquee that selects the blocks it touches.
// Mouse and pen start after 4 px, touch after 8 px. A press on a grip that doesn't move selects the block, and
// Escape cancels a drag.
import type { BlockId, BlockJson, Frame } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import type { PageBlockLayer } from '../blocks/blockLayer';
import { isFloating } from '../blocks/textBlock';
import { readingLock } from '../qol/stores';
import type { Chrome } from '../chrome/chrome';
import type { Point } from '../viewport/camera';
import type { PointerToolDef, RouterContext } from '../viewport/router';
import type { PageViewport } from '../viewport/viewport';
import { frameValue } from './arrange';
import { MIN_TEXT_WIDTH } from './objects';
import type { Objects } from './objects';

export interface ObjectsToolParts {
  readonly objects: Objects;
  readonly layer: PageBlockLayer;
  readonly viewport: PageViewport;
  readonly chrome: Chrome;
}

type Kind = 'move' | 'width' | 'marquee';

interface Press {
  kind: Kind;
  start: Point;
  block: BlockId | null;
  shift: boolean;
  slop: number;
  started: boolean;
  blocks: BlockJson[];
  last: Point;
}

let gestures = 0;

const client = (event: PointerEvent): Point => ({ x: event.clientX, y: event.clientY });

function handleOf(event: PointerEvent): HTMLElement | null {
  return event.target instanceof Element ? event.target.closest<HTMLElement>('[data-handle]') : null;
}

function emptyPage(event: PointerEvent, world: HTMLElement): boolean {
  const target = event.target instanceof Element ? event.target : null;
  return !!target && world.contains(target) && !target.closest('[data-block-id], [data-page-title], button, a');
}

function intersects(a: DOMRectReadOnly, b: DOMRectReadOnly): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

class ObjectsTool implements PointerToolDef {
  readonly id = 'objects';
  readonly priority = 30;
  private press: Press | null = null;

  constructor(private readonly parts: ObjectsToolParts) {}

  accepts(event: PointerEvent, ctx: RouterContext): boolean {
    if (ctx.activeTool !== 'select' || event.button !== 0 || readingLock.get()) return false;
    if (handleOf(event)) return true;
    return event.pointerType !== 'touch' && emptyPage(event, this.parts.viewport.world);
  }

  down(event: PointerEvent, ctx: RouterContext): 'claim' | 'watch' {
    const handle = handleOf(event);
    const kind: Kind = handle ? (handle.dataset.handle === 'width' ? 'width' : 'move') : 'marquee';
    const slop = event.pointerType === 'touch' ? 8 : 4;
    const block = handle?.dataset.block ?? null;
    this.press = {
      kind,
      start: client(event),
      block,
      shift: event.shiftKey,
      slop,
      started: false,
      blocks: [],
      last: client(event),
    };
    if (!handle || event.pointerType === 'touch') return 'watch';
    ctx.capture(event.pointerId);
    return 'claim';
  }

  move(events: readonly PointerEvent[], ctx: RouterContext): 'claim' | 'watch' | 'release' {
    const press = this.press;
    const last = events.at(-1);
    if (!press || !last) return 'release';
    press.last = client(last);
    if (!press.started) {
      if (Math.hypot(press.last.x - press.start.x, press.last.y - press.start.y) < press.slop) return 'watch';
      if (!this.begin(press)) return 'release';
      ctx.capture(last.pointerId);
      addEventListener('keydown', this.onKey, true);
    }
    this.follow(press, ctx);
    return 'claim';
  }

  up(_event: PointerEvent, ctx: RouterContext): void {
    const press = this.press;
    this.end();
    if (!press) return;
    if (!press.started) {
      if (press.block) this.selectFromGrip(press);
      return;
    }
    const zoom = ctx.camera.zoom;
    const delta = { x: (press.last.x - press.start.x) / zoom, y: (press.last.y - press.start.y) / zoom };
    if (press.kind === 'marquee') return this.finishMarquee(press);
    if (press.kind === 'width') return this.finishWidth(press, delta.x);
    this.finishMove(press, delta);
  }

  cancel(): void {
    const press = this.press;
    this.end();
    if (press?.started) this.restore(press);
  }

  private selectFromGrip(press: Press): void {
    const selected = this.parts.objects.selected();
    const next = press.shift ? [...new Set([...selected, press.block!])] : [press.block!];
    this.parts.objects.select(next, { focus: true, announce: true });
  }

  /** Starts a drag; false when a lock refuses it. */
  private begin(press: Press): boolean {
    press.started = true;
    if (press.kind === 'marquee') return true;
    const block = this.parts.layer.block(press.block!);
    if (!block || this.parts.objects.locked(block)) return false;
    const selected = this.parts.objects.selected();
    if (!selected.includes(block.id)) this.parts.objects.select([block.id]);
    const ids = press.kind === 'move' && isFloating(block) ? this.parts.objects.selected() : [block.id];
    press.blocks = ids.flatMap((id) => {
      const found = this.parts.layer.block(id);
      return found && !found.lock && isFloating(found) === isFloating(block) ? [found] : [];
    });
    for (const { id } of press.blocks) this.parts.layer.view(id)?.element.setAttribute('data-dragging', '');
    return true;
  }

  private follow(press: Press, ctx: RouterContext): void {
    const zoom = ctx.camera.zoom;
    const dx = (press.last.x - press.start.x) / zoom;
    const dy = (press.last.y - press.start.y) / zoom;
    if (press.kind === 'marquee') {
      const { start, last } = press;
      const rect = new DOMRect(
        Math.min(start.x, last.x),
        Math.min(start.y, last.y),
        Math.abs(last.x - start.x),
        Math.abs(last.y - start.y),
      );
      return this.parts.chrome.setMarquee(rect);
    }
    if (press.kind === 'width') {
      const block = press.blocks[0];
      const element = block && this.parts.layer.view(block.id)?.element;
      if (!block || !element) return;
      const width = block.frame?.w ?? this.parts.layer.view(block.id)!.measure().w;
      this.parts.objects.widthChanging(block.id);
      element.style.inlineSize = `${Math.max(MIN_TEXT_WIDTH, width + dx)}px`;
      return this.parts.chrome.update();
    }
    const floating = press.blocks.some(isFloating);
    for (const block of press.blocks) {
      const element = this.parts.layer.view(block.id)?.element;
      // A text box on ruled paper moves from rule to rule while it is dragged.
      const down = floating ? this.parts.objects.snapDelta(block, dy) : dy;
      if (element) element.style.transform = floating ? `translate(${dx}px, ${down}px)` : `translateY(${dy}px)`;
    }
    if (!floating) this.parts.chrome.setDropLine(this.dropTarget(press)?.y ?? null);
    this.parts.chrome.update();
  }

  /** Where a dragged flowing block lands: between the flowing blocks, by the pointer's height. */
  private dropTarget(press: Press): { y: number; after?: BlockId; before?: BlockId } | null {
    const moving = press.blocks[0];
    const flowing = this.parts.layer.blocks().filter((block) => !isFloating(block) && block.id !== moving?.id);
    for (const block of flowing) {
      const rect = this.parts.layer.view(block.id)?.element.getBoundingClientRect();
      if (rect && press.last.y < rect.top + rect.height / 2) return { y: rect.top - 2, before: block.id };
    }
    const tail = flowing.at(-1);
    const rect = tail ? this.parts.layer.view(tail.id)?.element.getBoundingClientRect() : null;
    return tail && rect ? { y: rect.bottom + 2, after: tail.id } : null;
  }

  private finishMove(press: Press, delta: Point): void {
    const target = press.blocks.some(isFloating) ? null : this.dropTarget(press);
    this.restore(press);
    const coalesce = { kind: 'drag' as const, target: `drag-${(gestures += 1)}` };
    if (target && press.blocks[0]) {
      const { after, before } = target;
      this.parts.objects.send({ edits: [{ edit: 'moveBlock', block: press.blocks[0].id, after, before }], coalesce });
      return announce(t('page.object.moved'));
    }
    const frames = new Map<BlockId, Frame>();
    for (const block of press.blocks) {
      const x = frameValue((block.frame?.x ?? 0) + delta.x);
      frames.set(block.id, { ...block.frame, x, y: frameValue((block.frame?.y ?? 0) + delta.y) });
    }
    this.parts.objects.commitFrames(frames, coalesce);
    announce(t('page.object.moved'));
  }

  private finishWidth(press: Press, dx: number): void {
    const block = press.blocks[0];
    if (!block) return;
    const width = block.frame?.w ?? this.parts.layer.view(block.id)?.measure().w ?? MIN_TEXT_WIDTH;
    this.restore(press);
    const w = frameValue(width + dx, MIN_TEXT_WIDTH);
    this.parts.objects.commitFrames(new Map([[block.id, { ...block.frame, w }]]), {
      kind: 'resize',
      target: `resize-${(gestures += 1)}`,
    });
    announce(t('page.object.resized', { width: Math.round(w) }));
  }

  private finishMarquee(press: Press): void {
    const { start, last } = press;
    this.parts.chrome.setMarquee(null);
    const area = new DOMRect(
      Math.min(start.x, last.x),
      Math.min(start.y, last.y),
      Math.abs(last.x - start.x),
      Math.abs(last.y - start.y),
    );
    const hit = this.parts.layer.blocks().filter((block) => {
      const element = this.parts.layer.view(block.id)?.element;
      return element ? intersects(area, element.getBoundingClientRect()) : false;
    });
    this.parts.objects.select(
      hit.map((block) => block.id),
      { focus: hit.length > 0, announce: true },
    );
  }

  /** Clears a drag's live transforms and widths; the layer then shows the committed frames. */
  private restore(press: Press): void {
    this.parts.chrome.setMarquee(null);
    this.parts.chrome.setDropLine(null);
    for (const block of press.blocks) {
      const element = this.parts.layer.view(block.id)?.element;
      if (!element) continue;
      element.style.transform = '';
      element.removeAttribute('data-dragging');
      this.parts.layer.view(block.id)?.update(block);
    }
  }

  private end(): void {
    this.press = null;
    removeEventListener('keydown', this.onKey, true);
  }

  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !this.press) return;
    event.preventDefault();
    event.stopPropagation();
    this.cancel();
  };
}

export function createObjectsTool(parts: ObjectsToolParts): PointerToolDef {
  return new ObjectsTool(parts);
}
