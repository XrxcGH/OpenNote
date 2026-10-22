// The Projectile simulator tool window: speed, angle, launch height, gravity, and linear drag in; the trajectory,
// time of flight, range, highest point, and landing speed out. Launch flies a ball along the path in real time (at
// most four seconds), unless the system asks for reduced motion, when the ball waits at the landing point and the
// slider moves it. "Insert into page" adds the values as text and the path as a parametric graph block.
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../../../strings/t';
import { Button } from '../../../../ui';
import { PlotLayers, SIZE, show } from '../../graph/parts';
import { prefersReducedMotion } from '../../graph/curveTrace';
import { readGraph } from '../../graph/source';
import { buildScene, toPixel } from '../../grapher';
import {
  EARTH_GRAVITY,
  flight,
  positionAt,
  trajectoryGraph,
  validLaunch,
  type Flight,
  type Launch,
} from '../projectile';
import { readNumber } from '../vec';
import { InsertResult, NumberField } from './common';
import styles from './lab.module.css';

const MAX_PLAY_MS = 4000;

type Fields = Record<'speed' | 'angle' | 'height' | 'gravity' | 'drag', string>;
const FIRST: Fields = { speed: '20', angle: '45', height: '0', gravity: String(EARTH_GRAVITY), drag: '0' };

/** The ball's time: none before Launch, then running to the landing in real time (at most four seconds). */
function usePlayback(result: Flight | null) {
  const [time, setTime] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const frame = useRef(0);
  useEffect(() => {
    if (!playing || !result) return;
    const start = performance.now();
    const length = Math.min(MAX_PLAY_MS, result.time * 1000);
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / length);
      setTime(k * result.time);
      if (k < 1) frame.current = requestAnimationFrame(step);
      else setPlaying(false);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [playing, result]);
  return {
    time,
    launch: () => {
      if (!result) return;
      if (prefersReducedMotion()) setTime(result.time);
      else setPlaying(true);
    },
    seek: (next: number | null) => {
      setPlaying(false);
      setTime(next);
    },
  };
}

function LaunchFields({ fields, onField }: { fields: Fields; onField(name: keyof Fields, value: string): void }) {
  const field = (name: keyof Fields, hint?: string) => (
    <NumberField
      label={t(`graph3d.tools.projectile.${name}`)}
      value={fields[name]}
      onChange={(value) => onField(name, value)}
      {...(hint ? { hint } : {})}
    />
  );
  return (
    <div className={styles.fields}>
      {field('speed')}
      {field('angle')}
      {field('height')}
      {field('gravity')}
      {field('drag', t('graph3d.tools.projectile.dragHint'))}
    </div>
  );
}

/** The path on the grapher's grid and axes, with the ball where it is at `time`. */
function FlightPlot({ graph, launch, time }: { graph: string; launch: Launch; time: number | null }) {
  const parsed = useMemo(() => readGraph(graph), [graph]);
  const scene = useMemo(
    () => (parsed.view ? buildScene(parsed.view, SIZE, [{ source: parsed.functions[0], t: parsed.t! }]) : null),
    [parsed],
  );
  if (!scene || !parsed.view) return null;
  const ball = time === null ? null : toPixel(parsed.view, SIZE, positionAt(launch, time));
  return (
    <svg
      className={styles.plot}
      viewBox={`0 0 ${SIZE.width} ${SIZE.height}`}
      role="img"
      aria-label={t('graph3d.tools.projectile.plotLabel')}
    >
      <PlotLayers scene={scene} trace={null} />
      {ball ? <circle className={styles.ball} cx={ball.x} cy={ball.y} r={7} /> : null}
    </svg>
  );
}

function flightValues(result: Flight): string[] {
  return [
    t('graph3d.tools.projectile.flight', { value: show(result.time) }),
    t('graph3d.tools.projectile.range', { value: show(result.range) }),
    t('graph3d.tools.projectile.peak', { value: show(result.peakHeight), time: show(result.peakTime) }),
    t('graph3d.tools.projectile.impact', { value: show(result.impactSpeed) }),
  ];
}

export function ProjectileTool() {
  const [fields, setFields] = useState<Fields>(FIRST);
  const launch: Launch = useMemo(
    () => ({
      speed: readNumber(fields.speed),
      angle: readNumber(fields.angle),
      height: readNumber(fields.height),
      gravity: readNumber(fields.gravity),
      drag: readNumber(fields.drag),
    }),
    [fields],
  );
  const ok = validLaunch(launch);
  const result = useMemo(() => (ok ? flight(launch) : null), [ok, launch]);
  const graph = useMemo(() => (ok ? trajectoryGraph(launch) : null), [ok, launch]);
  const playback = usePlayback(result);
  const time = playback.time === null || !result ? null : Math.min(playback.time, result.time);
  const at = time === null ? null : positionAt(launch, time);
  const values = result ? flightValues(result) : [];
  const title = t('graph3d.tools.projectile.graphTitle', fields);

  return (
    <div className={styles.tool}>
      <LaunchFields
        fields={fields}
        onField={(name, value) => {
          setFields((current) => ({ ...current, [name]: value }));
          playback.seek(null);
        }}
      />
      {!ok ? (
        <p className={styles.problem} role="status">
          {t('graph3d.tools.projectile.bad')}
        </p>
      ) : null}
      {result && graph ? (
        <>
          <ul className={styles.list} aria-label={t('graph3d.tools.projectile.title')}>
            {values.map((value) => (
              <li key={value}>{value}</li>
            ))}
          </ul>
          <FlightPlot graph={graph} launch={launch} time={time} />
          <label className={styles.number}>
            <span>{t('graph3d.trace.slider')}</span>
            <input
              type="range"
              min={0}
              max={result.time}
              step={result.time / 200}
              value={time ?? 0}
              onChange={(event) => playback.seek(Number(event.target.value))}
            />
          </label>
          <p className={styles.note} aria-live="polite">
            {at && time !== null
              ? t('graph3d.tools.projectile.position', { t: show(time), x: show(at.x), y: show(at.y) })
              : ''}
          </p>
          <div className={styles.actions}>
            <Button variant="quiet" onClick={playback.launch}>
              {time === null ? t('graph3d.tools.projectile.launch') : t('graph3d.tools.projectile.replay')}
            </Button>
            <InsertResult text={`${title}. ${values.join('. ')}.`} graph={graph} />
          </div>
        </>
      ) : null}
    </div>
  );
}
