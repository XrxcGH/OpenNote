// A drag that starts on one of the layer's elements: pointer capture, a move callback, and a callback when it ends.
/** Runs `move` for each pointer move of a drag that starts on `el`, and `done` when it ends or is canceled. */
export function drag(
  el: HTMLElement,
  event: PointerEvent,
  move: (e: PointerEvent) => void,
  done: (e: PointerEvent, canceled: boolean) => void,
): void {
  event.preventDefault();
  event.stopPropagation();
  el.setPointerCapture?.(event.pointerId);
  const stop = (e: PointerEvent) => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', stop);
    el.removeEventListener('pointercancel', stop);
    done(e, e.type === 'pointercancel');
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
}
