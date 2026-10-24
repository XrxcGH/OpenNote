// The chrome layer (ARCHITECTURE.md section 11.2; owner WP3): grips, handles, outlines, the marquee, the drop
// indicator, and the count badge, drawn in screen space above the world. It is a sibling of the viewport, so it
// never scales or clips with the page. It reads block rectangles once per animation frame, and only while
// something is selected, hovered, edited, or moving. Pointer events reach only the handles.
import type { BlockId, BlockJson } from '../../../services/pages/types';
import { getDensity } from '../../../state/layout';
import { t } from '../../../strings/t';
import type { PageBlockLayer } from '../blocks/blockLayer';
import { hasGrip, isFloating, liveBlock } from '../blocks/textBlock';
import type { PagePool } from '../pool/pool';
import { pageSelection } from '../seams/selectionStore';
import type { PageViewport } from '../viewport/viewport';
import styles from './chrome.module.css';

export interface ChromeParts {
  readonly container: HTMLElement;
  readonly viewport: PageViewport;
  readonly layer: PageBlockLayer;
  readonly pool: PagePool;
}

export interface Chrome {
  readonly element: HTMLElement;
  /** A client rectangle to draw as the marquee, or null. */
  setMarquee(rect: DOMRectReadOnly | null): void;
  /** A client y to draw the flow's insertion line at, or null. */
  setDropLine(y: number | null): void;
  /** Redraw in the next frame. */
  update(): void;
  destroy(): void;
}

/** Handles' hit areas at mouse and touch density (BRAND.md section 6). */
const MOUSE_HIT = 32;
const TOUCH_HIT = 44;
/** The least a grip shows when other blocks crowd the strip above its box. */
const GRIP_MIN = 8;
/** How far a text box's ring stands out from each side, beyond its outline offset. */
const RING_SIDE = 4;

function div(parent: HTMLElement, className: string): HTMLElement {
  const element = parent.ownerDocument.createElement('div');
  element.className = className;
  parent.append(element);
  return element;
}

