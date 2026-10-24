// The beam solver block (item 7): a beam with supports and loads that slide along it and snap to even steps, the
// reactions beside it, and the shear and bending moment diagrams under it, all redrawn as the beam changes.
import { useCallback, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { t } from '../../../strings/t';
import { Button } from '../../../ui';
import { Canvas, onPartKey, useView } from '../canvas/Canvas';
import { NumberField, TextInput } from '../canvas/Field';
import { arrowPath, clamp, momentPath, snapToStep } from '../canvas/geometry';
import { fmt, q, useBlockModel } from '../canvas/shared';
import type { BlockProps } from '../canvas/shared';
import { KeysHint } from '../canvas/KeysHint';
import styles from '../canvas/canvas.module.css';
import { SupportSymbol } from '../fbd/FbdPanel';
import { useSvgScale } from '../../math/svgScale';
import { readBeam, solveBeam } from './beam';
import type { BeamLoad, BeamModel, BeamResult, BeamSample, BeamSegment, BeamSupport, BeamSupportKind } from './beam';

const COLUMNS = 16;
const ROWS = 5;
const AXIS = 2;
const LEFT = 1;
const SPAN = 14;

/** A step that splits the beam into about forty even parts: 0.1, 0.25, 0.5, 1, 2.5, … */
export function beamStep(length: number): number {
  const raw = length / 40;
  const power = 10 ** Math.floor(Math.log10(raw));
  const nice = [1, 2.5, 5, 10].find((n) => n * power >= raw) ?? 10;
  return nice * power;
}

type Item =
  { kind: 'support'; part: BeamSupport } | { kind: 'load'; part: BeamLoad } | { kind: 'segment'; part: BeamSegment };
type Change = Partial<BeamSupport> | Partial<BeamLoad> | Partial<BeamSegment>;

function itemName(item: Item, model: BeamModel): string {
  const at = (x: number) => q(x, model.lengthUnit);
  const perLength = `${model.forceUnit}/${model.lengthUnit}`;
  if (item.kind === 'segment') {
    const { factor, x1, x2 } = item.part;
    return t('engineering.beam.partSegment', { factor: fmt(factor), from: at(x1), to: at(x2) });
  }
  if (item.kind === 'support' && item.part.kind === 'hinge')
    return t('engineering.beam.partHinge', { x: at(item.part.x) });
  if (item.kind === 'support')
    return t('engineering.beam.partSupport', { kind: t(`engineering.beam.${item.part.kind}`), x: at(item.part.x) });
  const load = item.part;
  if (load.kind === 'point')
    return t('engineering.beam.partPoint', { force: q(load.value, model.forceUnit), x: at(load.x) });
  if (load.kind === 'moment')
    return t('engineering.beam.partMoment', { moment: q(load.value, momentUnit(model)), x: at(load.x) });
  return t('engineering.beam.partDistributed', {
    from: at(load.x1),
    to: at(load.x2),
    w1: q(load.w1, perLength),
    w2: q(load.w2, perLength),
  });
}

const momentUnit = (model: BeamModel) => `${model.forceUnit}·${model.lengthUnit}`;

export function beamFallback(model: BeamModel): string {
  const result = solveBeam(model);
  const reactions = result.reactions
    .map((r) => {
      const force = q(r.force, model.forceUnit);
      const x = q(r.x, model.lengthUnit);
      return r.moment !== undefined
        ? t('engineering.beam.fallbackFixed', { force, moment: q(r.moment, momentUnit(model)), x })
        : t('engineering.beam.fallbackReaction', { force, x });
    })
    .join('; ');
  return t('engineering.beam.fallback', {
    length: q(model.length, model.lengthUnit),
    reactions: reactions || '—',
    moment: q(result.maxMoment.value, momentUnit(model)),
  });
}

const newId = (model: BeamModel) => {
  const used = new Set([...model.supports, ...model.loads, ...(model.segments ?? [])].map((one) => one.id));
  let n = used.size + 1;
  while (used.has(`p${n}`)) n++;
  return `p${n}`;
};

// checks-disable-next-line modifiability: one editor whose toolbar, drawing, diagrams, and results share its state
export function BeamPanel({ data, readOnly, patch, announce }: BlockProps) {
  const save = useCallback((next: BeamModel) => patch({ model: next }, beamFallback(next)), [patch]);
  const { model, draft, commit } = useBlockModel(data.model, readBeam, save);
  const [selected, setSelected] = useState<string | null>(null);
  const result = useMemo(() => solveBeam(model), [model]);
  const step = beamStep(model.length);
  const drawing = useRef<HTMLDivElement>(null);
  const items: Item[] = [
    ...model.supports.map((part): Item => ({ kind: 'support', part })),
    ...model.loads.map((part): Item => ({ kind: 'load', part })),
    ...(model.segments ?? []).map((part): Item => ({ kind: 'segment', part })),
  ];
  const current = items.find((item) => item.part.id === selected) ?? null;

  const add = (what: BeamSupportKind | BeamLoad['kind'] | 'segment') => {
    const id = newId(model);
    const mid = snapToStep(model.length / 2, step);
    let next: BeamModel;
    let item: Item;
    if (what === 'segment') {
      const part: BeamSegment = { id, x1: 0, x2: mid, factor: 2 };
      next = { ...model, segments: [...(model.segments ?? []), part] };
      item = { kind: 'segment', part };
    } else if (what === 'pin' || what === 'roller' || what === 'fixed' || what === 'hinge') {
      const used = new Set(model.supports.map((s) => s.x));
      const x = what === 'hinge' ? mid : ([0, model.length, mid].find((one) => !used.has(one)) ?? mid);
      const part: BeamSupport = { id, kind: what, x: what === 'fixed' ? (used.has(0) ? model.length : 0) : x };
      next = { ...model, supports: [...model.supports, part] };
      item = { kind: 'support', part };
    } else {
      const part: BeamLoad =
        what === 'distributed'
          ? { id, kind: what, x1: 0, x2: model.length, w1: 1, w2: 1 }
          : { id, kind: what, x: mid, value: what === 'point' ? 10 : 5 };
      next = { ...model, loads: [...model.loads, part] };
      item = { kind: 'load', part };
    }
    commit(next);
    setSelected(id);
    announce(t('engineering.common.added', { name: itemName(item, model) }));
    requestAnimationFrame(() => drawing.current?.querySelector<SVGElement>(`[data-part="${id}"]`)?.focus());
  };

  const update = (id: string, change: Change): BeamModel => ({
    ...model,
    supports: model.supports.map((s) => (s.id === id ? ({ ...s, ...change } as BeamSupport) : s)),
    loads: model.loads.map((l) => (l.id === id ? ({ ...l, ...change } as BeamLoad) : l)),
    ...(model.segments
      ? { segments: model.segments.map((g) => (g.id === id ? ({ ...g, ...change } as BeamSegment) : g)) }
      : {}),
  });

  const remove = (id: string) => {
    const item = items.find((one) => one.part.id === id);
    commit({
      ...model,
      supports: model.supports.filter((s) => s.id !== id),
      loads: model.loads.filter((l) => l.id !== id),
      ...(model.segments ? { segments: model.segments.filter((g) => g.id !== id) } : {}),
    });
    setSelected(null);
    if (item) announce(t('engineering.common.removed', { name: itemName(item, model) }));
  };

  /** Moves an item so its reference point (x, or x1 for a distributed load) is at `x`. */
  const moved = (item: Item, x: number): BeamModel => {
    const on = clamp(snapToStep(x, step), 0, model.length);
    const range = rangeOf(item);
    if (!range) return update(item.part.id, { x: on });
    const span = range.x2 - range.x1;
    const x1 = clamp(on, 0, model.length - span);
    return update(item.part.id, { x1, x2: x1 + span });
  };

  const reference = itemStart;

  return (
    <div className={styles.root}>
      {readOnly ? null : (
        <div className={styles.bar} role="toolbar" aria-label={t('engineering.beam.block')}>
          <Button onClick={() => add('pin')}>{t('engineering.beam.pin')}</Button>
          <Button onClick={() => add('roller')}>{t('engineering.beam.roller')}</Button>
          <Button onClick={() => add('fixed')}>{t('engineering.beam.fixed')}</Button>
          <Button onClick={() => add('hinge')}>{t('engineering.beam.hinge')}</Button>
          <Button onClick={() => add('point')}>{t('engineering.beam.pointLoad')}</Button>
          <Button onClick={() => add('distributed')}>{t('engineering.beam.distributed')}</Button>
          <Button onClick={() => add('moment')}>{t('engineering.beam.moment')}</Button>
          <Button onClick={() => add('segment')}>{t('engineering.beam.segment')}</Button>
          <NumberField
            label={t('engineering.beam.length')}
            value={model.length}
            min={0.1}
            onChange={(length) => commit({ ...model, length })}
          />
          <TextInput
            label={t('engineering.common.forceUnit')}
            value={model.forceUnit}
            onChange={(forceUnit) => commit({ ...model, forceUnit: forceUnit || 'N' })}
          />
          <TextInput
            label={t('engineering.common.lengthUnit')}
            value={model.lengthUnit}
            onChange={(lengthUnit) => commit({ ...model, lengthUnit: lengthUnit || 'm' })}
          />
        </div>
      )}
      <div className={styles.layout}>
        <div className={styles.drawing} ref={drawing}>
          <Canvas
            label={t('engineering.beam.canvas')}
            columns={COLUMNS}
            rows={ROWS}
            onBackground={() => setSelected(null)}
          >
            <BeamLine length={model.length} unit={model.lengthUnit} />
            {items.map((item) => (
              <BeamItem
                key={item.part.id}
                item={item}
                model={model}
                selected={item.part.id === selected}
                readOnly={readOnly}
                onSelect={() => setSelected(item.part.id)}
                onDrag={(x, done) => (done ? commit(moved(item, x)) : draft(moved(item, x)))}
                onKey={(event) =>
                  onPartKey(
                    event,
                    step,
                    readOnly
                      ? { select: () => setSelected(item.part.id) }
                      : {
                          select: () => setSelected(item.part.id),
                          move: (dx) => commit(moved(item, reference(item) + Math.sign(dx) * step)),
                          remove: () => remove(item.part.id),
                        },
                  )
                }
              />
            ))}
          </Canvas>
          <Diagram result={result} model={model} which="shear" />
          <Diagram result={result} model={model} which="moment" />
          {readOnly ? null : <KeysHint />}
        </div>
        <BeamResults result={result} model={model} />
      </div>
      {readOnly ? null : current ? (
        <ItemFields
          item={current}
          name={itemName(current, model)}
          onChange={(change) => commit(update(current.part.id, change))}
          onRemove={() => remove(current.part.id)}
        />
      ) : (
        <p className={styles.hint}>{t('engineering.common.noneSelected')}</p>
      )}
    </div>
  );
}

/** An item's reference point: x, or the start of a distributed load or EI segment. */
function itemStart(item: Item): number {
  const range = rangeOf(item);
  if (range) return range.x1;
  return 'x' in item.part ? item.part.x : 0;
}

/** The stretch a distributed load or EI segment covers; null for things at one point. */
function rangeOf(item: Item): { x1: number; x2: number } | null {
  if (item.kind === 'segment') return item.part;
  if (item.kind === 'load' && item.part.kind === 'distributed') return item.part;
  return null;
}

const toCanvas = (x: number, length: number) => LEFT + (x / length) * SPAN;

function BeamLine({ length, unit }: { length: number; unit: string }) {
  const view = useView();
  const y = view.sy(AXIS);
  return (
    <g aria-hidden="true">
      <rect className={styles.body} x={view.sx(LEFT)} y={y - 5} width={SPAN * view.scale} height={10} rx={2} />
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <text key={f} className={styles.muted} x={view.sx(LEFT + f * SPAN) - 8} y={view.sy(0.2)}>
          {`${fmt(f * length)} ${f === 1 ? unit : ''}`.trim()}
        </text>
      ))}
    </g>
  );
}

