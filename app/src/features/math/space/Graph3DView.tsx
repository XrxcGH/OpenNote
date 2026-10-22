// A 3D graph on screen: surfaces z = f(x, y), curves in space, vectors, points, lines, planes, and solids, in a box
// you turn with a drag, the arrow keys, or the buttons, and zoom with the wheel or + and -. Surface, Contour, and
// Both switch between the 3D view, the level curves from above, and the 3D view with the level curves on its floor.
// The tangent plane to the first surface is drawn at the point chosen. The graph's whole state is its text
// (source3d.ts), so every change goes out as new text and undo, copy, and export follow.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, WheelEvent } from 'react';
import { createElement } from 'react';
import { t } from '../../../strings/t';
import { Button, announce, showToast } from '../../../ui';
import { Sliders } from '../graph/parts';
import { multiParameters } from './multivar';
import { screenPaint, exportPaint } from './paint';
import { drawnToSvg } from './project';
import { SIZE_3D, describeSpace, spaceMarks, svgToPng, tangentText } from './render';
import {
  DEFAULT_CAMERA,
  readItem,
  readSpace,
  writeSpace,
  type Camera,
  type SpaceShow,
  type SpaceSource,
} from './source3d';
import styles from './space.module.css';
import { buildWorld } from './world';

export interface Graph3DViewProps {
  source: string;
  editable: boolean;
  onSource(next: string): void;
}

const COMMIT_MS = 450;
const SHOWS: readonly SpaceShow[] = ['surface', 'contour', 'both'];

const clampCamera = (camera: Camera): Camera => ({
  azimuth: ((((camera.azimuth + 180) % 360) + 360) % 360) - 180,
  elevation: Math.max(-89, Math.min(89, camera.elevation)),
  zoom: Math.max(0.3, Math.min(4, camera.zoom)),
});

/** The letters the items use besides x, y, and t, each with its value (1 until the text says). */
function useParams(space: SpaceSource) {
  return useMemo(() => {
    const names = new Set(Object.keys(space.params));
    for (const line of space.items) {
      const item = readItem(line);
      const texts = item.kind === 'surface' ? [item.source] : item.kind === 'curve' ? item.parts : [];
      const vars = item.kind === 'curve' ? ['t'] : ['x', 'y'];
      for (const text of texts) for (const name of multiParameters(text, vars)) names.add(name);
    }
    if (space.revolve)
      for (const text of [space.revolve.outer, space.revolve.inner]) {
        for (const name of multiParameters(text, ['x'])) names.add(name);
      }
    const list = [...names];
    return { names: list, values: Object.fromEntries(list.map((name) => [name, space.params[name] ?? 1])) };
  }, [space]);
}

/** Saves the picture as SVG or PNG, in the light theme's colors. */
async function savePicture(space: SpaceSource, format: 'svg' | 'png'): Promise<void> {
  const world = buildWorld(space);
  const paint = exportPaint();
  const svg = drawnToSvg(
    spaceMarks(space, world, paint),
    SIZE_3D,
    paint.paper,
    t('graph3d.view.title'),
    describeSpace(space, world),
  );
  const name = `${t('graph3d.view.fileStem')}.${format}`;
  try {
    const bytes = format === 'png' ? await svgToPng(svg, SIZE_3D) : new TextEncoder().encode(svg);
    const { saveBytes } = await import('../../study');
    const label = t(format === 'png' ? 'graph3d.view.pngLabel' : 'graph3d.view.svgLabel');
    if (await saveBytes(name, label, bytes, format === 'png' ? 'image/png' : 'image/svg+xml')) {
      const message = t('graph3d.view.saved', { name });
      showToast({ message });
      announce(message);
    }
  } catch {
    showToast({ message: t('graph3d.view.saveFailed'), tone: 'danger' });
  }
}

