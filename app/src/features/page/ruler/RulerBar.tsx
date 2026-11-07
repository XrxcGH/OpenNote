// The ruler itself (text DESIGN.md 5.4): the markers, the tab stops, and the pointer and keyboard moves that change
// them. It knows nothing of the editor: it takes the paragraph's indent and tab stops, and hands back the new ones.
// One drag is one change on release, so one Ctrl+Z undoes it. Every marker is a slider with a value in the unit, and
// the arrow keys move it one step of the snap grid.
import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { Indent, TabStop } from '../../../editor/paragraph/attributes';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { announce } from '../../../ui';
import {
  DRAG_THRESHOLD_PX,
  HIT_PX,
  TAB_TYPES,
  clamp,
  dragValue,
  firstLineAt,
  isTabAlign,
  movedIndent,
  movedTab,
  offRuler,
  pointsToPixels,
  withTab,
  withoutTab,
} from './geometry';
import type { MarkerKind, TabType } from './geometry';
import { RULER_UNITS, TICKS, fromPoints, roundPoints, shownNumber, snapPoints } from './units';
import type { RulerUnit } from './units';
import styles from './ruler.module.css';

export interface RulerBarProps {
  unit: RulerUnit;
  /** The page's zoom, 1 for 100 percent. */
  zoom: number;
  /** The width of the block's content box, in points. */
  width: number;
  indent: Indent;
  tabs: readonly TabStop[];
  tabType: TabType;
  onTabType(type: TabType): void;
  onUnit(unit: RulerUnit): void;
  onIndent(next: Indent): void;
  onTabs(next: TabStop[]): void;
}

export interface Marker {
  id: string;
  kind: MarkerKind;
  /** Points from the left edge of the content box, as drawn. */
  at: number;
  /** The tab stop, for a tab marker. */
  tab?: TabStop;
}

interface Press {
  marker: Marker | null;
  pointer: number;
  x: number;
  y: number;
  started: boolean;
}

/** Where each marker's glyph sits in the band, as a fraction of its height: the three indent parts stack. */
const GLYPH_Y: Readonly<Record<MarkerKind, number>> = { first: 0.2, hanging: 0.55, left: 0.85, right: 0.55, tab: 0.85 };

export function markersOf(indent: Indent, tabs: readonly TabStop[], width: number): Marker[] {
  const out: Marker[] = [
    { id: 'first', kind: 'first', at: firstLineAt(indent) },
    { id: 'hanging', kind: 'hanging', at: indent.start },
    { id: 'left', kind: 'left', at: indent.start },
    { id: 'right', kind: 'right', at: width - indent.end },
  ];
  for (const tab of tabs) if (tab.align !== 'clear') out.push({ id: `tab:${tab.pos}`, kind: 'tab', at: tab.pos, tab });
  return out;
}

/** The marker under a pointer: within half a hit area sideways, then the one whose glyph is nearest vertically. */
export function pickMarker(
  markers: readonly Marker[],
  x: number,
  y: number,
  height: number,
  zoom: number,
): Marker | null {
  let best: Marker | null = null;
  let bestDistance = Infinity;
  for (const marker of markers) {
    const dx = Math.abs(pointsToPixels(marker.at, zoom) - x);
    if (dx > HIT_PX / 2) continue;
    const distance = Math.abs(GLYPH_Y[marker.kind] * height - y) + dx / 100;
    if (distance < bestDistance) {
      best = marker;
      bestDistance = distance;
    }
  }
  return best;
}

function markerName(marker: Marker): string {
  if (marker.kind === 'tab') {
    return t('textRuler.marker.tab', { type: t(`textRuler.tabName.${marker.tab!.align}` as MessageKey) });
  }
  return t(`textRuler.marker.${marker.kind}` as MessageKey);
}

/** The value a marker shows, in points: indents from their own edge, tab stops from the left. */
function shownPoints(marker: Marker, at: number, width: number): number {
  return marker.kind === 'right' ? width - at : at;
}

export function valueText(points: number, unit: RulerUnit): string {
  return t(`textRuler.value.${unit}` as 'textRuler.value.in', { n: Number(shownNumber(points, unit)) });
}

