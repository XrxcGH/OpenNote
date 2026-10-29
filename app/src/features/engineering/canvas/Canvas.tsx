// The drawing surface of the engineering diagrams: a grid in model units (y up), the parts as SVG children, and one
// pointer drag at a time. A part starts a drag with `drag(event, move, end)`; the surface keeps the pointer captured
// and reports model points, so pen, touch, and mouse all move parts the same way.
import { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { Point } from './geometry';
import { useSvgScale } from './svgScale';
import styles from './canvas.module.css';

export interface View {
  scale: number;
  sx(x: number): number;
  sy(y: number): number;
  /** The model point under a screen point. */
  toModel(clientX: number, clientY: number): Point;
  /** Follows one pointer: `move` gets the model point and where the drag started. */
  drag(event: ReactPointerEvent, move: (p: Point, start: Point) => void, end?: (p: Point) => void): void;
}

const ViewContext = createContext<View | null>(null);

export function useView(): View {
  const view = useContext(ViewContext);
  if (!view) throw new Error('useView needs a Canvas');
  return view;
}

const PAD = 16;

interface Props {
  label: string;
  columns: number;
  rows: number;
  scale?: number;
  /** Pointer down on the empty grid, at a model point. */
  onBackground?(p: Point, event: ReactPointerEvent, view: View): void;
  children: ReactNode;
}

export function Canvas({ label, columns, rows, scale = 40, onBackground, children }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const active = useRef<{ id: number; start: Point; move(p: Point, start: Point): void; end?(p: Point): void } | null>(
    null,
  );

  const toModel = useCallback(
    (clientX: number, clientY: number): Point => {
      const box = svg.current?.getBoundingClientRect();
      const width = columns * scale + PAD * 2;
      const ratio = box && box.width > 0 ? width / box.width : 1;
      const x = ((clientX - (box?.left ?? 0)) * ratio - PAD) / scale;
      const y = rows - ((clientY - (box?.top ?? 0)) * ratio - PAD) / scale;
      return { x, y };
    },
    [columns, rows, scale],
  );

  const view = useMemo<View>(
    () => ({
      scale,
      toModel,
      sx: (x) => PAD + x * scale,
      sy: (y) => PAD + (rows - y) * scale,
      drag(event, move, end) {
        event.stopPropagation();
        event.preventDefault();
        try {
          svg.current?.setPointerCapture(event.pointerId);
        } catch {
          // A synthetic pointer cannot be captured; moves still arrive on the surface.
        }
        active.current = {
          id: event.pointerId,
          start: toModel(event.clientX, event.clientY),
          move,
          ...(end ? { end } : {}),
        };
      },
    }),
    [rows, scale, toModel],
  );

  const width = columns * scale + PAD * 2;
  const height = rows * scale + PAD * 2;
  useSvgScale(svg, width);
  const lines: ReactNode[] = [];
  for (let c = 0; c <= columns; c++) {
    const x = PAD + c * scale;
    lines.push(<line key={`c${c}`} x1={x} y1={PAD} x2={x} y2={height - PAD} />);
  }
  for (let r = 0; r <= rows; r++) {
    const y = PAD + r * scale;
    lines.push(<line key={`r${r}`} x1={PAD} y1={y} x2={width - PAD} y2={y} />);
  }

  const finish = (event: ReactPointerEvent) => {
    const drag = active.current;
    if (!drag || drag.id !== event.pointerId) return;
    active.current = null;
    drag.end?.(toModel(event.clientX, event.clientY));
  };

  return (
    <ViewContext.Provider value={view}>
      <svg
        ref={svg}
        className={styles.canvas}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        role="group"
        aria-label={label}
        onPointerDown={(event) => {
          if (event.target === svg.current || (event.target as Element).hasAttribute('data-grid')) {
            onBackground?.(toModel(event.clientX, event.clientY), event, view);
          }
        }}
        onPointerMove={(event) => {
          const drag = active.current;
          if (drag && drag.id === event.pointerId) drag.move(toModel(event.clientX, event.clientY), drag.start);
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <rect data-grid="" className={styles.paper} x={0} y={0} width={width} height={height} />
        <g className={styles.grid} aria-hidden="true">
          {lines}
        </g>
        {children}
      </svg>
    </ViewContext.Provider>
  );
}

export interface PartKeys {
  move?(dx: number, dy: number): void;
  rotate?(by: number): void;
  remove?(): void;
  select?(): void;
}

/** Arrow keys move a part by a grid step (Shift for a tenth), R and Shift+R turn it, Delete removes it. */
export function onPartKey(event: KeyboardEvent, step: number, keys: PartKeys): void {
  const by = event.shiftKey ? step / 5 : step;
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-by, 0],
    ArrowRight: [by, 0],
    ArrowUp: [0, by],
    ArrowDown: [0, -by],
  };
  const move = moves[event.key];
  if (move && keys.move) {
    keys.move(move[0], move[1]);
  } else if ((event.key === 'r' || event.key === 'R') && keys.rotate) {
    keys.rotate(event.shiftKey ? -15 : 15);
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && keys.remove) {
    keys.remove();
  } else if ((event.key === 'Enter' || event.key === ' ') && keys.select) {
    keys.select();
  } else {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
}
