// The function grapher on screen (Phase 10). It draws the scene the grapher engine builds, and takes zoom and pan from
// the wheel, a drag, the keyboard, and the buttons. A readout follows the pointer (or Shift and the arrow keys) and
// gives the value and the slope. Each letter a function uses besides x gets a slider. The graph's whole state is its
// text (source.ts), so every change goes out as new text and undo, copy, and export follow from that.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, RefObject, WheelEvent } from 'react';
import { t } from '../../../strings/t';
import {
  buildScene,
  defaultViewport,
  findParameters,
  panByPixels,
  toWorld,
  wheelZoomFactor,
  zoomAround,
} from '../grapher';
import type { Viewport } from '../grapher';
import styles from './graph.module.css';
import { FunctionBoxes, PlotLayers, SIZE, Sliders, ZoomButtons, keyEffect, readoutText, traceAt } from './parts';
import { readGraph, writeGraph } from './source';
import type { GraphSource } from './source';

const COMMIT_MS = 450;

export interface GraphViewProps {
  source: string;
  editable: boolean;
  onSource(next: string): void;
}

/** The letters that need a slider, with their values (1 until the text says otherwise). */
function useParameters(graph: GraphSource) {
  const names = useMemo(() => {
    const found = new Set<string>(Object.keys(graph.params));
    for (const line of graph.functions) for (const name of findParameters(line)) found.add(name);
    return [...found];
  }, [graph]);
  const values = useMemo(
    () => Object.fromEntries(names.map((name) => [name, graph.params[name] ?? 1])),
    [names, graph],
  );
  return { names, values };
}

interface InputState {
  svg: RefObject<SVGSVGElement | null>;
  drag: RefObject<{ x: number; y: number } | null>;
  view: Viewport;
  live: Viewport | null;
  editable: boolean;
  traceX: number | null;
  setTraceX(x: number | null): void;
  setLive(view: Viewport | null): void;
  commit(view: Viewport, delay?: number): void;
}

/** What the pointer, the wheel, and the keys do to the plot. */
function usePlotInput({ svg, drag, view, live, editable, traceX, setTraceX, setLive, commit }: InputState) {
  // The pointer's place on the plot in pixels of the plot, whatever size the page draws it at.
  const plotPixel = (event: { clientX: number; clientY: number }) => {
    const box = svg.current!.getBoundingClientRect();
    const k = SIZE.width / box.width;
    return { x: (event.clientX - box.left) * k, y: (event.clientY - box.top) * k, k };
  };
  const worldAt = (event: { clientX: number; clientY: number }) => toWorld(view, SIZE, plotPixel(event));

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    drag.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const from = drag.current;
    if (!from) return setTraceX(worldAt(event).x);
    const { k } = plotPixel(event);
    drag.current = { x: event.clientX, y: event.clientY };
    setLive(panByPixels(view, SIZE, (event.clientX - from.x) * k, (event.clientY - from.y) * k));
  };
  const onPointerUp = () => {
    if (drag.current && live) commit(live);
    drag.current = null;
  };
  const onWheel = (event: WheelEvent<SVGSVGElement>) => {
    if (editable) commit(zoomAround(view, worldAt(event), wheelZoomFactor(event.deltaY)), COMMIT_MS);
  };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const effect = keyEffect(event, view, traceX);
    if (!effect) return;
    if ('view' in effect) commit(effect.view);
    else setTraceX(effect.trace);
    event.preventDefault();
  };
  return { onPointerDown, onPointerMove, onPointerUp, onWheel, onKeyDown };
}

export function GraphView({ source, editable, onSource }: GraphViewProps) {
  const graph = useMemo(() => readGraph(source), [source]);
  // A view being dragged or zoomed belongs to the text it began from, so new text brings back its own view.
  const [liveState, setLiveState] = useState<{ source: string; view: Viewport } | null>(null);
  const live = liveState?.source === source ? liveState.view : null;
  const setLive = (next: Viewport | null) => setLiveState(next && { source, view: next });
  const [traceX, setTraceX] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const view = live ?? graph.view ?? defaultViewport(SIZE, 20);
  const { names, values } = useParameters(graph);
  const scene = useMemo(
    () =>
      buildScene(
        view,
        SIZE,
        graph.functions.map((line) => ({ source: line, params: values })),
      ),
    [view, graph.functions, values],
  );
  const trace = useMemo(
    () => traceAt(traceX, graph.functions, names, values),
    [traceX, graph.functions, names, values],
  );

  const send = (next: Partial<GraphSource>, nextView: Viewport | null = view) =>
    onSource(writeGraph({ ...graph, ...next, view: nextView }));
  const commit = (nextView: Viewport, delay = 0) => {
    setLive(nextView);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => send({}, nextView), delay);
  };

  const { onPointerDown, onPointerMove, onPointerUp, onWheel, onKeyDown } = usePlotInput({
    svg,
    drag,
    view,
    live,
    editable,
    traceX,
    setTraceX,
    setLive,
    commit,
  });

  return (
    <div className={styles.graph}>
      <FunctionBoxes graph={graph} scene={scene} editable={editable} onFunctions={(functions) => send({ functions })} />
      <svg
        ref={svg}
        className={styles.plot}
        viewBox={`0 0 ${SIZE.width} ${SIZE.height}`}
        role="application"
        tabIndex={0}
        aria-label={t('smart.grapher.label', { count: graph.functions.length })}
        aria-roledescription={t('smart.grapher.role')}
        aria-description={t('smart.grapher.keys')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setTraceX(null)}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        <PlotLayers scene={scene} trace={trace} />
      </svg>
      <p className={styles.readout} aria-live="polite">
        {readoutText(trace)}
      </p>
      <Sliders
        names={names}
        values={values}
        editable={editable}
        onValue={(name, value) => send({ params: { ...graph.params, [name]: value } })}
      />
      <ZoomButtons view={view} onView={(next) => commit(next)} />
    </div>
  );
}
