// Measures the page region and writes the desk gutter on it: --desk-gutter and data-desk-gutter on main (the rule is
// deskGutter.ts). The zoom is read only when the camera settles, never during a Ctrl+wheel zoom or a pinch, so the page's
// left edge never jumps under the pointer. Input in the strips, main's own box beside the page, goes to the page.

import { useCallback, useRef } from 'react';
import type { RefCallback } from 'react';
import { layoutStore } from '../../state/layout';
import { shownViewport } from '../../features/page';
import type { PageViewportApi } from '../../features/page';
import { DEFAULT_COLUMN, nextGutter } from './deskGutter';

/** A pane beside the page that is showing; the Sheets strip carries the attribute too, and is hidden when unused. */
const PAGE_PANE = '[data-page-pane]:not([hidden])';
const LINE_PX = 16;
const MOTIF_GUTTER = 24;

/** The flow column's width in page units: the page's own content width, or 72ch of the reading font. */
function columnOf(probe: HTMLElement, viewport: PageViewportApi): number {
  const flow = viewport.world.querySelector<HTMLElement>(':scope > [data-layout]');
  const own = Number.parseFloat(flow?.style.getPropertyValue('--flow-width') ?? '');
  if (own > 0) return own;
  const measured = probe.getBoundingClientRect().width;
  return measured > 0 ? measured : DEFAULT_COLUMN;
}

