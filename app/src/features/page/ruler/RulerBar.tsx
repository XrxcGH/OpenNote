// The ruler itself (text DESIGN.md 5.4): the markers, the tab stops, and the pointer and keyboard moves that change
// them. It knows nothing of the editor. It takes the paragraph's indent and tab stops, and hands back the new ones.
// One drag is one change on release, so one Ctrl+Z undoes it. Every marker is a slider with a value in the unit.
// The arrow keys move it one step of the snap grid. In a right-to-left paragraph the whole bar is mirrored.
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
  markerLimits,
  movedIndent,
  movedTab,
  offRuler,
  pointsToPixels,
  withTab,
  withoutTab,
} from './geometry';
import type { Limits, MarkerKind, TabType } from './geometry';
import { isPalm, useWatchPen } from './palm';
import { RULER_UNITS, fromPoints, roundPoints, shownNumber, snapPoints } from './units';
import type { RulerUnit } from './units';
import { Ticks } from './Ticks';
import styles from './ruler.module.css';

export interface RulerBarProps {
  unit: RulerUnit;
  /** The page's zoom, 1 for 100 percent. */
  zoom: number;
  /** The width of the block's content box, in points. */
  width: number;
  indent: Indent;
  /** A right-to-left paragraph: positions are measured from the right edge, and a drag to the left raises them. */
  rtl?: boolean;
  tabs: readonly TabStop[];
  tabType: TabType;
  onIndent(next: Indent): void;
  onTabs(next: TabStop[]): void;
  /** After a pointer drag or click ends: the host gives focus back to the text. */
  onRelease?(): void;
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

export function valueText(points: number, unit: RulerUnit): string {
  return t(`textRuler.value.${unit}` as 'textRuler.value.in', { n: Number(shownNumber(points, unit)) });
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
    // The announced value is where the marker really ended up, after the limits.
    const landed = markersOf(next, [], width).find((m) => m.kind === marker.kind)!.at;
    announce(t('textRuler.announced', { name: markerName(marker), value: valueText(landed, unit) }));
  };

  /** A click on the bare ruler adds a stop of the selected type, or sets the indent for the two indent types. */
  const addAt = (x: number) => {
    const at = roundPoints(clamp(dragValue(0, x, zoom, grid, false), 0, width));
    if (tabType === 'first' || tabType === 'hanging') {
      props.onIndent(movedIndent(tabType, indent, at, width));
      const name = t(`textRuler.marker.${tabType}` as MessageKey);
      announce(t('textRuler.announced', { name, value: valueText(at, unit) }));
      return;
    }
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

/** Arrow keys move a marker one grid step (Alt: half a point; Shift: four steps); Home and End go to its limits. */
function markerKey(marker: Marker, edits: Edits, grid: number, limits: Limits) {
  return (event: KeyboardEvent) => {
    const step = (event.altKey ? 0.5 : grid) * (event.shiftKey ? 4 : 1);
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowUp';
    const back = event.key === 'ArrowLeft' || event.key === 'ArrowDown';
    if (forward || back) {
      edits.commit(marker, clamp(roundPoints(marker.at + (forward ? step : -step)), limits.min, limits.max));
    } else if (event.key === 'Home') edits.commit(marker, limits.min);
    else if (event.key === 'End') edits.commit(marker, limits.max);
    else if ((event.key === 'Delete' || event.key === 'Backspace') && marker.kind === 'tab') edits.remove(marker);
    else return;
    event.preventDefault();
  };
}

/** The pointer in the track, with x measured from the start edge so a mirrored bar reads like a normal one. */
function localPoint(track: HTMLElement, event: PointerEvent, rtl: boolean | undefined) {
  const box = track.getBoundingClientRect();
  const x = event.clientX - box.left;
  return { x: rtl ? box.width - x : x, y: event.clientY - box.top, height: box.height };
}

function focusMarker(track: HTMLElement, marker: Marker): void {
  track.querySelector<HTMLElement>(`[data-marker="${marker.id}"]`)?.focus();
}

/** What a pointer drag ends with: a tab stop off the ruler is removed, any other marker lands where it was dragged. */
function finishDrag(marker: Marker, edits: Edits, drop: number, at: { y: number; height: number }): void {
  const outside = at.y < 0 ? at.y : at.y > at.height ? at.y - at.height : 0;
  if (marker.kind === 'tab' && offRuler(outside)) edits.remove(marker);
  else edits.commit(marker, drop);
}

/** The track's pointer handling: pick a marker, start a drag past the threshold, and commit on release. */
function useTrackPointer(
  props: RulerBarProps,
  markers: readonly Marker[],
  edits: Edits,
  grid: number,
  limitsOf: (marker: Marker) => Limits,
) {
  const { zoom, rtl } = props;
  useWatchPen();
  const track = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const [drag, setDrag] = useState<{ id: string; at: number } | null>(null);
  const local = (event: PointerEvent) => localPoint(track.current!, event, rtl);
  const dropAt = (marker: Marker, event: PointerEvent, from: number) => {
    const { min, max } = limitsOf(marker);
    return clamp(dragValue(marker.at, (rtl ? -1 : 1) * (event.clientX - from), zoom, grid, event.altKey), min, max);
  };
  const end = () => {
    press.current = null;
    setDrag(null);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !track.current || isPalm(event)) return;
    const { x, y, height } = local(event);
    const marker = pickMarker(markers, x, y, height, zoom);
    press.current = { marker, pointer: event.pointerId, x: event.clientX, y: event.clientY, started: false };
    capture(track.current, event.pointerId, true);
    if (marker) focusMarker(track.current, marker);
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent) => {
    const current = press.current;
    if (current?.pointer !== event.pointerId) return;
    // A press that stays within the threshold is a tap: nothing moves.
    const moved = Math.hypot(event.clientX - current.x, event.clientY - current.y);
    if (!current.started && moved < DRAG_THRESHOLD_PX) return;
    current.started = true;
    if (current.marker) setDrag({ id: current.marker.id, at: dropAt(current.marker, event, current.x) });
  };

  const onPointerUp = (event: PointerEvent) => {
    const current = press.current;
    if (current?.pointer !== event.pointerId) return;
    capture(track.current, event.pointerId, false);
    end();
    const { marker } = current;
    if (current.started && marker) finishDrag(marker, edits, dropAt(marker, event, current.x), local(event));
    else if (!current.started && !marker) edits.addAt(local(event).x);
    // The pointer is done: the text gets focus back, so typing goes on where it was.
    props.onRelease?.();
  };

  return { track, drag, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: end } };
}

