// The page corners of a scan, placed by hand (A3-20). The photo shows with the four corners found in it; each corner is
// a button that a pointer drags, or that the arrow keys move (Shift moves farther). Corners are fractions of the
// photo's size, so they hold however large the photo is read.
import { useEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { t } from '../../../strings/t';
import type { Frame } from './apply';
import styles from '../pdf.module.css';

export interface CornerEditorProps {
  photo: Blob;
  frame: Frame;
  /** Called while a corner moves, for the outline. */
  onMove: (frame: Frame) => void;
  /** Called when a corner is let go or a key moved it, for the preview. */
  onCommit: (frame: Frame) => void;
}

const NAMES = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;
const STEP = 0.005;
const BIG_STEP = 0.05;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** The frame with one corner moved to a point, clamped inside the photo. */
export function moveCorner(frame: Frame, index: number, x: number, y: number): Frame {
  const next = [...frame] as [Frame[0], Frame[1], Frame[2], Frame[3]];
  next[index] = [clamp01(x), clamp01(y)];
  return next;
}

/** The move an arrow key makes, or null for other keys. */
export function keyMove(key: string, shift: boolean): readonly [number, number] | null {
  const step = shift ? BIG_STEP : STEP;
  switch (key) {
    case 'ArrowLeft':
      return [-step, 0];
    case 'ArrowRight':
      return [step, 0];
    case 'ArrowUp':
      return [0, -step];
    case 'ArrowDown':
      return [0, step];
    default:
      return null;
  }
}

export function CornerEditor({ photo, frame, onMove, onCommit }: CornerEditorProps) {
  const url = useMemo(() => URL.createObjectURL(photo), [photo]);
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const pointAt = (event: PointerEvent): readonly [number, number] | null => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
  };

  const down = (index: number) => (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    dragging.current = index;
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const index = dragging.current;
    const point = index === null ? null : pointAt(event);
    if (index === null || !point) return;
    onMove(moveCorner(frame, index, point[0], point[1]));
  };
  const up = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragging.current === null) return;
    dragging.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    onCommit(frame);
  };
  const key = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = keyMove(event.key, event.shiftKey);
    if (!step) return;
    event.preventDefault();
    const [x, y] = frame[index];
    const next = moveCorner(frame, index, x + step[0], y + step[1]);
    onMove(next);
    onCommit(next);
  };

  const points = frame.map(([x, y]) => `${x * 100},${y * 100}`).join(' ');
  return (
    <div role="group" aria-label={t('pdf.scan.corners.label')} aria-describedby="scan-corners-help">
      <p id="scan-corners-help" className={styles.cornersHelp}>
        {t('pdf.scan.corners.help')}
      </p>
      <div ref={box} className={styles.corners}>
        <img src={url} alt="" className={styles.cornersPhoto} draggable={false} />
        <svg className={styles.cornersOutline} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polygon points={points} vectorEffect="non-scaling-stroke" />
        </svg>
        {frame.map(([x, y], index) => (
          <button
            key={NAMES[index]}
            type="button"
            className={styles.corner}
            style={{ insetInlineStart: `${x * 100}%`, insetBlockStart: `${y * 100}%` }}
            aria-label={t(`pdf.scan.corners.${NAMES[index]}`, {
              x: Math.round(x * 100),
              y: Math.round(y * 100),
            })}
            onPointerDown={down(index)}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onKeyDown={key(index)}
          />
        ))}
      </div>
    </div>
  );
}
