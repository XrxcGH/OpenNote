// A small writing area for math (A1-28): the person writes an equation with a pen, a finger, or a mouse, and the
// strokes go to the page's recognizer. It draws only what is written and keeps nothing; the strokes leave with the pad.
import { t } from '../../strings/t';
import styles from './mathDrawn.module.css';

export interface PenPad {
  element: HTMLElement;
  /** The strokes written so far, as points in the pad's own units. */
  strokes(): [number, number][][];
  clear(): void;
}

const MAX_POINTS = 4000;

/** Makes the pad. `onDone` runs when the person chooses Use writing. */
export function createPenPad(onDone: () => void): PenPad {
  const element = document.createElement('div');
  element.className = styles.pad;
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', t('intelMore.math.penPad'));
  const canvas = document.createElement('canvas');
  canvas.className = styles.padCanvas;
  canvas.width = 640;
  canvas.height = 220;
  canvas.setAttribute('aria-label', t('intelMore.math.penHelp'));
  canvas.style.touchAction = 'none';
  const buttons = document.createElement('div');
  buttons.className = styles.actions;
  const strokes: [number, number][][] = [];
  let current: [number, number][] | null = null;
  let sawPen = false;
  const context = canvas.getContext('2d');
  const ink = () => getComputedStyle(element).color;
  const point = (event: PointerEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) * canvas.width) / Math.max(1, rect.width),
      ((event.clientY - rect.top) * canvas.height) / Math.max(1, rect.height),
    ];
  };
  const draw = () => {
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = ink();
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const stroke of strokes) {
      context.beginPath();
      stroke.forEach(([x, y], i) => (i === 0 ? context.moveTo(x, y) : context.lineTo(x, y)));
      context.stroke();
    }
  };
  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'pen') sawPen = true;
    // A palm resting beside a pen is not writing.
    if (event.pointerType === 'touch' && sawPen) return;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // The pointer is already gone, which only means the stroke is short.
    }
    current = [point(event)];
    strokes.push(current);
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!current || current.length >= MAX_POINTS) return;
    current.push(point(event));
    draw();
  });
  const end = () => {
    current = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  const button = (label: string, run: () => void) => {
    const one = document.createElement('button');
    one.type = 'button';
    one.textContent = label;
    // A press must not take focus from the equation field, or the field would close and save.
    one.addEventListener('mousedown', (event) => event.preventDefault());
    one.addEventListener('click', run);
    buttons.append(one);
  };
  const clear = () => {
    strokes.length = 0;
    draw();
  };
  button(t('intelMore.math.penDone'), onDone);
  button(t('intelMore.math.penClear'), clear);
  element.append(canvas, buttons);
  return { element, strokes: () => strokes.map((stroke) => [...stroke]), clear };
}