interface MarkerViewProps {
  marker: Marker;
  at: number;
  dragging: boolean;
  unit: RulerUnit;
  zoom: number;
  limits: Limits;
  onKeyDown(event: KeyboardEvent): void;
}

/** A marker: a slider with its value in the unit, and a 44 px box that is a target for pen and touch. */
function MarkerView({ marker, at, dragging, unit, zoom, limits, onKeyDown }: MarkerViewProps) {
  // Every marker shows its place from the start edge. ArrowRight raises the value of all of them, the right indent
  // included. Home and End are the minimum and the maximum.
  const shown = at;
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
      aria-valuemin={Number(fromPoints(limits.min, unit).toFixed(2))}
      aria-valuemax={Number(fromPoints(limits.max, unit).toFixed(2))}
      aria-valuenow={Number(shownNumber(shown, unit))}
      aria-valuetext={valueText(shown, unit)}
      className={styles.marker}
      style={{ insetInlineStart: pointsToPixels(at, zoom) - HIT_PX / 2, inlineSize: HIT_PX, blockSize: HIT_PX }}
      onKeyDown={onKeyDown}
    >
      <i className={styles.glyph} aria-hidden="true" />
      <i className={styles.ring} aria-hidden="true" />
    </span>
  );
}

/** The tab-type selector: it sits in the ruler's margin, outside the part that follows the text. */
export function TabTypeButton({ tabType, onTabType }: { tabType: TabType; onTabType(type: TabType): void }) {
  const nextType = TAB_TYPES[(TAB_TYPES.indexOf(tabType) + 1) % TAB_TYPES.length];
  return (
    <button
      type="button"
      className={styles.selector}
      title={t('textRuler.tabTypeHint')}
      aria-label={t('textRuler.tabTypeLabel')}
      onClick={() => onTabType(nextType)}
    >
      {t(`textRuler.tabType.${tabType}` as MessageKey)}
    </button>
  );
}

/** The units choice, outside the part that follows the text. */
export function UnitSelect({ unit, onUnit }: { unit: RulerUnit; onUnit(unit: RulerUnit): void }) {
  return (
    <select
      className={styles.units}
      aria-label={t('textRuler.unitLabel')}
      value={unit}
      onChange={(event) => onUnit(event.target.value as RulerUnit)}
    >
      {RULER_UNITS.map((u) => (
        <option key={u} value={u}>
          {t(`textRuler.unitName.${u}` as MessageKey)}
        </option>
      ))}
    </select>
  );
}

/** The track: its left edge is the left edge of the content box, so the host places it where the text starts. */
export function RulerBar(props: RulerBarProps) {
  const { unit, zoom, width, indent, tabs, rtl } = props;
  const grid = snapPoints(unit);
  const markers = markersOf(indent, tabs, width);
  const edits = useEdits(props, grid);
  const limitsOf = (marker: Marker) => markerLimits(marker.kind, indent, width);
  const { track, drag, handlers } = useTrackPointer(props, markers, edits, grid, limitsOf);
  return (
    <div className={styles.bar} role="group" aria-label={t('textRuler.label')} data-ruler>
      <div
        ref={track}
        className={styles.track}
        data-track
        dir={rtl ? 'rtl' : 'ltr'}
        style={{ inlineSize: pointsToPixels(width, zoom) }}
        {...handlers}
      >
        <Ticks unit={unit} zoom={zoom} width={width} rtl={rtl} />
        {markers.map((marker) => (
          <MarkerView
            key={marker.id}
            marker={marker}
            at={drag?.id === marker.id ? drag.at : marker.at}
            dragging={drag?.id === marker.id}
            unit={unit}
            zoom={zoom}
            limits={limitsOf(marker)}
            onKeyDown={markerKey(marker, edits, grid, limitsOf(marker))}
          />
        ))}
      </div>
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
