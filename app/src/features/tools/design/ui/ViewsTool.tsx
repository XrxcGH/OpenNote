// The orthographic views tool: build a model from unit cubes one layer at a time and see its front, top, and right
// views with hidden lines, in third-angle or first-angle layout, and an isometric picture. Either picture can be put
// into the page. The cells are buttons that move with the arrow keys, so a model can be built from the keyboard.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button, announce, openMenu } from '../../../../ui';
import { PAGE, SCREEN } from '../kit/plot';
import { MAX_SIZE, key, project, type Cube, type Projection } from '../views';
import { isometricSvg, viewsSvg } from '../viewsDrawing';
import { pictureRequest, sendToPage } from './insert';
import { say } from './ToolPanel';
import { load, save } from './store';
import styles from './design.module.css';

const PRESETS: Record<string, { size: [number, number, number]; cubes: Cube[] }> = {
  lshape: {
    size: [4, 3, 3],
    cubes: [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
      { x: 0, y: 1, z: 1 },
    ],
  },
  steps: {
    size: [4, 4, 3],
    cubes: [0, 1, 2, 3].flatMap((x) => Array.from({ length: x + 1 }, (_, y) => ({ x, y, z: 1 }))),
  },
  notch: {
    size: [4, 3, 3],
    cubes: [0, 1, 2].flatMap((x) =>
      [0, 1].flatMap((y) => [0, 1, 2].map((z) => ({ x, y, z }))).filter((c) => !(c.x === 1 && c.y === 1 && c.z === 1)),
    ),
  },
};

interface Saved {
  size: [number, number, number];
  cubes: Cube[];
  system: Projection;
}

const clampSize = (n: unknown): number =>
  typeof n === 'number' && Number.isInteger(n) ? Math.min(MAX_SIZE, Math.max(1, n)) : 4;

function readSaved(): Saved {
  const raw = load<Partial<Saved>>('views.model', {});
  const size: [number, number, number] = Array.isArray(raw.size)
    ? [clampSize(raw.size[0]), clampSize(raw.size[1]), clampSize(raw.size[2])]
    : [4, 3, 3];
  const cubes = Array.isArray(raw.cubes)
    ? raw.cubes.filter(
        (c): c is Cube =>
          typeof c?.x === 'number' &&
          typeof c.y === 'number' &&
          typeof c.z === 'number' &&
          c.x < size[0] &&
          c.y < size[1] &&
          c.z < size[2] &&
          c.x >= 0 &&
          c.y >= 0 &&
          c.z >= 0,
      )
    : PRESETS.lshape!.cubes;
  return { size, cubes, system: raw.system === 'first' ? 'first' : 'third' };
}

