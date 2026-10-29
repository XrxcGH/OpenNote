// A writing box of the calibration page, and the drawings of written ink the page and its previews show. The box
// takes the pen's points with their pressure and timing, as the page's own pen does; a touch is ignored once a pen
// has been seen, so a resting hand never writes. A keyboard reaches every box: the arrow keys move between boxes,
// and Delete clears one so it can be written again.
import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { outlinePath, strokeOutline } from '../../geometry/outline';
import type { FlatStroke, RawSample } from '../../myhand/style';
import { pointsOf } from '../../myhand/style';
import type { InkPath } from '../../myhand/write';
import { t } from '../../../../strings/t';
import styles from './myhand.module.css';

/** Outlines of ink paths for an SVG, `width` wide in the paths' units. */
export function inkPathData(paths: readonly InkPath[], width: number): string[] {
  return paths
    .filter((path) => path.length > 0)
    .map((path) =>
      outlinePath(
        strokeOutline(
          path.map((p) => ({ x: p.x, y: p.y, pressure: p.pressure })),
          { tool: 'pen', width },
        ),
      ),
    );
}

const flatToPath = (stroke: FlatStroke): InkPath =>
  pointsOf(stroke).map((p) => ({ x: p.x, y: p.y, pressure: p.p, time: p.t }));

/** A drawing of written ink, fitted into its box with a margin. */
export function InkDrawing(props: { paths: readonly InkPath[]; width: number; label: string; height?: number }) {
  const all = props.paths.flat();
  if (all.length === 0) return <svg role="img" aria-label={props.label} viewBox="0 0 10 10" />;
  const margin = props.width * 2;
  const x0 = Math.min(...all.map((p) => p.x)) - margin;
  const y0 = Math.min(...all.map((p) => p.y)) - margin;
  const w = Math.max(...all.map((p) => p.x)) - x0 + margin;
  const h = Math.max(...all.map((p) => p.y)) - y0 + margin;
  return (
    <svg
      role="img"
      aria-label={props.label}
      viewBox={`${x0} ${y0} ${w} ${h}`}
      style={props.height ? { blockSize: props.height } : undefined}
    >
      {inkPathData(props.paths, props.width).map((d, i) => (
        <path key={i} d={d} className={styles.ink} />
      ))}
    </svg>
  );
}

export interface PenBoxProps {
  readonly label: string;
  readonly sample: RawSample | null;
  readonly width: number;
  readonly height: number;
  readonly baseline: number;
  readonly guide: number;
  readonly onChange: (sample: RawSample | null) => void;
  /** The roving focus: only the current box is in the tab order. */
  readonly tabIndex: 0 | -1;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  readonly onFocus?: () => void;
  readonly index?: number;
}

/** Once a pen has written, a touch is a resting hand and never writes. */
const pens = { seen: false };

/** A point of the pen in the box's own units: x, y, pressure, and time. */
function pointOf(
  event: PointerEvent | ReactPointerEvent,
  box: HTMLElement,
  size: { width: number; height: number },
  t0: number,
): number[] {
  const rect = box.getBoundingClientRect();
  const pressure = event.pointerType === 'mouse' || event.pressure === 0 ? 0.5 : event.pressure;
  return [
    Math.round((event.clientX - rect.left) * (size.width / Math.max(1, rect.width)) * 100) / 100,
    Math.round((event.clientY - rect.top) * (size.height / Math.max(1, rect.height)) * 100) / 100,
    Math.round(pressure * 1000) / 1000,
    Math.max(0, Math.round(event.timeStamp - t0)),
  ];
}

