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
import { EARTH_GRAVITY, flight, positionAt, trajectoryGraph, validLaunch, type Launch } from '../projectile';
import { readNumber } from '../vec';
import { InsertResult, NumberField } from './common';
import styles from './lab.module.css';

const MAX_PLAY_MS = 4000;

export function ProjectileTool() {
  const [fields, setFields] = useState({
    speed: '20',
    angle: '45',
    height: '0',
    gravity: String(EARTH_GRAVITY),
    drag: '0',
  });
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

  const launchNow = () => {
    if (!result) return;
    if (prefersReducedMotion()) setTime(result.time);
    else setPlaying(true);
  };
  const set = (name: keyof typeof fields) => (value: string) => {
    setFields((current) => ({ ...current, [name]: value }));
    setTime(null);
    setPlaying(false);
  };

  const parsed = graph ? readGraph(graph) : null;
  const scene = useMemo(
    () => (parsed?.view ? buildScene(parsed.view, SIZE, [{ source: parsed.functions[0], t: parsed.t! }]) : null),
    // The graph text is the whole input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph],
  );
  const at = time !== null && result ? positionAt(launch, Math.min(time, result.time)) : null;
  const ball = at && parsed?.view ? toPixel(parsed.view, SIZE, at) : null;
  const values = result
    ? [
        t('graph3d.tools.projectile.flight', { value: show(result.time) }),
        t('graph3d.tools.projectile.range', { value: show(result.range) }),
        t('graph3d.tools.projectile.peak', { value: show(result.peakHeight), time: show(result.peakTime) }),
        t('graph3d.tools.projectile.impact', { value: show(result.impactSpeed) }),
      ]
    : [];
  const title = t('graph3d.tools.projectile.graphTitle', {
    speed: fields.speed,
    angle: fields.angle,
    height: fields.height,
    gravity: fields.gravity,
    drag: fields.drag,
  });

  return (
    <div className={styles.tool}>
      <div className={styles.fields}>
        <NumberField label={t('graph3d.tools.projectile.speed')} value={fields.speed} onChange={set('speed')} />
        <NumberField label={t('graph3d.tools.projectile.angle')} value={fields.angle} onChange={set('angle')} />
        <NumberField label={t('graph3d.tools.projectile.height')} value={fields.height} onChange={set('height')} />
        <NumberField label={t('graph3d.tools.projectile.gravity')} value={fields.gravity} onChange={set('gravity')} />
        <NumberField
          label={t('graph3d.tools.projectile.drag')}
          value={fields.drag}
          onChange={set('drag')}
          hint={t('graph3d.tools.projectile.dragHint')}
        />
      </div>
      {!ok ? (
        <p className={styles.problem} role="status">
          {t('graph3d.tools.projectile.bad')}
        </p>
      ) : null}
      {result ? (
        <ul className={styles.list} aria-label={t('graph3d.tools.projectile.title')}>
          {values.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      ) : null}
      {scene ? (
        <svg
          className={styles.plot}
          viewBox={`0 0 ${SIZE.width} ${SIZE.height}`}
          role="img"
          aria-label={t('graph3d.tools.projectile.plotLabel')}
        >
          <PlotLayers scene={scene} trace={null} />
          {ball ? <circle className={styles.ball} cx={ball.x} cy={ball.y} r={7} /> : null}
        </svg>
      ) : null}
      {result ? (
        <>
          <label className={styles.number}>
            <span>{t('graph3d.trace.slider')}</span>
            <input
              type="range"
              min={0}
              max={result.time}
              step={result.time / 200}
              value={time ?? 0}
              onChange={(event) => {
                setPlaying(false);
                setTime(Number(event.target.value));
              }}
            />
          </label>
          <p className={styles.note} aria-live="polite">
            {at && time !== null
              ? t('graph3d.tools.projectile.position', { t: show(time), x: show(at.x), y: show(at.y) })
              : ''}
          </p>
          <div className={styles.actions}>
            <Button variant="quiet" onClick={launchNow}>
              {time === null ? t('graph3d.tools.projectile.launch') : t('graph3d.tools.projectile.replay')}
            </Button>
            <InsertResult text={`${title}. ${values.join('. ')}.`} graph={graph!} />
          </div>
        </>
      ) : null}
    </div>
  );
}
