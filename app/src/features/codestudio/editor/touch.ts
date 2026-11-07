// Touch and pen in the code editor (DESIGN 5.4). The content is contenteditable, so the system caret, selection
// handles, on-screen keyboard, and the Windows handwriting panel work as in any text field. Two fingers pinch the
// code font (not the page). A pen taps to place the caret and drags to select, as a mouse does; the code editor is
// never an ink surface, so a pen press stops here and page ink under it never starts a stroke. The pen's barrel
// button opens the context menu.

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
export const ZOOM_STEP = 0.1;
/** How long after a pen barrel press the browser's own contextmenu for it is dropped. */
export const BARREL_MENU_MS = 1000;

export function clampZoom(value: number): number {
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value)) * 100) / 100;
}

export interface TouchOptions {
  getZoom(): number;
  setZoom(value: number): void;
  /** The last pointer type, for the Accept button. */
  onPointer(type: string): void;
  /** Opens the editor's context menu at a point; the default is the browser's own menu. */
  onContextMenu?: (event: MouseEvent) => void;
}

/** Wires pinch zoom, pen handling, and the context menu onto the editor root. Returns a function that removes them. */
export function installTouch(root: HTMLElement, options: TouchOptions): () => void {
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { distance: number; zoom: number } | null = null;
  // The barrel press opens the menu at once, from a contextmenu event made here. The browser then sends its own
  // contextmenu for the same press, which is dropped, so the menu opens once.
  const made = new WeakSet<Event>();
  let dropUntil = 0;

  const distance = () => {
    const [a, b] = [...touches.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const down = (event: PointerEvent) => {
    options.onPointer(event.pointerType);
    if (event.pointerType === 'pen') {
      // Never ink: the pen edits text here.
      event.stopPropagation();
      if (event.button === 2 || (event.buttons & 2) !== 0) {
        event.preventDefault();
        const menu = new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: event.clientX,
          clientY: event.clientY,
        });
        made.add(menu);
        dropUntil = Date.now() + BARREL_MENU_MS;
        event.target?.dispatchEvent(menu);
      }
      return;
    }
    if (event.pointerType !== 'touch') return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size === 2) pinch = { distance: distance(), zoom: options.getZoom() };
  };

  const move = (event: PointerEvent) => {
    if (!touches.has(event.pointerId)) return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && pinch.distance > 0) {
      event.preventDefault();
      options.setZoom(clampZoom(pinch.zoom * (distance() / pinch.distance)));
    }
  };

  const up = (event: PointerEvent) => {
    touches.delete(event.pointerId);
    if (touches.size < 2) pinch = null;
  };

  const dropEcho = (event: MouseEvent) => {
    if (made.has(event) || Date.now() > dropUntil) return;
    dropUntil = 0;
    event.preventDefault();
    event.stopPropagation();
  };

  const menu = (event: MouseEvent) => {
    if (!options.onContextMenu || event.defaultPrevented) return;
    event.preventDefault();
    options.onContextMenu(event);
  };

  root.addEventListener('pointerdown', down);
  root.addEventListener('pointermove', move, { passive: false });
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);
  root.addEventListener('contextmenu', dropEcho, true);
  root.addEventListener('contextmenu', menu);
  return () => {
    root.removeEventListener('contextmenu', dropEcho, true);
    root.removeEventListener('pointerdown', down);
    root.removeEventListener('pointermove', move);
    root.removeEventListener('pointerup', up);
    root.removeEventListener('pointercancel', up);
    root.removeEventListener('contextmenu', menu);
  };
}