/** The pen's strokes in a box: the one being written, and each finished one handed to `done`. */
function usePenStrokes(props: PenBoxProps, element: RefObject<HTMLDivElement | null>) {
  const { sample, width, height } = props;
  const live = useRef<{ id: number; points: number[]; t0: number } | null>(null);
  const [drawing, setDrawing] = useState<number[] | null>(null);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'pen') pens.seen = true;
    if ((event.pointerType === 'touch' && pens.seen) || event.button !== 0 || live.current || !element.current) return;
    event.preventDefault();
    try {
      element.current.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser no longer tracks can't be captured; the box still takes its points.
    }
    element.current.focus({ preventScroll: true });
    // Times run from the sample's first stroke: a later stroke starts a moment after the last one ended.
    const last = sample?.strokes.at(-1);
    const lastTime = last && last.length >= 4 ? last[last.length - 1] : null;
    const t0 = lastTime === null ? event.timeStamp : event.timeStamp - (lastTime + 150);
    live.current = { id: event.pointerId, points: pointOf(event, element.current, { width, height }, t0), t0 };
    setDrawing([...live.current.points]);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = live.current;
    if (!current || event.pointerId !== current.id || !element.current) return;
    const events = event.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const e of events.length > 0 ? events : [event.nativeEvent]) {
      current.points.push(...pointOf(e, element.current, { width, height }, current.t0));
    }
    setDrawing([...current.points]);
  };
  const finish = (event: ReactPointerEvent<HTMLDivElement>, keep: boolean) => {
    const current = live.current;
    if (!current || event.pointerId !== current.id) return;
    live.current = null;
    setDrawing(null);
    if (!keep || current.points.length < 4) return;
    const strokes = [...(sample?.strokes ?? []), current.points].slice(0, 40);
    const at = Math.round(performance.timeOrigin + event.timeStamp);
    props.onChange({ strokes, baseline: props.baseline, guide: props.guide, width, height, at });
  };
  return {
    drawing,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => finish(event, true),
      onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => finish(event, false),
    },
  };
}

/** One box to write a sample in. */
export function PenBox(props: PenBoxProps) {
  const { sample, width, height, baseline, guide } = props;
  const element = useRef<HTMLDivElement>(null);
  const { drawing, handlers } = usePenStrokes(props, element);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key === 'Delete' || event.key === 'Backspace') && sample) {
      event.preventDefault();
      props.onChange(null);
      return;
    }
    props.onKeyDown?.(event);
  };

  const strokes = [...(sample?.strokes ?? []), ...(drawing ? [drawing] : [])];
  const written = (sample?.strokes.length ?? 0) > 0;
  return (
    <div
      ref={element}
      role="group"
      tabIndex={props.tabIndex}
      aria-label={props.label}
      aria-description={written ? t('myHand.box.written') : t('myHand.box.empty')}
      data-written={written}
      data-myhand-box={props.index}
      className={styles.box}
      style={{ inlineSize: width, blockSize: height }}
      {...handlers}
      onKeyDown={onKeyDown}
      onFocus={props.onFocus}
    >
      <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <line x1={4} x2={width - 4} y1={baseline - guide} y2={baseline - guide} className={styles.guide} />
        <line x1={4} x2={width - 4} y1={baseline} y2={baseline} className={styles.baseline} />
        {inkPathData(strokes.map(flatToPath), 2.4).map((d, i) => (
          <path key={i} d={d} className={styles.ink} />
        ))}
      </svg>
      {written && (
        <button
          type="button"
          tabIndex={-1}
          className={styles.redo}
          onClick={() => props.onChange(null)}
          aria-label={t('myHand.box.redo')}
        >
          {t('myHand.box.redo')}
        </button>
      )}
    </div>
  );
}

/** Arrow keys between the boxes of a grid of `columns`, Home and End to the first and last. */
export function moveFocus(
  event: KeyboardEvent<HTMLElement>,
  index: number,
  count: number,
  columns: number,
): number | null {
  const moves: Record<string, number> = {
    ArrowRight: 1,
    ArrowLeft: -1,
    ArrowDown: columns,
    ArrowUp: -columns,
  };
  let next: number | null = null;
  if (event.key in moves) next = index + moves[event.key];
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = count - 1;
  if (next === null || next < 0 || next >= count) return null;
  event.preventDefault();
  return next;
}
