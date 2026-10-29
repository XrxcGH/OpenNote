// An answer area to write in with a pen, a finger, or the mouse (practice exams). While a pen is near, touches are
// a resting hand and are left out, and so is a contact the size of a palm. Every answer can also be typed, so the
// area is never the only way to answer. The strokes stay with the exam; the person marks a written answer.
import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { t } from '../../../../strings/t';
import { Button } from '../../../../ui';
import type { InkPoint } from '../../exam/types';
import styles from './exam.module.css';

/** The area's drawing size; it scales to the width it is given. */
const WIDTH = 640;
const HEIGHT = 200;
const MAX_STROKES = 200;
const MAX_POINTS = 2000;
/** A touch this soon after the pen was seen is the hand resting on the screen. */
const PEN_GRACE_MS = 1500;
/** A contact larger than this many square pixels is a palm. */
const PALM_AREA = 900;

interface Props {
  label: string;
  strokes: readonly InkPoint[][];
  onChange?(strokes: InkPoint[][]): void;
  /** Reads the writing as math, when the on-device handwriting reader is there. */
  onRead?(): void;
}

function draw(canvas: HTMLCanvasElement, strokes: readonly InkPoint[][]): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, WIDTH, HEIGHT);
  context.strokeStyle = getComputedStyle(canvas).color;
  context.lineWidth = 2.5;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const stroke of strokes) {
    const [first, ...rest] = stroke;
    if (!first) continue;
    context.beginPath();
    context.moveTo(first[0], first[1]);
    if (rest.length === 0) context.lineTo(first[0] + 0.1, first[1]);
    for (const [x, y] of rest) context.lineTo(x, y);
    context.stroke();
  }
}

export function InkAnswer({ label, strokes, onChange, onRead }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef<InkPoint[] | null>(null);
  const penAt = useRef(-Infinity);
  const readOnly = onChange === undefined;

  useEffect(() => {
    if (canvas.current) draw(canvas.current, strokes);
  }, [strokes]);

  const pointOf = (event: ReactPointerEvent<HTMLCanvasElement>): InkPoint => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / Math.max(1, box.width)) * WIDTH;
    const y = ((event.clientY - box.top) / Math.max(1, box.height)) * HEIGHT;
    return [
      Math.round(Math.max(0, Math.min(WIDTH, x)) * 10) / 10,
      Math.round(Math.max(0, Math.min(HEIGHT, y)) * 10) / 10,
    ];
  };

  const isHand = (event: ReactPointerEvent<HTMLCanvasElement>): boolean =>
    event.pointerType === 'touch' &&
    (event.timeStamp - penAt.current < PEN_GRACE_MS || event.width * event.height > PALM_AREA);

  const down = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (readOnly || strokes.length >= MAX_STROKES) return;
    if (event.pointerType === 'pen') penAt.current = event.timeStamp;
    if (isHand(event) || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    current.current = [pointOf(event)];
  };

  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'pen') penAt.current = event.timeStamp;
    const stroke = current.current;
    if (!stroke || stroke.length >= MAX_POINTS) return;
    const events = event.nativeEvent.getCoalescedEvents?.() ?? [];
    if (events.length > 1) {
      const box = event.currentTarget.getBoundingClientRect();
      for (const one of events)
        stroke.push([
          ((one.clientX - box.left) / Math.max(1, box.width)) * WIDTH,
          ((one.clientY - box.top) / Math.max(1, box.height)) * HEIGHT,
        ]);
    } else stroke.push(pointOf(event));
    if (canvas.current) draw(canvas.current, [...strokes, stroke]);
  };

  const up = () => {
    const stroke = current.current;
    current.current = null;
    if (stroke && onChange) onChange([...strokes, stroke]);
  };

  return (
    <div className={styles.ink}>
      <canvas
        ref={canvas}
        className={styles.inkArea}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label={t('exams.ink.area', { label, count: strokes.length })}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          current.current = null;
          if (canvas.current) draw(canvas.current, strokes);
        }}
        data-readonly={readOnly ? '' : undefined}
      />
      {readOnly ? null : (
        <div className={styles.buttons}>
          <Button variant="quiet" disabled={strokes.length === 0} onClick={() => onChange?.(strokes.slice(0, -1))}>
            {t('exams.ink.undo')}
          </Button>
          <Button variant="quiet" disabled={strokes.length === 0} onClick={() => onChange?.([])}>
            {t('exams.ink.clear')}
          </Button>
          {onRead ? (
            <Button disabled={strokes.length === 0} onClick={onRead}>
              {t('exams.ink.read')}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