export function Graph3DView({ source, editable, onSource }: Graph3DViewProps) {
  const space = useMemo(() => readSpace(source), [source]);
  const { names, values } = useParams(space);
  const withValues = useMemo(() => ({ ...space, params: values }), [space, values]);
  const world = useMemo(() => buildWorld(withValues), [withValues]);
  const [liveState, setLiveState] = useState<{ source: string; camera: Camera } | null>(null);
  const live = liveState?.source === source ? liveState.camera : null;
  const camera = live ?? space.camera ?? DEFAULT_CAMERA;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const drawn = useMemo(() => spaceMarks({ ...withValues, camera }, world, screenPaint), [withValues, world, camera]);
  const send = (next: Partial<SpaceSource>) =>
    onSource(writeSpace({ ...space, camera: live ?? space.camera, ...next }));
  const commit = (next: Camera, delay = 0) => {
    const fixed = clampCamera(next);
    setLiveState({ source, camera: fixed });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => send({ camera: fixed }), delay);
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (space.show === 'contour') return;
    drag.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const from = drag.current;
    if (!from) return;
    drag.current = { x: event.clientX, y: event.clientY };
    const next = {
      ...camera,
      azimuth: camera.azimuth - (event.clientX - from.x) * 0.5,
      elevation: camera.elevation + (event.clientY - from.y) * 0.5,
    };
    setLiveState({ source, camera: clampCamera(next) });
  };
  const onPointerUp = () => {
    if (drag.current && live && editable) commit(live);
    drag.current = null;
  };
  const onWheel = (event: WheelEvent<SVGSVGElement>) => {
    if (editable && space.show !== 'contour')
      commit({ ...camera, zoom: camera.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1) }, COMMIT_MS);
  };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const turns: Record<string, [number, number]> = {
      ArrowLeft: [-5, 0],
      ArrowRight: [5, 0],
      ArrowUp: [0, 5],
      ArrowDown: [0, -5],
    };
    let next: Camera | null = null;
    if (turns[event.key])
      next = {
        ...camera,
        azimuth: camera.azimuth + turns[event.key][0],
        elevation: camera.elevation + turns[event.key][1],
      };
    else if (event.key === '+' || event.key === '=') next = { ...camera, zoom: camera.zoom * 1.2 };
    else if (event.key === '-') next = { ...camera, zoom: camera.zoom / 1.2 };
    else if (event.key === '0') next = DEFAULT_CAMERA;
    if (!next) return;
    event.preventDefault();
    commit(next);
  };

  const editItem = (index: number, text: string) => {
    const items = space.items.map((line, i) => (i === index ? text : line));
    send({ items: text === '' ? items.filter((_, i) => i !== index) : items });
  };
  const description = describeSpace(withValues, world);

  return (
    <div className={styles.space}>
      <div className={styles.inputs}>
        {space.items.map((line, index) => {
          const problem = world.problems[index];
          const message =
            world.kinds[index] === 'invalid' && problem
              ? t(`graph3d.invalid.${problem.message as 'vector'}`)
              : problem?.message;
          return (
            <div key={index} className={styles.row}>
              <input
                className={styles.input}
                value={line}
                disabled={!editable}
                aria-label={t('graph3d.view.item', { number: index + 1 })}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? `space-problem-${index}` : undefined}
                spellCheck={false}
                onChange={(event) => editItem(index, event.target.value)}
              />
              {problem ? (
                <span id={`space-problem-${index}`} className={styles.problem} role="status">
                  {message}
                </span>
              ) : null}
            </div>
          );
        })}
        {editable ? (
          <Button variant="quiet" onClick={() => send({ items: [...space.items, 'z = x^2 + y^2'] })}>
            {t('graph3d.view.add')}
          </Button>
        ) : null}
      </div>
      <div className={styles.buttons} role="group" aria-label={t('graph3d.view.showLabel')}>
        {SHOWS.map((show) => (
          <Button
            key={show}
            variant="quiet"
            aria-pressed={space.show === show}
            disabled={!editable}
            onClick={() => send({ show })}
          >
            {t(`graph3d.view.show.${show}`)}
          </Button>
        ))}
      </div>
      <svg
        className={styles.plot}
        viewBox={`0 0 ${SIZE_3D.width} ${SIZE_3D.height}`}
        role="application"
        tabIndex={0}
        aria-label={t('graph3d.view.label', { count: space.items.length })}
        aria-roledescription={t('graph3d.view.role')}
        aria-description={`${t('graph3d.view.keys')} ${description}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        <rect width={SIZE_3D.width} height={SIZE_3D.height} className={styles.paper} />
        {drawn.map((mark, index) => createElement(mark.tag, { key: index, ...mark.attrs }, mark.text))}
      </svg>
      <TangentControls space={space} editable={editable} onTangent={(tangent) => send({ tangent })} />
      <p className={styles.readout} aria-live="polite">
        {world.tangent ? tangentText(world) : space.tangent ? t('graph3d.tangent.none') : ''}
      </p>
      <Sliders
        names={names}
        values={values}
        editable={editable}
        onValue={(name, value) => send({ params: { ...space.params, [name]: value } })}
      />
      <div className={styles.buttons}>
        <Button variant="quiet" onClick={() => commit({ ...camera, azimuth: camera.azimuth - 15 })}>
          {t('graph3d.view.turnLeft')}
        </Button>
        <Button variant="quiet" onClick={() => commit({ ...camera, azimuth: camera.azimuth + 15 })}>
          {t('graph3d.view.turnRight')}
        </Button>
        <Button variant="quiet" onClick={() => commit(DEFAULT_CAMERA)}>
          {t('graph3d.view.reset')}
        </Button>
        <Button variant="quiet" onClick={() => void savePicture(withValues, 'svg')}>
          {t('graph3d.view.saveSvg')}
        </Button>
        <Button variant="quiet" onClick={() => void savePicture(withValues, 'png')}>
          {t('graph3d.view.savePng')}
        </Button>
      </div>
    </div>
  );
}

function TangentControls(props: {
  space: SpaceSource;
  editable: boolean;
  onTangent(next: readonly [number, number] | null): void;
}) {
  const { space, editable, onTangent } = props;
  const [x, y] = space.tangent ?? [1, 1];
  const set = (nx: string, ny: string) => {
    const [a, b] = [Number(nx), Number(ny)];
    if (nx.trim() !== '' && ny.trim() !== '' && Number.isFinite(a) && Number.isFinite(b)) onTangent([a, b]);
  };
  return (
    <div className={styles.tangent}>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={space.tangent !== null}
          disabled={!editable}
          onChange={(event) => onTangent(event.target.checked ? [x, y] : null)}
        />
        {t('graph3d.tangent.show')}
      </label>
      {space.tangent ? (
        <>
          <label className={styles.field}>
            <span>{t('graph3d.tangent.x')}</span>
            <input
              type="number"
              step="any"
              defaultValue={x}
              disabled={!editable}
              onChange={(e) => set(e.target.value, String(y))}
            />
          </label>
          <label className={styles.field}>
            <span>{t('graph3d.tangent.y')}</span>
            <input
              type="number"
              step="any"
              defaultValue={y}
              disabled={!editable}
              onChange={(e) => set(String(x), e.target.value)}
            />
          </label>
        </>
      ) : null}
    </div>
  );
}