/** The tick marks and the numbers, from the left edge of the content box. */
function Ticks({ unit, zoom, width }: Pick<RulerBarProps, 'unit' | 'zoom' | 'width'>) {
  const { major, parts } = TICKS[unit];
  const perMajor = major / fromPoints(1, unit);
  const count = Math.floor((width / perMajor) * parts);
  const marks = [];
  for (let i = 0; i <= count; i++) {
    const points = (i * perMajor) / parts;
    const whole = i % parts === 0;
    const half = parts % 2 === 0 && i % (parts / 2) === 0;
    marks.push({
      x: pointsToPixels(points, zoom),
      size: whole ? 'major' : half ? 'half' : 'minor',
      label: whole && i > 0 ? String(Math.round(fromPoints(points, unit))) : undefined,
    });
  }
  const top = { major: '55%', half: '70%', minor: '80%' } as const;
  return (
    <svg
      className={styles.ticks}
      aria-hidden="true"
      focusable="false"
      width={pointsToPixels(width, zoom)}
      height="100%"
    >
      {marks.map((mark) => (
        <g key={mark.x}>
          <line className={styles.tick} x1={mark.x} x2={mark.x} y1="100%" y2={top[mark.size as keyof typeof top]} />
          {mark.label && (
            <text className={styles.tickText} x={mark.x + 2} y="50%">
              {mark.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

interface Edits {
  commit(marker: Marker, at: number): void;
  addAt(x: number): void;
  remove(marker: Marker): void;
}

/** What a marker or a click does to the paragraph, each as one change with the new value announced. */
function useEdits(props: RulerBarProps, grid: number): Edits {
  const { unit, zoom, width, indent, tabs, tabType } = props;
  const remove = (marker: Marker) => {
    props.onTabs(withoutTab(tabs, marker.tab!.pos));
    announce(t('textRuler.removed', { name: markerName(marker) }));
  };

  /** A marker ends at `at` points from the left edge. */
  const commit = (marker: Marker, at: number) => {
    if (marker.kind === 'tab') {
      const target = roundPoints(clamp(at, 0, width));
      if (target === marker.tab!.pos) return;
      props.onTabs(movedTab(tabs, marker.tab!.pos, target));
      announce(t('textRuler.announced', { name: markerName(marker), value: valueText(target, unit) }));
      return;
    }
    const next = movedIndent(marker.kind, indent, marker.kind === 'right' ? width - at : at, width);
    if (JSON.stringify(next) === JSON.stringify(indent)) return;
    props.onIndent(next);
    const value = marker.kind === 'right' ? next.end : marker.kind === 'first' ? firstLineAt(next) : next.start;
    announce(t('textRuler.announced', { name: markerName(marker), value: valueText(value, unit) }));
  };

  /** A click on the bare ruler adds a stop of the selected type, or sets the indent for the two indent types. */
  const addAt = (x: number) => {
    const at = roundPoints(clamp(dragValue(0, x, zoom, grid, false), 0, width));
    if (tabType === 'first' || tabType === 'hanging') return props.onIndent(movedIndent(tabType, indent, at, width));
    if (!isTabAlign(tabType)) return;
    const next = withTab(tabs, { pos: at, align: tabType, leader: 'none' });
    if (!next) return;
    props.onTabs(next);
    announce(
      t('textRuler.added', { name: t(`textRuler.tabName.${tabType}` as MessageKey), value: valueText(at, unit) }),
    );
  };
  return { commit, addAt, remove };
}

/** The arrow keys move a marker one step of the grid (Alt: half a point; Shift: four steps); Home and End go to the ends. */
function markerKey(marker: Marker, edits: Edits, grid: number, width: number) {
  return (event: KeyboardEvent) => {
    const step = (event.altKey ? 0.5 : grid) * (event.shiftKey ? 4 : 1);
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowUp';
    const back = event.key === 'ArrowLeft' || event.key === 'ArrowDown';
    if (forward || back) edits.commit(marker, clamp(roundPoints(marker.at + (forward ? step : -step)), 0, width));
    else if (event.key === 'Home') edits.commit(marker, 0);
    else if (event.key === 'End') edits.commit(marker, width);
    else if ((event.key === 'Delete' || event.key === 'Backspace') && marker.kind === 'tab') edits.remove(marker);
    else return;
    event.preventDefault();
  };
}

/** The track's pointer handling: pick a marker, start a drag past the threshold, and commit on release. */
function useTrackPointer(props: RulerBarProps, markers: readonly Marker[], edits: Edits, grid: number) {
  const { zoom, width } = props;
  const track = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const [drag, setDrag] = useState<{ id: string; at: number } | null>(null);
  const local = (event: PointerEvent) => {
    const box = track.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top, height: box.height };
  };
  const end = () => {
    press.current = null;
    setDrag(null);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !track.current) return;
    const { x, y, height } = local(event);
    const marker = pickMarker(markers, x, y, height, zoom);
    press.current = { marker, pointer: event.pointerId, x: event.clientX, y: event.clientY, started: false };
    capture(track.current, event.pointerId, true);
    if (marker) track.current.querySelector<HTMLElement>(`[data-marker="${marker.id}"]`)?.focus();
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent) => {
    const current = press.current;
    if (current?.pointer !== event.pointerId) return;
    const dx = event.clientX - current.x;
    // A press that stays within the threshold is a tap: nothing moves.
    if (!current.started && Math.hypot(dx, event.clientY - current.y) < DRAG_THRESHOLD_PX) return;
    current.started = true;
    if (!current.marker) return;
    const at = clamp(dragValue(current.marker.at, dx, zoom, grid, event.altKey), 0, width);
    setDrag({ id: current.marker.id, at });
  };

  const onPointerUp = (event: PointerEvent) => {
    const current = press.current;
    if (current?.pointer !== event.pointerId) return;
    capture(track.current, event.pointerId, false);
    end();
    const { marker } = current;
    if (!current.started) return marker ? undefined : edits.addAt(local(event).x);
    if (!marker) return;
    const box = local(event);
    // A tab stop dragged off the ruler, above, or below it, is removed.
    const outside = box.y < 0 ? box.y : box.y > box.height ? box.y - box.height : 0;
    if (marker.kind === 'tab' && offRuler(outside)) return edits.remove(marker);
    edits.commit(marker, clamp(dragValue(marker.at, event.clientX - current.x, zoom, grid, event.altKey), 0, width));
  };

  return { track, drag, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: end } };
}

interface MarkerViewProps {
  marker: Marker;
  at: number;
  dragging: boolean;
  unit: RulerUnit;
  zoom: number;
  width: number;
  onKeyDown(event: KeyboardEvent): void;
}

/** A marker: a slider with its value in the unit, and a 44 px box that is a target for pen and touch. */
function MarkerView({ marker, at, dragging, unit, zoom, width, onKeyDown }: MarkerViewProps) {
  const shown = shownPoints(marker, at, width);
  return (
    <span
      data-marker={marker.id}
      data-kind={marker.kind}
      data-align={marker.tab?.align}
      data-dragging={dragging ? '' : undefined}
      role="slider"
      tabIndex={0}
      aria-orientation="horizontal"
      aria-label={markerName(marker)}
      aria-valuemin={0}
      aria-valuemax={Number(fromPoints(width, unit).toFixed(2))}
      aria-valuenow={Number(shownNumber(shown, unit))}
      aria-valuetext={valueText(shown, unit)}
      className={styles.marker}
      style={{ insetInlineStart: pointsToPixels(at, zoom) - HIT_PX / 2, inlineSize: HIT_PX, blockSize: HIT_PX }}
      onKeyDown={onKeyDown}
    >
      <i className={styles.glyph} aria-hidden="true" />
    </span>
  );
}

export function RulerBar(props: RulerBarProps) {
  const { unit, zoom, width, indent, tabs, tabType } = props;
  const grid = snapPoints(unit);
  const markers = markersOf(indent, tabs, width);
  const edits = useEdits(props, grid);
  const { track, drag, handlers } = useTrackPointer(props, markers, edits, grid);
  const nextType = TAB_TYPES[(TAB_TYPES.indexOf(tabType) + 1) % TAB_TYPES.length];
  return (
    <div className={styles.bar} role="group" aria-label={t('textRuler.label')} data-ruler>
      <button
        type="button"
        className={styles.selector}
        title={t('textRuler.tabTypeHint')}
        aria-label={t('textRuler.tabTypeLabel')}
        onClick={() => props.onTabType(nextType)}
      >
        {t(`textRuler.tabType.${tabType}` as MessageKey)}
      </button>
      <div
        ref={track}
        className={styles.track}
        data-track
        style={{ inlineSize: pointsToPixels(width, zoom) }}
        {...handlers}
      >
        <Ticks unit={unit} zoom={zoom} width={width} />
        {markers.map((marker) => (
          <MarkerView
            key={marker.id}
            marker={marker}
            at={drag?.id === marker.id ? drag.at : marker.at}
            dragging={drag?.id === marker.id}
            unit={unit}
            zoom={zoom}
            width={width}
            onKeyDown={markerKey(marker, edits, grid, width)}
          />
        ))}
      </div>
      <select
        className={styles.units}
        aria-label={t('textRuler.unitLabel')}
        value={unit}
        onChange={(event) => props.onUnit(event.target.value as RulerUnit)}
      >
        {RULER_UNITS.map((u) => (
          <option key={u} value={u}>
            {t(`textRuler.unitName.${u}` as MessageKey)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Pointer capture keeps a drag going outside the track; a pointer the browser no longer knows is no error. */
function capture(element: HTMLElement | null, pointer: number, on: boolean): void {
  try {
    if (on) element?.setPointerCapture(pointer);
    else element?.releasePointerCapture(pointer);
  } catch {
    /* the pointer ended already */
  }
}
