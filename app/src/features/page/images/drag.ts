// A pointer drag on a handle, in page units: the resize handles and the crop handles share it.

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Follows a drag from a pointer down until it ends, calling `move` with the distance in page units. */
export function trackDrag(
  event: PointerEvent,
  zoom: number,
  move: (dx: number, dy: number, moveEvent: PointerEvent) => void,
  end: () => void,
): void {
  event.preventDefault();
  event.stopPropagation();
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture?.(event.pointerId);
  const origin = { x: event.clientX, y: event.clientY };
  const onMove = (moveEvent: PointerEvent) =>
    move((moveEvent.clientX - origin.x) / zoom, (moveEvent.clientY - origin.y) / zoom, moveEvent);
  const onEnd = () => {
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onEnd);
    target.removeEventListener('pointercancel', onEnd);
    end();
  };
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onEnd);
  target.addEventListener('pointercancel', onEnd);
}

/** The step an arrow key asks for, scaled, or null for other keys. The key is handled when it is an arrow. */
export function arrowStep(event: KeyboardEvent, step: number): readonly [number, number] | null {
  const arrow = ARROWS[event.key];
  if (!arrow) return null;
  event.preventDefault();
  event.stopPropagation();
  return [arrow[0] * step, arrow[1] * step];
}