interface ItemProps {
  item: Item;
  model: BeamModel;
  selected: boolean;
  readOnly: boolean;
  onSelect(): void;
  onDrag(x: number, done: boolean): void;
  onKey(event: KeyboardEvent): void;
}

function BeamItem({ item, model, selected, readOnly, onSelect, onDrag, onKey }: ItemProps) {
  const view = useView();
  const L = model.length;
  const at = (x: number) => view.sx(toCanvas(x, L));
  const axis = view.sy(AXIS);
  const start = (event: ReactPointerEvent) => {
    onSelect();
    if (readOnly) return;
    const origin = itemStart(item);
    let last = origin;
    view.drag(
      event,
      (p, grab) => {
        last = origin + ((p.x - grab.x) / SPAN) * L;
        onDrag(last, false);
      },
      () => onDrag(last, true),
    );
  };
  const shape = itemGlyph(item, model, at, axis, view.scale);
  return (
    <g
      className={`${styles.part} ${selected ? styles.selected : ''}`}
      data-part={item.part.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={itemName(item, model)}
      onPointerDown={start}
      onFocus={onSelect}
      onKeyDown={onKey}
    >
      {shape}
    </g>
  );
}

/** What a support or load looks like on a beam drawn from `at(0)` to `at(L)` along screen height `axis`. */
function itemGlyph(item: Item, model: BeamModel, at: (x: number) => number, axis: number, scale: number): ReactNode {
  const L = model.length;
  const view = { scale };
  if (item.kind === 'segment') {
    const [left, right] = [at(item.part.x1), at(item.part.x2)];
    return (
      <>
        <rect className={styles.halo} x={left} y={axis - 9} width={right - left} height={18} rx={3} />
        <rect className={styles.loadFill} x={left} y={axis - 7} width={right - left} height={14} opacity={0.3} />
        <text className={styles.label} x={left} y={axis + 22}>
          {t('engineering.beam.segmentLabel', { factor: fmt(item.part.factor) })}
        </text>
      </>
    );
  }
  if (item.kind === 'support' && item.part.kind === 'hinge') {
    const x = at(item.part.x);
    return (
      <>
        <circle className={styles.halo} cx={x} cy={axis} r={14} />
        <circle className={styles.hinge} cx={x} cy={axis} r={6} />
      </>
    );
  }
  if (item.kind === 'support') {
    const x = at(item.part.x);
    return item.part.kind === 'fixed' ? (
      <>
        <circle className={styles.halo} cx={x} cy={axis} r={16} />
        <g transform={`translate(${x} ${axis}) rotate(${item.part.x < L / 2 ? 90 : -90})`}>
          <SupportSymbol kind="fixed" />
        </g>
      </>
    ) : (
      <>
        <circle className={styles.halo} cx={x} cy={axis + 14} r={16} />
        <g transform={`translate(${x} ${axis + 5})`}>
          <SupportSymbol kind={item.part.kind === 'roller' ? 'roller' : 'pin'} />
        </g>
      </>
    );
  } else if (item.part.kind === 'point') {
    const x = at(item.part.x);
    const down = item.part.value >= 0;
    const top = axis - 1.4 * view.scale;
    return (
      <>
        <rect className={styles.halo} x={x - 10} y={top - 4} width={20} height={axis - top} />
        <path className={styles.load} d={down ? arrowPath(x, top, x, axis - 6) : arrowPath(x, axis - 6, x, top)} />
        <text className={styles.label} x={x + 12} y={top + 4}>
          {`${fmt(Math.abs(item.part.value))} ${model.forceUnit}`}
        </text>
      </>
    );
  } else if (item.part.kind === 'moment') {
    const x = at(item.part.x);
    return (
      <>
        <circle className={styles.halo} cx={x} cy={axis} r={22} />
        <path className={styles.load} d={momentPath(x, axis, 18, item.part.value >= 0)} />
        <text className={styles.label} x={x + 20} y={axis - 20}>
          {`${fmt(Math.abs(item.part.value))} ${model.forceUnit}·${model.lengthUnit}`}
        </text>
      </>
    );
  } else {
    const { x1, x2, w1, w2 } = item.part;
    const biggest = Math.max(Math.abs(w1), Math.abs(w2), 1e-9);
    const height = (w: number) => (Math.abs(w) / biggest) * 1.1 * view.scale + 6;
    const [left, right] = [at(x1), at(x2)];
    const count = Math.max(2, Math.round((right - left) / 22));
    const arrows: ReactNode[] = [];
    for (let i = 0; i <= count; i++) {
      const f = i / count;
      const x = left + f * (right - left);
      const w = w1 + f * (w2 - w1);
      const top = axis - 6 - height(w);
      arrows.push(<path key={i} className={styles.load} d={arrowPath(x, top, x, axis - 6, 6)} />);
    }
    return (
      <>
        <path
          className={styles.loadFill}
          d={`M${left} ${axis - 6}L${left} ${axis - 6 - height(w1)}L${right} ${axis - 6 - height(w2)}L${right} ${axis - 6}Z`}
          opacity={0.35}
        />
        {arrows}
        <text className={styles.label} x={left} y={axis - 12 - Math.max(height(w1), height(w2))}>
          {w1 === w2
            ? q(w1, `${model.forceUnit}/${model.lengthUnit}`)
            : t('engineering.beam.varyingLabel', {
                w1: fmt(w1),
                w2: q(w2, `${model.forceUnit}/${model.lengthUnit}`),
              })}
        </text>
      </>
    );
  }
}

const PLOT_W = COLUMNS * 40 + 32;
const PLOT_H = 136;

function Diagram({ result, model, which }: { result: BeamResult; model: BeamModel; which: 'shear' | 'moment' }) {
  const svg = useRef<SVGSVGElement>(null);
  useSvgScale(svg, PLOT_W);
  const samples = result.samples;
  const values = samples.map((s: BeamSample) => s[which]);
  const top = Math.max(0, ...values);
  const bottom = Math.min(0, ...values);
  const range = top - bottom || 1;
  const sx = (x: number) => 16 + toCanvas(x, model.length) * 40;
  // Shear and sagging moment are drawn above the axis when positive.
  const sy = (v: number) => 30 + ((top - v) / range) * (PLOT_H - 48);
  const zero = sy(0);
  const path =
    samples.length > 0
      ? `M${sx(samples[0].x)} ${zero}` +
        samples.map((s) => `L${sx(s.x)} ${sy(s[which])}`).join('') +
        `L${sx(samples[samples.length - 1].x)} ${zero}Z`
      : '';
  const name = t(which === 'shear' ? 'engineering.beam.shear' : 'engineering.beam.bending');
  const unit = which === 'shear' ? model.forceUnit : `${model.forceUnit}·${model.lengthUnit}`;
  const peak = which === 'shear' ? result.maxShear : result.maxMoment;
  return (
    <figure className={styles.figure}>
      <svg
        ref={svg}
        className={styles.plot}
        viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
        width={PLOT_W}
        role="img"
        aria-label={t('engineering.beam.diagramLabel', {
          name,
          min: `${fmt(bottom)} ${unit}`,
          max: `${fmt(top)} ${unit}`,
        })}
      >
        <path className={styles.area} d={path} />
        <line className={styles.axis} x1={sx(0)} y1={zero} x2={sx(model.length)} y2={zero} />
        <text className={styles.label} x={8} y={13}>
          {name}
        </text>
        {peak.value !== 0 ? (
          <text
            className={styles.muted}
            x={clamp(sx(peak.x) + 8, 0, PLOT_W - 90)}
            y={clamp(sy(peak.value) + (peak.value > 0 ? -8 : 16), 28, PLOT_H - 3)}
          >
            {`${fmt(peak.value)} ${unit}`}
          </text>
        ) : null}
      </svg>
    </figure>
  );
}

function BeamResults({ result, model }: { result: BeamResult; model: BeamModel }) {
  const unit = model.lengthUnit;
  const force = model.forceUnit;
  const moment = `${force}·${unit}`;
  const status = {
    determinate: t('engineering.beam.determinate'),
    indeterminate: t('engineering.beam.indeterminate'),
    unstable: t('engineering.beam.unstable'),
    none: t('engineering.beam.noSupports'),
  }[result.status];
  return (
    <div className={styles.results} role="group" aria-label={t('engineering.common.results')}>
      {result.reactions.length > 0 ? (
        <table>
          <caption>{t('engineering.beam.reactions')}</caption>
          <tbody>
            {result.reactions.flatMap((r) => {
              const support = model.supports.find((s) => s.id === r.support);
              const kind = t(`engineering.beam.${support?.kind ?? 'pin'}`);
              const rows = [
                <tr key={`${r.support}f`}>
                  <th scope="row">{t('engineering.beam.reactionForce', { name: kind, x: q(r.x, unit) })}</th>
                  <td>{`${fmt(r.force)} ${force}`}</td>
                </tr>,
              ];
              if (r.moment !== undefined)
                rows.push(
                  <tr key={`${r.support}m`}>
                    <th scope="row">{t('engineering.beam.reactionMoment', { x: q(r.x, unit) })}</th>
                    <td>{`${fmt(r.moment)} ${moment}`}</td>
                  </tr>,
                );
              return rows;
            })}
          </tbody>
        </table>
      ) : null}
      {result.reactions.length > 0 ? (
        <>
          <p className={styles.status}>
            {t('engineering.beam.maxShear', { force: q(result.maxShear.value, force), x: q(result.maxShear.x, unit) })}
          </p>
          <p className={styles.status}>
            {t('engineering.beam.maxMoment', {
              moment: q(result.maxMoment.value, moment),
              x: q(result.maxMoment.x, unit),
            })}
          </p>
          {result.zeroShear.length > 0 ? (
            <p className={styles.status}>
              {t('engineering.beam.zeroShear', { list: result.zeroShear.map((x) => q(x, unit)).join(', ') })}
            </p>
          ) : null}
        </>
      ) : null}
      <p className={styles.status} aria-live="polite">
        {status}
      </p>
    </div>
  );
}

interface FieldsProps {
  item: Item;
  name: string;
  onChange(change: Change): void;
  onRemove(): void;
}

function ItemFields({ item, name, onChange, onRemove }: FieldsProps) {
  return (
    <div className={styles.fields} role="group" aria-label={name}>
      {item.kind === 'support' ? (
        <NumberField label={t('engineering.beam.at')} value={item.part.x} onChange={(x) => onChange({ x })} />
      ) : item.kind === 'segment' ? (
        <>
          <NumberField label={t('engineering.beam.start')} value={item.part.x1} onChange={(x1) => onChange({ x1 })} />
          <NumberField label={t('engineering.beam.end')} value={item.part.x2} onChange={(x2) => onChange({ x2 })} />
          <NumberField
            label={t('engineering.beam.factor')}
            value={item.part.factor}
            min={0.01}
            onChange={(factor) => onChange({ factor })}
          />
        </>
      ) : (
        <LoadFields load={item.part} onChange={onChange} />
      )}
      {item.kind === 'load' ? <p className={styles.hint}>{t('engineering.beam.loadHint')}</p> : null}
      {item.kind === 'segment' ? <p className={styles.hint}>{t('engineering.beam.segmentHint')}</p> : null}
      {item.kind === 'support' && item.part.kind === 'hinge' ? (
        <p className={styles.hint}>{t('engineering.beam.hingeHint')}</p>
      ) : null}
      <Button variant="danger" onClick={onRemove}>
        {t('engineering.common.removeSelected')}
      </Button>
    </div>
  );
}

function LoadFields({ load: part, onChange }: { load: BeamLoad; onChange(change: Partial<BeamLoad>): void }) {
  return part.kind === 'distributed' ? (
    <>
      <NumberField label={t('engineering.beam.start')} value={part.x1} onChange={(x1) => onChange({ x1 })} />
      <NumberField label={t('engineering.beam.end')} value={part.x2} onChange={(x2) => onChange({ x2 })} />
      <NumberField label={t('engineering.beam.w1')} value={part.w1} onChange={(w1) => onChange({ w1 })} />
      <NumberField label={t('engineering.beam.w2')} value={part.w2} onChange={(w2) => onChange({ w2 })} />
    </>
  ) : (
    <>
      <NumberField label={t('engineering.beam.at')} value={part.x} onChange={(x) => onChange({ x })} />
      <NumberField
        label={t('engineering.common.magnitude')}
        value={part.value}
        onChange={(value) => onChange({ value })}
      />
    </>
  );
}
