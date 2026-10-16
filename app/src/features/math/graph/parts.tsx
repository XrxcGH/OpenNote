// The pieces of the function grapher's screen (Phase 10): the plot's layers, the function boxes, the sliders, and the
// numbers behind the trace readout. GraphView.tsx puts them together and holds the state.
import { t } from '../../../strings/t';
import { Button } from '../../../ui';
import { compileExpression, defaultViewport, differentiateExpression, panByFraction, zoomAtCenter } from '../grapher';
import type { GraphScene, Viewport } from '../grapher';
import styles from './graph.module.css';
import type { GraphSource } from './source';

export const SIZE = { width: 640, height: 360 };
export const PENS = [
  '--ink-indigo',
  '--ink-amber',
  '--ink-fern',
  '--ink-brick',
  '--ink-plum',
  '--ink-walnut',
  '--ink-ink',
];

export const show = (value: number) => String(Number(value.toPrecision(4)));

export interface Trace {
  x: number;
  y: number;
  slope: number | null;
  curve: number;
}

/** The first function that has a value at `x`, with its slope there. */
export function traceAt(
  x: number | null,
  functions: readonly string[],
  names: readonly string[],
  values: Readonly<Record<string, number>>,
): Trace | null {
  if (x === null) return null;
  for (const [curve, line] of functions.entries()) {
    const compiled = compileExpression(line, { parameters: names });
    if (!compiled.ok) continue;
    const y = compiled.expression.evaluate(x, values);
    if (!Number.isFinite(y)) continue;
    const slope = differentiateExpression(line, { parameters: names });
    const rise = slope.ok ? slope.expression.evaluate(x, values) : NaN;
    return { x, y, slope: Number.isFinite(rise) ? rise : null, curve };
  }
  return null;
}

export function readoutText(trace: Trace | null): string {
  if (!trace) return t('smart.grapher.readoutNone');
  const [x, y] = [show(trace.x), show(trace.y)];
  return trace.slope === null
    ? t('smart.grapher.readout', { x, y })
    : t('smart.grapher.readoutSlope', { x, y, slope: show(trace.slope) });
}

/** What a key does to the view or the trace, or null when the key is not for the graph. */
export function keyEffect(
  event: { key: string; shiftKey: boolean },
  view: Viewport,
  traceX: number | null,
): { view: Viewport } | { trace: number | null } | null {
  const arrows: Record<string, [number, number]> = {
    ArrowLeft: [-0.1, 0],
    ArrowRight: [0.1, 0],
    ArrowUp: [0, 0.1],
    ArrowDown: [0, -0.1],
  };
  if (event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    const step = (view.xMax - view.xMin) / 100;
    return { trace: (traceX ?? (view.xMin + view.xMax) / 2) + (event.key === 'ArrowLeft' ? -step : step) };
  }
  if (arrows[event.key]) return { view: panByFraction(view, ...arrows[event.key]) };
  if (event.key === '+' || event.key === '=') return { view: zoomAtCenter(view, 1.25) };
  if (event.key === '-') return { view: zoomAtCenter(view, 0.8) };
  if (event.key === '0') return { view: defaultViewport(SIZE, 20) };
  return event.key === 'Escape' ? { trace: null } : null;
}

const gridPath = (scene: GraphScene, major: boolean) =>
  [
    ...scene.grid.x.filter((tick) => tick.major === major).map((tick) => `M${tick.position} 0V${SIZE.height}`),
    ...scene.grid.y.filter((tick) => tick.major === major).map((tick) => `M0 ${tick.position}H${SIZE.width}`),
  ].join('');

/** The tick numbers' font size (graph.module.css), and about how wide one character of them is drawn. */
const LABEL = { size: 11, char: 0.62 * 11, ascent: 8 } as const;

export interface TickLabel {
  key: string;
  text: string;
  /** Where the number starts, and its baseline. */
  x: number;
  y: number;
}

/**
 * The axes' numbers, each just right of its tick (x) or just above it (y), beside the axis line and inside the
 * plot. A number that would run past the plot's edge is left out rather than drawn cut off.
 */
export function tickLabels(scene: GraphScene): TickLabel[] {
  const { grid } = scene;
  const width = (text: string) => text.length * LABEL.char;
  const xBaseline = Math.min(SIZE.height - 4, Math.max(12, grid.xAxis.pixel + 13));
  const xs = grid.x
    .filter((tick) => tick.major && tick.label !== '0')
    .map((tick) => ({ key: `x${tick.value}`, text: tick.label, x: tick.position + 3, y: xBaseline }))
    .filter((label) => label.x >= 0 && label.x + width(label.text) <= SIZE.width);
  const ys = grid.y
    .filter((tick) => tick.major && tick.label !== '0')
    .map((tick) => ({
      key: `y${tick.value}`,
      text: tick.label,
      x: Math.min(SIZE.width - 4 - width(tick.label), Math.max(4, grid.yAxis.pixel + 4)),
      y: tick.position - 3,
    }))
    .filter((label) => label.y - LABEL.ascent >= 0 && label.y <= SIZE.height);
  return [...xs, ...ys];
}

