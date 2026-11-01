// checks-disable-file modifiability: the canvas is one component that turns pointer events into points
import '../text';

// The drawing surface of the drafting sheet: the sheet as paper with its title block, every shape, and dimension, the
// selection, a rubber band for the shape being drawn, and a mark where the pointer will snap. It works with a mouse, a
// pen or a finger; once a pen has been seen, touches are ignored so a resting palm draws nothing.
import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { tokens } from '../../../../theme/tokens';
import { drawDoc, sheetSize, type TitleLabels } from '../drafting/draw';
import {
  LINE_TYPES,
  snap,
  type DraftingDoc,
  type LineType,
  type Pt,
  type Snap,
  type SnapOptions,
} from '../drafting/model';
import type { DraftTool, Pending } from '../drafting/tools';
import { say } from './ToolPanel';
import styles from './design.module.css';

const PAPER = tokens.color.light.surface.page;
const INK = tokens.color.light.text.primary;
const ACCENT = tokens.ink.pens.find((pen) => pen.name === 'Brick')?.light ?? INK;
const REACH_PX = 10;

interface Props {
  doc: DraftingDoc;
  tool: DraftTool;
  pending: Pending;
  cursor: Snap | null;
  selected: string | null;
  lineType: LineType;
  snaps: SnapOptions;
  zoom: number;
  labels: TitleLabels;
  description: string;
  onPoint(p: Pt, reach: number): void;
  onHover(s: Snap | null): void;
  onKey(event: KeyboardEvent): void;
}

const flip = (p: Pt, h: number): string => `${p[0].toFixed(2)} ${(h - p[1]).toFixed(2)}`;

/** The shape being drawn, as paths in sheet coordinates, from the points picked and where the pointer is. */
function rubberBand(tool: DraftTool, pending: Pending, to: Pt, h: number): string[] {
  const [a, b] = pending.pts;
  if (!a) return [];
  const f = (p: Pt) => flip(p, h);
  const r = (p: Pt, q: Pt) => Math.hypot(q[0] - p[0], q[1] - p[1]);
  switch (tool) {
    case 'line':
    case 'dimAligned':
    case 'dimH':
    case 'dimV':
      return [`M${f(a)}L${f(b ?? to)}`];
    case 'rect': {
      const c: Pt[] = [a, [to[0], a[1]], to, [a[0], to[1]]];
      return [`M${c.map(f).join('L')}Z`];
    }
    case 'circle': {
      const rad = r(a, to);
      return [
        `M${(a[0] - rad).toFixed(2)} ${(h - a[1]).toFixed(2)}a${rad} ${rad} 0 1 0 ${2 * rad} 0a${rad} ${rad} 0 1 0 ${-2 * rad} 0`,
      ];
    }
    case 'arc':
      return [`M${f(a)}L${f(b ?? to)}`];
    case 'poly':
      return [`M${[...pending.pts, to].map(f).join('L')}`];
    default:
      return [];
  }
}

export function DraftingCanvas(props: Props) {
  const { doc, tool, pending, cursor, selected } = props;
  const svg = useRef<SVGSVGElement>(null);
  const penSeen = useRef(0);
  const { w, h } = sheetSize(doc);
  const prims = drawDoc(doc, props.labels);

  const toSheet = (event: PointerEvent): { p: Pt; reach: number } | null => {
    const el = svg.current;
    const ctm = el?.getScreenCTM();
    if (!el || !ctm) return null;
    const point = el.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const q = point.matrixTransform(ctm.inverse());
    return { p: [q.x, h - q.y], reach: REACH_PX / Math.max(ctm.a, 1e-6) };
  };
  const ignore = (event: PointerEvent): boolean => {
    if (event.pointerType === 'pen') penSeen.current = Date.now();
    return event.pointerType === 'touch' && Date.now() - penSeen.current < 8000;
  };
  const move = (event: PointerEvent) => {
    if (ignore(event)) return;
    const at = toSheet(event);
    if (!at) return;
    props.onHover(snap(doc, at.p, at.reach, props.snaps));
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || ignore(event)) return;
    const at = toSheet(event);
    if (!at) return;
    event.preventDefault();
    svg.current?.focus({ preventScroll: true });
    const s = snap(doc, at.p, at.reach, props.snaps);
    props.onHover(s);
    props.onPoint(s.p, at.reach);
  };
  const band = cursor ? rubberBand(tool, pending, cursor.p, h) : [];
  const mark = cursor && tool !== 'select' ? cursor : null;

  return (
    <div className={styles.sheetScroll}>
      <svg
        ref={svg}
        className={styles.sheet}
        style={{
          inlineSize: `${props.zoom * 100}%`,
          touchAction: tool === 'select' ? 'pan-x pan-y pinch-zoom' : 'none',
        }}
        viewBox={`0 0 ${w} ${h}`}
        role="application"
        aria-label={props.description}
        aria-roledescription={say('kitDesign.drafting.canvas')}
        tabIndex={0}
        onPointerMove={move}
        onPointerLeave={() => props.onHover(null)}
        onPointerDown={down}
        onKeyDown={props.onKey}
      >
        <rect width={w} height={h} fill={PAPER} />
        <g color={INK} fontFamily="Arial, Helvetica, sans-serif">
          {prims.map((prim, i) => {
            const on = prim.owner !== null && prim.owner === selected;
            if (prim.t === 'text') {
              const rot = prim.angle !== 0 ? `rotate(${-prim.angle} ${prim.x} ${prim.y})` : undefined;
              return (
                <text
                  key={i}
                  x={prim.x}
                  y={prim.y}
                  fontSize={prim.size}
                  textAnchor={prim.anchor}
                  transform={rot}
                  fill={on ? ACCENT : INK}
                >
                  {prim.text}
                </text>
              );
            }
            return (
              <path
                key={i}
                d={prim.d}
                fill={prim.fill === 'ink' ? (on ? ACCENT : INK) : 'none'}
                stroke={on ? ACCENT : INK}
                strokeWidth={on ? Math.max(prim.weight, 0.5) + 0.3 : prim.weight}
                strokeDasharray={prim.dash.length > 0 ? prim.dash.join(' ') : undefined}
                strokeLinejoin="round"
              />
            );
          })}
        </g>
        {band.map((d, i) => (
          <path
            key={`band${i}`}
            d={d}
            fill="none"
            stroke={ACCENT}
            strokeWidth={Math.max(0.3, LINE_TYPES[props.lineType].weight)}
            strokeDasharray="2 1.5"
            pointerEvents="none"
          />
        ))}
        {pending.pts.map((p, i) => (
          <circle key={`pt${i}`} cx={p[0]} cy={h - p[1]} r={1.1} fill={ACCENT} pointerEvents="none" />
        ))}
        {mark && (
          <g pointerEvents="none" stroke={ACCENT} strokeWidth={0.4} fill="none">
            <rect x={mark.p[0] - 1.6} y={h - mark.p[1] - 1.6} width={3.2} height={3.2} />
            {mark.kind !== 'grid' && <circle cx={mark.p[0]} cy={h - mark.p[1]} r={2.6} />}
          </g>
        )}
      </svg>
    </div>
  );
}
