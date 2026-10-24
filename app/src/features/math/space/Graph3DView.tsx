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
import { useSvgScale } from '../svgScale';
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
import { buildWorld, type World } from './world';

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

const TURNS: Record<string, [number, number]> = {
  ArrowLeft: [-5, 0],
  ArrowRight: [5, 0],
  ArrowUp: [0, 5],
  ArrowDown: [0, -5],
};

/** The camera a key gives, or null when the key is not for the view. */
function keyCamera(key: string, camera: Camera): Camera | null {
  const turn = TURNS[key];
  if (turn) return { ...camera, azimuth: camera.azimuth + turn[0], elevation: camera.elevation + turn[1] };
  if (key === '+' || key === '=') return { ...camera, zoom: camera.zoom * 1.2 };
  if (key === '-') return { ...camera, zoom: camera.zoom / 1.2 };
  return key === '0' ? DEFAULT_CAMERA : null;
}

/**
 * The camera, and what a drag, the wheel, and the keys do to it. A turn being dragged belongs to the text it began
 * from, so new text brings back its own camera. A finished turn goes out as text after `delay`.
 */
function useCamera(source: string, space: SpaceSource, editable: boolean, sendCamera: (next: Camera) => void) {
  const [liveState, setLiveState] = useState<{ source: string; camera: Camera } | null>(null);
  const live = liveState?.source === source ? liveState.camera : null;
  const camera = live ?? space.camera ?? DEFAULT_CAMERA;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flat = space.show === 'contour';

  const commit = (next: Camera, delay = 0) => {
    const fixed = clampCamera(next);
    setLiveState({ source, camera: fixed });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => sendCamera(fixed), delay);
  };
  const handlers = {
    onPointerDown: (event: PointerEvent<SVGSVGElement>) => {
      if (flat) return;
      drag.current = { x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<SVGSVGElement>) => {
      const from = drag.current;
      if (!from) return;
      drag.current = { x: event.clientX, y: event.clientY };
      const azimuth = camera.azimuth - (event.clientX - from.x) * 0.5;
      const elevation = camera.elevation + (event.clientY - from.y) * 0.5;
      setLiveState({ source, camera: clampCamera({ ...camera, azimuth, elevation }) });
    },
    onPointerUp: () => {
      if (drag.current && live && editable) commit(live);
      drag.current = null;
    },
    onWheel: (event: WheelEvent<SVGSVGElement>) => {
      if (editable && !flat) commit({ ...camera, zoom: camera.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1) }, COMMIT_MS);
    },
    onKeyDown: (event: KeyboardEvent<SVGSVGElement>) => {
      const next = keyCamera(event.key, camera);
      if (!next) return;
      event.preventDefault();
      commit(next);
    },
  };
  return { camera, live, commit, handlers };
}

/** One text box per item, with the engine's complaint under a box it cannot read. */
function ItemBoxes(props: { space: SpaceSource; world: World; editable: boolean; onItems(items: string[]): void }) {
  const { space, world, editable, onItems } = props;
  const edit = (index: number, text: string) => {
    const items = space.items.map((line, i) => (i === index ? text : line));
    onItems(text === '' ? items.filter((_, i) => i !== index) : items);
  };
  return (
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
              onChange={(event) => edit(index, event.target.value)}
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
        <Button variant="quiet" onClick={() => onItems([...space.items, 'z = x^2 + y^2'])}>
          {t('graph3d.view.add')}
        </Button>
      ) : null}
    </div>
  );
}

function ShowButtons(props: { show: SpaceShow; editable: boolean; onShow(next: SpaceShow): void }) {
  const { show, editable, onShow } = props;
  return (
    <div className={styles.buttons} role="group" aria-label={t('graph3d.view.showLabel')}>
      {SHOWS.map((one) => (
        <Button key={one} variant="quiet" aria-pressed={show === one} disabled={!editable} onClick={() => onShow(one)}>
          {t(`graph3d.view.show.${one}`)}
        </Button>
      ))}
    </div>
  );
}

function ViewButtons(props: { camera: Camera; space: SpaceSource; commit(next: Camera): void }) {
  const { camera, space, commit } = props;
  return (
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
      <Button variant="quiet" onClick={() => void savePicture({ ...space, camera }, 'svg')}>
        {t('graph3d.view.saveSvg')}
      </Button>
      <Button variant="quiet" onClick={() => void savePicture({ ...space, camera }, 'png')}>
        {t('graph3d.view.savePng')}
      </Button>
    </div>
  );
}

export function Graph3DView({ source, editable, onSource }: Graph3DViewProps) {
  const svg = useRef<SVGSVGElement>(null);
  useSvgScale(svg, SIZE_3D.width);
  const space = useMemo(() => readSpace(source), [source]);
  const { names, values } = useParams(space);
  const withValues = useMemo(() => ({ ...space, params: values }), [space, values]);
  const world = useMemo(() => buildWorld(withValues), [withValues]);
  const { camera, live, commit, handlers } = useCamera(source, space, editable, (next) =>
    onSource(writeSpace({ ...space, camera: next })),
  );
  // A change made during a turn keeps the turn.
  const send = (next: Partial<SpaceSource>) =>
    onSource(writeSpace({ ...space, camera: live ?? space.camera, ...next }));
  const drawn = useMemo(() => spaceMarks({ ...withValues, camera }, world, screenPaint), [withValues, world, camera]);
  const description = describeSpace(withValues, world);

  return (
    <div className={styles.space}>
      <ItemBoxes space={space} world={world} editable={editable} onItems={(items) => send({ items })} />
      <ShowButtons show={space.show} editable={editable} onShow={(show) => send({ show })} />
      <svg
        ref={svg}
        className={styles.plot}
        viewBox={`0 0 ${SIZE_3D.width} ${SIZE_3D.height}`}
        role="application"
        tabIndex={0}
        aria-label={t('graph3d.view.label', { count: space.items.length })}
        aria-roledescription={t('graph3d.view.role')}
        aria-description={`${t('graph3d.view.keys')} ${description}`}
        {...handlers}
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
      <ViewButtons camera={camera} space={withValues} commit={commit} />
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