function name(block: BlockJson): string {
  const markdown = typeof block.data.markdown === 'string' ? block.data.markdown : '';
  return (
    markdown
      .split('\n')[0]!
      .replace(/[#>*_`[\]-]/g, '')
      .trim()
      .slice(0, 40) || t('page.block.text')
  );
}

class ChromeLayer implements Chrome {
  readonly element: HTMLElement;
  private readonly marquee: HTMLElement;
  private readonly dropLine: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly marks = new Map<string, HTMLElement>();
  private hovered: BlockId | null = null;
  private frame = 0;
  /** The block elements with chrome, watched so a box that grows or shrinks (typing, a pasted block) is redrawn. */
  private readonly watched = new Set<Element>();
  private readonly sizes: ResizeObserver | null;
  private readonly stops: (() => void)[] = [];

  constructor(private readonly parts: ChromeParts) {
    this.element = div(parts.container, styles.chrome);
    this.element.setAttribute('aria-hidden', 'true');
    this.marquee = div(this.element, styles.marquee);
    this.dropLine = div(this.element, styles.dropLine);
    this.badge = div(this.element, styles.badge);
    this.marquee.hidden = this.dropLine.hidden = this.badge.hidden = true;
    this.sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.update()) : null;
    const world = parts.viewport.world;
    world.addEventListener('pointerover', this.onOver);
    world.addEventListener('pointerleave', this.onLeave);
    this.stops.push(
      () => world.removeEventListener('pointerover', this.onOver),
      () => world.removeEventListener('pointerleave', this.onLeave),
      pageSelection.subscribe(() => this.update()),
      parts.pool.onActiveChange(() => this.update()),
      parts.viewport.onCamera(() => this.update()),
      parts.layer.onChange(() => this.update()),
    );
  }

  setMarquee(rect: DOMRectReadOnly | null): void {
    this.marquee.hidden = rect === null;
    if (!rect) return;
    const origin = this.element.getBoundingClientRect();
    this.place(this.marquee, new DOMRect(rect.x - origin.left, rect.y - origin.top, rect.width, rect.height));
  }

  setDropLine(y: number | null): void {
    this.dropLine.hidden = y === null;
    if (y === null) return;
    const flow = this.parts.layer.blocks().find((block) => !isFloating(block));
    const box = flow ? this.parts.layer.view(flow.id)?.element.getBoundingClientRect() : null;
    const origin = this.element.getBoundingClientRect();
    this.dropLine.style.transform = `translate(${(box?.left ?? origin.left) - origin.left}px, ${y - origin.top}px)`;
    this.dropLine.style.inlineSize = `${box?.width ?? 200}px`;
  }

  update(): void {
    this.frame ||= requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.sizes?.disconnect();
    this.stops.forEach((stop) => stop());
    this.element.remove();
  }

  /** The blocks with chrome: the selection, the hovered block, and the block being edited. */
  private shown(): { block: BlockJson; selected: boolean; editing: boolean }[] {
    const selected = new Set(pageSelection.get().blocks);
    const editing = this.parts.pool.active()?.block ?? null;
    const ids = new Set([...selected, ...(this.hovered ? [this.hovered] : []), ...(editing ? [editing] : [])]);
    return [...ids].flatMap((id) => {
      const block = this.parts.layer.block(id);
      return block ? [{ block, selected: selected.has(id), editing: id === editing }] : [];
    });
  }

  private draw(): void {
    this.element.dataset.density = getDensity();
    const used = new Set<string>();
    const origin = this.element.getBoundingClientRect();
    const seen = new Set<Element>();
    for (const { block, selected, editing } of this.shown()) {
      const element = this.parts.layer.view(block.id)?.element;
      if (!element) continue;
      seen.add(element);
      if (this.sizes && !this.watched.has(element)) {
        this.watched.add(element);
        this.sizes.observe(element);
      }
      const rect = element.getBoundingClientRect();
      const box = new DOMRect(rect.left - origin.left, rect.top - origin.top, rect.width, rect.height);
      // A text box's ring stands a little out from its sides too, so the first letter never touches the line.
      const ring =
        block.type === 'text' ? new DOMRect(box.x - RING_SIDE, box.y, box.width + 2 * RING_SIDE, box.height) : box;
      this.mark(used, `outline:${block.id}`, styles.outline!, ring).classList.toggle(styles.selected!, selected);
      if (!hasGrip(block)) continue;
      if (block.lock) {
        this.mark(used, `lock:${block.id}`, styles.lock!, box);
        continue;
      }
      this.handle(used, block, 'grip', box, origin);
      if ((selected || editing) && isFloating(block)) this.handle(used, block, 'width', box, origin);
    }
    for (const element of this.watched) {
      if (seen.has(element)) continue;
      this.watched.delete(element);
      this.sizes?.unobserve(element);
    }
    for (const [key, element] of this.marks) {
      if (used.has(key)) continue;
      element.remove();
      this.marks.delete(key);
    }
    const count = pageSelection.get().blocks.length;
    this.badge.hidden = count < 2;
    this.badge.textContent = t('page.selection.badge', { count });
  }

  /** A grip bar along the top of a text box, or a width handle on its right edge, with a full-size hit area. */
  private handle(used: Set<string>, block: BlockJson, kind: 'grip' | 'width', box: DOMRect, origin: DOMRect): void {
    const hit = getDensity() === 'touch' ? TOUCH_HIT : MOUSE_HIT;
    const area =
      kind === 'grip'
        ? this.gripArea(block, box, origin, hit)
        : new DOMRect(box.right - hit / 2, box.y, hit, Math.max(box.height, hit));
    const element = this.mark(used, `${kind}:${block.id}`, kind === 'grip' ? styles.grip! : styles.width!, area);
    element.dataset.handle = kind;
    element.dataset.block = block.id;
    element.style.clipPath = kind === 'grip' ? this.gripHoles(block, area, origin) : '';
    element.title = t(kind === 'grip' ? 'page.object.grip' : 'page.object.widthHandle', {
      name: name(liveBlock(this.parts.layer, block)),
    });
  }

  /**
   * The grip's hit area lies above its box. Where a floating panel or picture sits wholly in that strip (a study tape just
   * above a text box), the grip stops short of it, so that block can still be pressed; it never gets thinner than a bar.
   */
  private gripArea(block: BlockJson, box: DOMRect, origin: DOMRect, hit: number): DOMRect {
    const width = Math.max(box.width, hit);
    let top = box.y - hit;
    for (const other of this.parts.layer.blocks()) {
      if (other.id === block.id || other.type === 'text' || !isFloating(other)) continue;
      const rect = this.parts.layer.view(other.id)?.element.getBoundingClientRect();
      if (!rect) continue;
      const bottom = rect.bottom - origin.top;
      const across = rect.left - origin.left < box.x + width && rect.right - origin.left > box.x;
      if (across && bottom <= box.y + 1 && bottom > top) top = Math.min(bottom, box.y - GRIP_MIN);
    }
    return new DOMRect(box.x, top, width, box.y - top);
  }

  /**
   * A floating panel or picture that reaches into the grip's strip (a study tape laid over the top of a text box) must
   * still take its presses, so the grip is cut around it: its center is never under the grip.
   */
  private gripHoles(block: BlockJson, area: DOMRect, origin: DOMRect): string {
    const holes: string[] = [];
    for (const other of this.parts.layer.blocks()) {
      if (other.id === block.id || other.type === 'text' || !isFloating(other)) continue;
      const rect = this.parts.layer.view(other.id)?.element.getBoundingClientRect();
      if (!rect) continue;
      const left = Math.max(rect.left - origin.left - area.x, 0);
      const right = Math.min(rect.right - origin.left - area.x, area.width);
      const top = Math.max(rect.top - origin.top - area.y, 0);
      const bottom = Math.min(rect.bottom - origin.top - area.y, area.height);
      if (right <= left || bottom <= top) continue;
      holes.push(
        `${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px, ${left}px ${top}px, 0 0`,
      );
    }
    if (holes.length === 0) return '';
    const outer = `0 0, ${area.width}px 0, ${area.width}px ${area.height}px, 0 ${area.height}px, 0 0`;
    return `polygon(evenodd, ${outer}, ${holes.join(', ')})`;
  }

  private mark(used: Set<string>, key: string, className: string, box: DOMRect): HTMLElement {
    used.add(key);
    let element = this.marks.get(key);
    if (!element) {
      element = div(this.element, className);
      this.marks.set(key, element);
    }
    this.place(element, box);
    return element;
  }

  private place(element: HTMLElement, box: DOMRectReadOnly): void {
    element.style.transform = `translate(${box.x}px, ${box.y}px)`;
    element.style.inlineSize = `${box.width}px`;
    element.style.blockSize = `${box.height}px`;
  }

  private readonly onOver = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    const target = event.target instanceof Element ? event.target : null;
    const hovered = target?.closest<HTMLElement>('[data-block-id]')?.dataset.blockId ?? null;
    if (hovered === this.hovered) return;
    this.hovered = hovered;
    this.update();
  };

  private readonly onLeave = () => {
    this.hovered = null;
    this.update();
  };
}

export function createChrome(parts: ChromeParts): Chrome {
  return new ChromeLayer(parts);
}