/** Starts the gutter on `main`; returns the function that stops it. */
export function startDeskGutter(main: HTMLElement): () => void {
  const doc = main.ownerDocument;
  const root = doc.documentElement;
  const view = doc.defaultView ?? window;
  const forced = view.matchMedia?.('(forced-colors: active)') ?? null;
  // 72ch of the reading font at the note size, measured here because the font and size are the page's.
  const probe = doc.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText =
    'position:absolute;visibility:hidden;pointer-events:none;block-size:0;overflow:hidden;inline-size:72ch;' +
    'font-family:var(--font-reading);font-size:var(--type-note-size)';
  main.append(probe);

  let shown = 0;
  let zoom = 1;
  let viewport: PageViewportApi | null = null;
  let stopViewport = () => {};

  function update(): void {
    const test = main.dataset.deskGutterTest === 'off';
    const scroller = viewport?.viewport ?? null;
    const gutter =
      test || !viewport || !scroller
        ? 0
        : nextGutter(shown, {
            sizeClass: layoutStore.get().sizeClass,
            region: main.clientWidth,
            scrollbar: Math.max(0, scroller.offsetWidth - scroller.clientWidth),
            column: columnOf(probe, viewport),
            zoom,
            paginated: viewport.world.dataset.sheets !== undefined,
            forcedColors: forced?.matches === true || root.dataset.contrast === 'on',
            pagePaneOpen: main.querySelector(PAGE_PANE) !== null,
            paperInDark: root.dataset.theme === 'dark' && root.dataset.pageColor === 'paper',
          });
    shown = gutter;
    if (main.dataset.deskGutter !== String(gutter)) {
      main.style.setProperty('--desk-gutter', `${gutter}px`);
      main.dataset.deskGutter = String(gutter);
      // The motifs show from the full 24 px: a narrower strip has no room to keep clear of the paper.
      if (gutter >= MOTIF_GUTTER) main.dataset.deskMotifs = '';
      else delete main.dataset.deskMotifs;
    }
  }

  function follow(next: PageViewportApi | null): void {
    stopViewport();
    stopViewport = () => {};
    viewport = next;
    if (!next) return update();
    zoom = next.camera().zoom;
    const settle = () => {
      zoom = next.camera().zoom;
      update();
    };
    const stopGesture = next.onGesture((phase) => phase === 'end' && settle());
    const stopCamera = next.onCamera((camera) => {
      if (camera.gesture === null) settle();
    });
    const sheets = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => update());
    sheets?.observe(next.world, { attributes: true, attributeFilter: ['data-sheets'] });
    stopViewport = () => {
      stopGesture();
      stopCamera();
      sheets?.disconnect();
    };
    update();
  }

  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => update());
  resize?.observe(main);
  // A page pane opening or closing; the test switch.
  // Typing changes the subtree all the time, so only a pane's own arrival or departure, or the switch, runs the rule.
  const isPane = (node: Node) => node instanceof Element && (node.matches(PAGE_PANE) || node.querySelector(PAGE_PANE));
  const paneAttribute = (target: Node) =>
    target === main || (target instanceof Element && target.matches('[data-page-pane]'));
  const mutations =
    typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver((records) => {
          const relevant = records.some(
            (record) =>
              (record.type === 'attributes' && paneAttribute(record.target)) ||
              [...record.addedNodes, ...record.removedNodes].some((node) => isPane(node)),
          );
          if (relevant) update();
        });
  mutations?.observe(main, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-desk-gutter-test', 'hidden'],
  });
  const themes = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => update());
  themes?.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-page-color', 'data-contrast'] });
  forced?.addEventListener('change', update);
  const stopLayout = layoutStore.subscribe(update);
  const stopShown = shownViewport.subscribe(() => follow(shownViewport.get()));
  follow(shownViewport.get());

  // Input in the strips: a plain wheel scrolls the page, a Ctrl+wheel zooms it through the viewport's own handler.
  const inStrip = (event: Event) => event.target === main && shown > 0;
  const onWheel = (event: WheelEvent) => {
    const scroller = viewport?.viewport;
    if (!scroller || !inStrip(event)) return;
    event.preventDefault();
    const box = scroller.getBoundingClientRect();
    if (event.ctrlKey) {
      const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
      scroller.dispatchEvent(
        new WheelEvent('wheel', {
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          ctrlKey: true,
          clientX: clamp(event.clientX, box.left + 1, box.right - 1),
          clientY: clamp(event.clientY, box.top + 1, box.bottom - 1),
          bubbles: true,
          cancelable: true,
        }),
      );
      return;
    }
    const unit = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? box.height : 1;
    scroller.scrollBy({ left: event.deltaX * unit, top: event.deltaY * unit, behavior: 'instant' });
  };
  let pan: { id: number; x: number; y: number } | null = null;
  const onPointerDown = (event: PointerEvent) => {
    if (!inStrip(event)) return;
    // The caret stays in the page: no focus moves to main.
    event.preventDefault();
    if (event.pointerType === 'mouse' || pan) return;
    pan = { id: event.pointerId, x: event.clientX, y: event.clientY };
    main.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!pan || event.pointerId !== pan.id) return;
    viewport?.viewport.scrollBy({ left: pan.x - event.clientX, top: pan.y - event.clientY, behavior: 'instant' });
    pan = { id: pan.id, x: event.clientX, y: event.clientY };
  };
  const onPointerEnd = (event: PointerEvent) => {
    if (pan && event.pointerId === pan.id) pan = null;
  };
  const onMouseDown = (event: MouseEvent) => {
    if (inStrip(event)) event.preventDefault();
  };
  main.addEventListener('wheel', onWheel, { passive: false });
  main.addEventListener('pointerdown', onPointerDown);
  main.addEventListener('pointermove', onPointerMove);
  main.addEventListener('pointerup', onPointerEnd);
  main.addEventListener('pointercancel', onPointerEnd);
  main.addEventListener('mousedown', onMouseDown);

  return () => {
    main.removeEventListener('wheel', onWheel);
    main.removeEventListener('pointerdown', onPointerDown);
    main.removeEventListener('pointermove', onPointerMove);
    main.removeEventListener('pointerup', onPointerEnd);
    main.removeEventListener('pointercancel', onPointerEnd);
    main.removeEventListener('mousedown', onMouseDown);
    stopViewport();
    stopLayout();
    stopShown();
    resize?.disconnect();
    mutations?.disconnect();
    themes?.disconnect();
    forced?.removeEventListener('change', update);
    probe.remove();
    main.style.removeProperty('--desk-gutter');
    delete main.dataset.deskGutter;
    delete main.dataset.deskMotifs;
  };
}

/** A ref callback for the page region: runs `inner` (the region's own ref) and the gutter. */
export function useDeskGutter(inner: RefCallback<HTMLElement>): RefCallback<HTMLElement> {
  const stop = useRef<(() => void) | null>(null);
  return useCallback(
    (node: HTMLElement | null) => {
      stop.current?.();
      stop.current = null;
      if (!node) return;
      const cleanup = inner(node);
      stop.current = startDeskGutter(node);
      return () => {
        stop.current?.();
        stop.current = null;
        if (typeof cleanup === 'function') cleanup();
      };
    },
    [inner],
  );
}
