// The 3D grapher on screen: surfaces such as z = sin(x) cos(y), and curves and surfaces traced by t, or by u and v.
// Drag, the arrow keys, or the buttons turn it; the wheel, plus, and minus zoom. Like the 2D grapher its whole state
// is its text (source.ts), so a turn goes out as an "@camera" line and undo, copy, and export follow from that.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, WheelEvent } from 'react';
import { t } from '../../../strings/t';
import { Button } from '../../../ui';
import { wheelZoomFactor } from '../grapher';
import { DEFAULT_DOMAIN, plotParameters, samplePlot } from '../grapher3d/plot';
import {
  DEFAULT_CAMERA,
  boundsOf,
  buildScene3d,
  faceOpacity,
  rotateCamera,
  tickText,
  zoomCamera,
} from '../grapher3d/scene';
import type { Camera, Scene3d } from '../grapher3d/scene';
import styles from './graph.module.css';
import { FunctionBoxes, PENS, SIZE, Sliders } from './parts';
import { writeGraph } from './source';
import type { GraphSource } from './source';

const COMMIT_MS = 450;
const STEP = (15 * Math.PI) / 180;
/** Radians of turn for each pixel dragged. */
const DRAG = 0.01;

export interface Graph3DViewProps {
  graph: GraphSource;
  editable: boolean;
  onSource(next: string): void;
}

/** What a key does to the camera, or null when the key is not for the plot. */
export function cameraKey(key: string, camera: Camera): Camera | null {
  switch (key) {
    case 'ArrowLeft':
      return rotateCamera(camera, -STEP, 0);
    case 'ArrowRight':
      return rotateCamera(camera, STEP, 0);
    case 'ArrowUp':
      return rotateCamera(camera, 0, STEP);
    case 'ArrowDown':
      return rotateCamera(camera, 0, -STEP);
    case '+':
    case '=':
      return zoomCamera(camera, 1.25);
    case '-':
      return zoomCamera(camera, 0.8);
    case '0':
      return DEFAULT_CAMERA;
    default:
      return null;
  }
}

/** The faces, lines, and labels of the picture, colored with the brand's pens. */
export function Plot3dLayers({ scene }: { scene: Scene3d }) {
  const pen = (plot: number) => `var(${PENS[plot % PENS.length]})`;
  return (
    <>
      <rect width={SIZE.width} height={SIZE.height} className={styles.paper} />
      {scene.lines
        .filter((line) => line.kind !== 'curve')
        .map((line, index) => (
          <path key={`f${index}`} d={line.d} className={line.kind === 'axis' ? styles.axis3d : styles.box3d} />
        ))}
      {scene.faces.map((face, index) => (
        <polygon
          key={index}
          points={face.points}
          className={styles.face}
          style={{ fill: pen(face.plot), fillOpacity: faceOpacity(face.light) }}
        />
      ))}
      {scene.lines
        .filter((line) => line.kind === 'curve')
        .map((line, index) => (
          <path key={`c${index}`} d={line.d} className={styles.curve} style={{ stroke: pen(line.plot) }} />
        ))}
      {scene.labels.map((label, index) => (
        <text key={`l${index}`} className={styles.label} x={label.x} y={label.y} textAnchor="middle">
          {label.text}
        </text>
      ))}
    </>
  );
}

/** The plot's samples and picture for a graph's text and a camera. Sampling waits for new text, not a new camera. */
function usePlot(graph: GraphSource, camera: Camera) {
  const names = useMemo(() => {
    const found = new Set<string>(Object.keys(graph.params));
    for (const line of graph.functions) for (const name of plotParameters(line)) found.add(name);
    return [...found];
  }, [graph]);
  const values = useMemo(
    () => Object.fromEntries(names.map((name) => [name, graph.params[name] ?? 1])),
    [names, graph],
  );
  const domain = graph.view ?? DEFAULT_DOMAIN;
  const samples = useMemo(
    () =>
      graph.functions.map((line) =>
        samplePlot({ source: line, params: values }, { domain, ranges: graph.ranges ?? {}, grid: 32 }),
      ),
    [graph.functions, graph.ranges, values, domain],
  );
  const bounds = useMemo(() => boundsOf(samples, domain), [samples, domain]);
  const scene = useMemo(() => buildScene3d(samples, camera, SIZE, bounds), [samples, camera, bounds]);
  return { names, values, bounds, scene };
}

/**
 * The camera: the one the text saved, or the one being dragged. A drag shows at once and is saved when it ends; a
 * key or a button is saved at once, and the wheel a moment after it stops.
 */