function SizeField(props: { id: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className={styles.field}>
      <span>{say(`kitDesign.views.${props.id}`)}</span>
      <select
        className={styles.input}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      >
        {Array.from({ length: MAX_SIZE }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function ViewsTool() {
  const [saved] = useState(readSaved);
  const [size, setSize] = useState(saved.size);
  const [cubes, setCubes] = useState<Cube[]>(saved.cubes);
  const [system, setSystem] = useState<Projection>(saved.system);
  const [layer, setLayer] = useState(0);
  const [cursor, setCursor] = useState<[number, number]>([0, 0]);
  const cells = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => save('views.model', { size, cubes, system }), [size, cubes, system]);
  const filled = useMemo(() => new Set(cubes.map(key)), [cubes]);
  const y = Math.min(layer, size[1] - 1);
  const names = {
    front: say('kitDesign.views.front'),
    top: say('kitDesign.views.top'),
    right: say('kitDesign.views.right'),
  };
  const alt = say('kitDesign.views.alt', { count: cubes.length });
  const isoAlt = say('kitDesign.views.isoAlt', { count: cubes.length });
  const screen = useMemo(() => viewsSvg(cubes, system, SCREEN, names, alt), [cubes, system]); // eslint-disable-line react-hooks/exhaustive-deps
  const isoScreen = useMemo(() => isometricSvg(cubes, SCREEN, isoAlt), [cubes, isoAlt]);
  const summary = (['front', 'top', 'right'] as const)
    .map((name) => {
      const v = project(cubes, name);
      return say('kitDesign.views.size', { view: names[name], width: v.width, height: v.height });
    })
    .join(' ');

  const resize = (next: [number, number, number]) => {
    setSize(next);
    setCubes((current) => current.filter((c) => c.x < next[0] && c.y < next[1] && c.z < next[2]));
  };
  const toggle = (x: number, z: number) => {
    const k = key({ x, y, z });
    const on = filled.has(k);
    setCubes((current) => (on ? current.filter((c) => key(c) !== k) : [...current, { x, y, z }]));
    announce(say(on ? 'kitDesign.views.removed' : 'kitDesign.views.added', { x: x + 1, z: z + 1, layer: y + 1 }));
  };
  const move = (event: KeyboardEvent, x: number, row: number) => {
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = delta[event.key];
    if (!d) return;
    event.preventDefault();
    const nx = Math.min(size[0] - 1, Math.max(0, x + d[0]));
    const nr = Math.min(size[2] - 1, Math.max(0, row + d[1]));
    setCursor([nx, nr]);
    cells.current[`${nx},${nr}`]?.focus();
  };
  const preset = (id: string) => {
    const one = PRESETS[id];
    if (!one) return;
    setSize(one.size);
    setCubes(one.cubes);
    setLayer(0);
    setCursor([0, 0]);
  };
  const insert = (anchor: HTMLElement) => {
    const put = (svgText: string, name: string, description: string) => {
      const took = sendToPage({ picture: pictureRequest(svgText, name, description) });
      announce(say(took ? 'kitDesign.ui.inserted' : 'kitDesign.ui.noPage'));
    };
    void openMenu({
      label: say('kitDesign.ui.insertMenu'),
      anchor,
      items: [
        {
          id: 'views',
          label: say('kitDesign.views.insertViews'),
          onSelect: () => put(viewsSvg(cubes, system, PAGE, names, alt), 'views.svg', alt),
        },
        {
          id: 'iso',
          label: say('kitDesign.views.insertIso'),
          onSelect: () => put(isometricSvg(cubes, PAGE, isoAlt), 'isometric.svg', isoAlt),
        },
      ],
    });
  };

  return (
    <div className={styles.panel}>
      <p className={styles.hint}>{say('kitDesign.views.about')}</p>
      <div className={styles.row}>
        <SizeField id="width" value={size[0]} onChange={(n) => resize([n, size[1], size[2]])} />
        <SizeField id="height" value={size[1]} onChange={(n) => resize([size[0], n, size[2]])} />
        <SizeField id="depth" value={size[2]} onChange={(n) => resize([size[0], size[1], n])} />
        <label className={styles.field}>
          <span>{say('kitDesign.views.projection')}</span>
          <select
            className={styles.input}
            value={system}
            onChange={(event) => setSystem(event.target.value === 'first' ? 'first' : 'third')}
          >
            <option value="third">{say('kitDesign.views.third')}</option>
            <option value="first">{say('kitDesign.views.first')}</option>
          </select>
        </label>
      </div>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>{say('kitDesign.views.layer')}</span>
          <select className={styles.input} value={y} onChange={(event) => setLayer(Number(event.target.value))}>
            {Array.from({ length: size[1] }, (_, i) => (
              <option key={i} value={i}>
                {say('kitDesign.views.layerName', { n: i + 1 })}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>{say('kitDesign.views.preset')}</span>
          <select className={styles.input} value="" onChange={(event) => preset(event.target.value)}>
            <option value="">{say('kitDesign.views.presetNone')}</option>
            {Object.keys(PRESETS).map((id) => (
              <option key={id} value={id}>
                {say(`kitDesign.views.presets.${id}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className={styles.hint} id="views-grid-help">
        {say('kitDesign.views.gridHelp')}
      </p>
      <div
        className={styles.cellGrid}
        role="group"
        aria-label={say('kitDesign.views.gridLabel', { layer: y + 1 })}
        aria-describedby="views-grid-help"
        style={{ gridTemplateColumns: `repeat(${size[0]}, var(--size-target-pointer))` }}
      >
        {Array.from({ length: size[2] }, (_, row) =>
          Array.from({ length: size[0] }, (_, x) => {
            const on = filled.has(key({ x, y, z: row }));
            return (
              <button
                key={`${x},${row}`}
                ref={(node) => {
                  cells.current[`${x},${row}`] = node;
                }}
                type="button"
                className={`${styles.cell} ${on ? styles.cellOn : ''}`}
                aria-pressed={on}
                aria-label={say('kitDesign.views.cell', { x: x + 1, z: row + 1 })}
                tabIndex={cursor[0] === x && cursor[1] === row ? 0 : -1}
                onFocus={() => setCursor([x, row])}
                onKeyDown={(event) => move(event, x, row)}
                onClick={() => toggle(x, row)}
              />
            );
          }),
        )}
      </div>
      <div className={styles.buttons}>
        <Button
          onClick={() => {
            setCubes([]);
            announce(say('kitDesign.views.cleared'));
          }}
        >
          {say('kitDesign.views.clear')}
        </Button>
        <Button
          variant="primary"
          aria-haspopup="menu"
          disabled={cubes.length === 0}
          onClick={(event) => insert(event.currentTarget)}
        >
          {say('kitDesign.ui.insert')}
        </Button>
      </div>
      {cubes.length === 0 ? (
        <p className={styles.hint} role="status">
          {say('kitDesign.views.empty')}
        </p>
      ) : (
        <>
          <p role="status">
            {say('kitDesign.views.count', { count: cubes.length })} {summary}
          </p>
          <section className={styles.section} aria-label={say('kitDesign.views.viewsHeading')}>
            <h3 className={styles.heading}>{say('kitDesign.views.viewsHeading')}</h3>
            <figure className={styles.figure}>
              <div dangerouslySetInnerHTML={{ __html: screen }} />
            </figure>
            <p className={styles.hint}>{say('kitDesign.views.dashed')}</p>
          </section>
          <section className={styles.section} aria-label={say('kitDesign.views.isoHeading')}>
            <h3 className={styles.heading}>{say('kitDesign.views.isoHeading')}</h3>
            <figure className={styles.figure}>
              <div dangerouslySetInnerHTML={{ __html: isoScreen }} />
            </figure>
          </section>
        </>
      )}
    </div>
  );
}
