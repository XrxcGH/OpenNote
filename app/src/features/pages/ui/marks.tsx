// The marks of a show: a laser that follows the pointer and ink that fades by itself, drawn on a canvas laid over the
// show. Present a page and Present as slides share it, so a mark behaves the same in both. Nothing here touches the note.
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { INK_LIFE, LASER_LIFE, alive, extend, finish, segments } from '../slides';
import type { Trail } from '../slides';

export type Tool = 'laser' | 'ink' | 'move';
export const TOOL_KEYS: Readonly<Record<string, Tool>> = { l: 'laser', p: 'ink', m: 'move' };

interface Marks {
  ink: Trail[];
  laser: Trail[];
  /** Where the laser dot is, or null while the pointer is away. */
  dot: { x: number; y: number } | null;
}

interface Colors {
  readonly laser: string;
  readonly ink: string;
}

/** The colors of the marks, read from the theme because a canvas can't use custom properties. */
function readColors(element: HTMLElement): Colors {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return { laser: read('--color-accent-clay', 'CanvasText'), ink: read('--color-accent-night', 'CanvasText') };
}

function paint(canvas: HTMLCanvasElement, marks: Marks, colors: Colors, now: number): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const ratio = canvas.width / Math.max(1, canvas.clientWidth);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const stroke = (trails: readonly Trail[], life: number, color: string, width: number) => {
    context.strokeStyle = color;
    context.lineWidth = width;
    for (const trail of trails) {
      for (const s of segments(trail, now, life)) {
        context.globalAlpha = s.alpha;
        context.beginPath();
        context.moveTo(s.x1, s.y1);
        context.lineTo(s.x2, s.y2);
        context.stroke();
      }
    }
  };
  stroke(marks.ink, INK_LIFE, colors.ink, 4);
  stroke(marks.laser, LASER_LIFE, colors.laser, 7);
  if (marks.dot) {
    context.fillStyle = colors.laser;
    context.globalAlpha = 0.25;
    context.beginPath();
    context.arc(marks.dot.x, marks.dot.y, 18, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 0.95;
    context.beginPath();
    context.arc(marks.dot.x, marks.dot.y, 8, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
}

/** What draws the marks on a canvas: it keeps them, repaints while any is still showing, and stops when none is. */
export function createOverlay(element: HTMLCanvasElement) {
  const marks: Marks = { ink: [], laser: [], dot: null };
  const colors = readColors(element);
  let frame = 0;
  let pressed = false;
  const draw = (): void => {
    frame = 0;
    const now = performance.now();
    marks.ink = alive(marks.ink, now, INK_LIFE);
    marks.laser = alive(marks.laser, now, LASER_LIFE);
    paint(element, marks, colors, now);
    if (marks.ink.length + marks.laser.length > 0 || marks.dot !== null) frame = requestAnimationFrame(draw);
  };
  const wake = () => {
    frame ||= requestAnimationFrame(draw);
  };
  // The canvas is as sharp as the screen: one pixel of canvas for each device pixel.
  const size = () => {
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.round(element.clientWidth * ratio);
    element.height = Math.round(element.clientHeight * ratio);
    wake();
  };
  size();
  const observer = new ResizeObserver(size);
  observer.observe(element);
  const point = (event: PointerEvent) => {
    const box = element.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top, t: performance.now() };
  };
  return {
    down(event: PointerEvent, tool: Tool) {
      pressed = true;
      element.setPointerCapture(event.pointerId);
      const p = point(event);
      if (tool === 'ink') marks.ink = extend(finish(marks.ink), p);
      else marks.laser = extend(finish(marks.laser), p);
      marks.dot = { x: p.x, y: p.y };
      wake();
    },
    move(event: PointerEvent, tool: Tool) {
      // A finger is only a pointer while it touches; a pen and a mouse point before they touch.
      if (event.pointerType === 'touch' && !pressed) return;
      const p = point(event);
      if (tool === 'ink') {
        if (pressed) marks.ink = extend(marks.ink, p);
        marks.dot = pressed ? null : { x: p.x, y: p.y };
      } else {
        marks.laser = extend(marks.laser, p);
        marks.dot = { x: p.x, y: p.y };
      }
      wake();
    },
    up(event: PointerEvent) {
      pressed = false;
      marks.ink = finish(marks.ink);
      marks.laser = finish(marks.laser);
      if (event.pointerType === 'touch') marks.dot = null;
      wake();
    },
    leave() {
      if (pressed) return;
      marks.dot = null;
      marks.laser = finish(marks.laser);
      wake();
    },
    clear() {
      marks.ink = [];
      marks.laser = [];
      marks.dot = null;
      wake();
    },
    destroy() {
      observer.disconnect();
      cancelAnimationFrame(frame);
    },
  };
}

export type Overlay = ReturnType<typeof createOverlay>;

/** The marks are drawn on the canvas for as long as the stage shows. */
export function useOverlay(canvas: RefObject<HTMLCanvasElement | null>): RefObject<Overlay | null> {
  const overlay = useRef<Overlay | null>(null);
  useEffect(() => {
    if (!canvas.current) return;
    overlay.current = createOverlay(canvas.current);
    return () => {
      overlay.current?.destroy();
      overlay.current = null;
    };
  }, [canvas]);
  return overlay;
}