function useCamera(graph: GraphSource, editable: boolean, save: (camera: Camera) => void) {
  const [liveState, setLiveState] = useState<{ graph: GraphSource; camera: Camera } | null>(null);
  const live = liveState?.graph === graph ? liveState.camera : null;
  const camera = live ?? graph.camera ?? DEFAULT_CAMERA;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = (next: Camera, delay = 0) => {
    setLiveState({ graph, camera: next });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(next), delay);
  };
  const handlers = {
    onPointerDown: (event: PointerEvent<SVGSVGElement>) => {
      drag.current = { x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<SVGSVGElement>) => {
      const from = drag.current;
      if (!from) return;
      drag.current = { x: event.clientX, y: event.clientY };
      const turn = rotateCamera(camera, (event.clientX - from.x) * DRAG, (event.clientY - from.y) * DRAG);
      setLiveState({ graph, camera: turn });
    },
    onPointerUp: () => {
      if (drag.current && live) commit(live);
      drag.current = null;
    },
    onWheel: (event: WheelEvent<SVGSVGElement>) => {
      if (editable) commit(zoomCamera(camera, wheelZoomFactor(event.deltaY)), COMMIT_MS);
    },
    onKeyDown: (event: KeyboardEvent<SVGSVGElement>) => {
      const next = cameraKey(event.key, camera);
      if (!next) return;
      commit(next);
      event.preventDefault();
    },
  };
  return { camera, commit, handlers };
}

/** Buttons that turn, tilt, zoom, and reset, for a pointer or a screen reader. */
function CameraButtons({ camera, onCamera }: { camera: Camera; onCamera(next: Camera): void }) {
  const buttons: [string, Camera][] = [
    [t('mathTools.graph3d.turnLeft'), rotateCamera(camera, -STEP, 0)],
    [t('mathTools.graph3d.turnRight'), rotateCamera(camera, STEP, 0)],
    [t('mathTools.graph3d.tiltUp'), rotateCamera(camera, 0, STEP)],
    [t('mathTools.graph3d.tiltDown'), rotateCamera(camera, 0, -STEP)],
    [t('smart.grapher.zoomIn'), zoomCamera(camera, 1.25)],
    [t('smart.grapher.zoomOut'), zoomCamera(camera, 0.8)],
    [t('smart.grapher.reset'), DEFAULT_CAMERA],
  ];
  return (
    <div className={styles.buttons}>
      {buttons.map(([label, next]) => (
        <Button key={label} variant="quiet" onClick={() => onCamera(next)}>
          {label}
        </Button>
      ))}
    </div>
  );
}

export function Graph3DView({ graph, editable, onSource }: Graph3DViewProps) {
  const save = (next: Partial<GraphSource>, camera: Camera) =>
    onSource(writeGraph({ ...graph, three: true, camera, ...next }));
  const { camera, commit, handlers } = useCamera(graph, editable, (next) => save({}, next));
  const send = (next: Partial<GraphSource>) => save(next, camera);
  const { names, values, bounds, scene } = usePlot(graph, camera);
  const [x, y, z] = [bounds.x, bounds.y, bounds.z].map(([lo, hi]) => ({ lo: tickText(lo), hi: tickText(hi) }));
  const degrees = (radians: number) => Math.round((radians * 180) / Math.PI);
  return (
    <div className={styles.graph} data-graph-3d="">
      <FunctionBoxes
        graph={graph}
        problems={scene.errors}
        editable={editable}
        addLine="z = x y"
        onFunctions={(functions) => send({ functions })}
      />
      <svg
        className={styles.plot}
        viewBox={`0 0 ${SIZE.width} ${SIZE.height}`}
        role="application"
        tabIndex={0}
        aria-label={t('mathTools.graph3d.label', { count: graph.functions.length })}
        aria-roledescription={t('mathTools.graph3d.role')}
        aria-description={t('mathTools.graph3d.keys')}
        {...handlers}
        onPointerCancel={handlers.onPointerUp}
      >
        <Plot3dLayers scene={scene} />
      </svg>
      <p className={styles.readout} aria-live="polite">
        {t('mathTools.graph3d.readout', {
          xLo: x.lo,
          xHi: x.hi,
          yLo: y.lo,
          yHi: y.hi,
          zLo: z.lo,
          zHi: z.hi,
          turn: degrees(camera.yaw),
          tilt: degrees(camera.pitch),
        })}
      </p>
      <Sliders
        names={names}
        values={values}
        editable={editable}
        onValue={(name, value) => send({ params: { ...graph.params, [name]: value } })}
      />
      <CameraButtons camera={camera} onCamera={(next) => commit(next)} />
    </div>
  );
}