/** The grid, the axes, their numbers, the curves, and the traced point. */
export function PlotLayers({ scene, trace }: { scene: GraphScene; trace: Trace | null }) {
  const { view } = scene;
  const { grid } = scene;
  const dot =
    trace && scene.curves[trace.curve]?.error === null
      ? {
          x: ((trace.x - view.xMin) / (view.xMax - view.xMin)) * SIZE.width,
          y: ((view.yMax - trace.y) / (view.yMax - view.yMin)) * SIZE.height,
        }
      : null;
  return (
    <>
      <rect width={SIZE.width} height={SIZE.height} className={styles.paper} />
      <path className={styles.gridMinor} d={gridPath(scene, false)} />
      <path className={styles.gridMajor} d={gridPath(scene, true)} />
      <path className={styles.axis} d={`M0 ${grid.xAxis.pixel}H${SIZE.width}M${grid.yAxis.pixel} 0V${SIZE.height}`} />
      {tickLabels(scene).map((label) => (
        <text key={label.key} className={styles.label} x={label.x} y={label.y}>
          {label.text}
        </text>
      ))}
      {scene.curves.map((curve, index) => (
        <path
          key={index}
          d={curve.d}
          className={styles.curve}
          style={{ stroke: `var(${PENS[index % PENS.length]})` }}
        />
      ))}
      {dot ? <circle className={styles.dot} cx={dot.x} cy={dot.y} r={5} /> : null}
    </>
  );
}

export interface FunctionBoxesProps {
  graph: GraphSource;
  scene: GraphScene;
  editable: boolean;
  onFunctions(functions: string[]): void;
}

/** One text box per function, with the engine's complaint under a box it cannot read. */
export function FunctionBoxes({ graph, scene, editable, onFunctions }: FunctionBoxesProps) {
  const edit = (index: number, text: string) => {
    const functions = graph.functions.map((line, i) => (i === index ? text : line));
    onFunctions(text === '' ? functions.filter((_, i) => i !== index) : functions);
  };
  return (
    <div className={styles.inputs}>
      {graph.functions.map((line, index) => {
        const problem = scene.curves[index]?.error;
        return (
          <div key={index} className={styles.row}>
            <span
              className={styles.swatch}
              style={{ background: `var(${PENS[index % PENS.length]})` }}
              aria-hidden="true"
            />
            <input
              className={styles.input}
              value={line}
              disabled={!editable}
              aria-label={t('smart.grapher.function', { number: index + 1 })}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `graph-problem-${index}` : undefined}
              spellCheck={false}
              onChange={(event) => edit(index, event.target.value)}
            />
            {problem ? (
              <span id={`graph-problem-${index}`} className={styles.problem} role="status">
                {problem.message}
              </span>
            ) : null}
          </div>
        );
      })}
      {editable ? (
        <Button variant="quiet" onClick={() => onFunctions([...graph.functions, 'y = x'])}>
          {t('smart.grapher.add')}
        </Button>
      ) : null}
    </div>
  );
}

export interface SlidersProps {
  names: readonly string[];
  values: Readonly<Record<string, number>>;
  editable: boolean;
  onValue(name: string, value: number): void;
}

/** A slider for each letter a function uses besides x. */
export function Sliders({ names, values, editable, onValue }: SlidersProps) {
  if (names.length === 0) return null;
  return (
    <div className={styles.sliders}>
      {names.map((name) => (
        <label key={name} className={styles.slider}>
          <span>{name}</span>
          <input
            type="range"
            min={-10}
            max={10}
            step={0.1}
            value={values[name]}
            disabled={!editable}
            aria-label={t('smart.grapher.parameter', { name })}
            onChange={(event) => onValue(name, Number(event.target.value))}
          />
          <output>{show(values[name])}</output>
        </label>
      ))}
    </div>
  );
}

export function ZoomButtons({ view, onView }: { view: Viewport; onView(next: Viewport): void }) {
  return (
    <div className={styles.buttons}>
      <Button variant="quiet" onClick={() => onView(zoomAtCenter(view, 1.25))}>
        {t('smart.grapher.zoomIn')}
      </Button>
      <Button variant="quiet" onClick={() => onView(zoomAtCenter(view, 0.8))}>
        {t('smart.grapher.zoomOut')}
      </Button>
      <Button variant="quiet" onClick={() => onView(defaultViewport(SIZE, 20))}>
        {t('smart.grapher.reset')}
      </Button>
    </div>
  );
}
