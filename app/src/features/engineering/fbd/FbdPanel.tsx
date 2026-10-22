// The free-body diagram kit (item 6): a body, forces, moments, and supports as shapes that snap to the grid and to
// each other, with ΣFx, ΣFy, and ΣM worked out beside the drawing as the parts change. When the supports give three
// unknowns the reactions are solved and drawn dashed. Every part can be reached and moved from the keyboard.
import { useCallback, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { t } from '../../../strings/t';
import { Button } from '../../../ui';
import { Canvas, onPartKey, useView } from '../canvas/Canvas';
import { NumberField, TextInput } from '../canvas/Field';
import { arrowPath, boxAnchors, momentPath, snapPoint, snapToStep } from '../canvas/geometry';
import type { Point } from '../canvas/geometry';
import { fmt, q, useBlockModel } from '../canvas/shared';
import type { BlockProps } from '../canvas/shared';
import { KeysHint } from '../canvas/KeysHint';
import styles from '../canvas/canvas.module.css';
import { FBD_COLUMNS, FBD_ROWS, nextId, nextLabel, readFbd } from './model';
import type { FbdModel, FbdPart, ForcePart, MomentPart, SupportKind } from './model';
import { normalize, solveFbd } from './solve';
import type { FbdResult, Reaction } from './solve';

const STEP = 0.5;
const ARROW = 1.6;

const SUPPORT_NAMES: Record<SupportKind, 'engineering.fbd.pin' | 'engineering.fbd.roller' | 'engineering.fbd.fixed'> = {
  pin: 'engineering.fbd.pin',
  roller: 'engineering.fbd.roller',
  fixed: 'engineering.fbd.fixed',
};

export function partName(part: FbdPart, model: FbdModel): string {
  const at = { x: fmt(part.x), y: fmt(part.y) };
  switch (part.kind) {
    case 'body':
      return t('engineering.fbd.partBody', { ...at, w: fmt(part.w), h: fmt(part.h) });
    case 'force':
      return t('engineering.fbd.partForce', {
        ...at,
        label: part.label,
        force: q(part.magnitude, model.forceUnit),
        angle: fmt(normalize(part.angle)),
      });
    case 'moment':
      return t('engineering.fbd.partMoment', {
        ...at,
        label: part.label,
        moment: q(part.magnitude, `${model.forceUnit}·${model.lengthUnit}`),
      });
    case 'support':
      return t('engineering.fbd.partSupport', { ...at, label: part.label, kind: t(SUPPORT_NAMES[part.support]) });
  }
}

/** The block's text for search, read aloud, and readers without the feature. */
export function fbdFallback(model: FbdModel): string {
  const result = solveFbd(model);
  const parts = model.parts.filter((part) => part.kind !== 'body').map((part) => partName(part, model));
  const unit = model.forceUnit;
  const reactions = result.reactions.map((r) => `${r.name} = ${fmt(r.value)}`).join(', ');
  return [
    t('engineering.fbd.fallback', {
      parts: parts.join('; '),
      fx: `${fmt(result.sumFx)} ${unit}`,
      fy: `${fmt(result.sumFy)} ${unit}`,
      m: `${fmt(result.sumM)} ${unit}·${model.lengthUnit}`,
    }),
    reactions,
  ]
    .filter(Boolean)
    .join(' ');
}

function anchorsOf(model: FbdModel, except: string | null): Point[] {
  const out: Point[] = [model.origin];
  for (const part of model.parts) {
    if (part.id === except) continue;
    if (part.kind === 'body') out.push(...boxAnchors(part.x, part.y, part.w, part.h));
    else out.push({ x: part.x, y: part.y });
  }
  return out;
}

const replace = (model: FbdModel, id: string, change: Partial<FbdPart>): FbdModel => ({
  ...model,
  parts: model.parts.map((part) => (part.id === id ? ({ ...part, ...change } as FbdPart) : part)),
});

const inside = (body: FbdPart & { kind: 'body' }, p: Point) =>
  Math.abs(p.x - body.x) <= body.w / 2 + 0.01 && Math.abs(p.y - body.y) <= body.h / 2 + 0.01;

/** Moves a body by (dx, dy) and everything attached to it: parts that act on its outline or inside it. */
function moveBody(model: FbdModel, id: string, dx: number, dy: number): FbdModel {
  const body = model.parts.find((part) => part.id === id);
  if (!body || body.kind !== 'body') return model;
  const attached = new Set(
    model.parts.filter((part) => part.kind !== 'body' && inside(body, part)).map((part) => part.id),
  );
  const moved = (p: Point) => ({ x: snapToStep(p.x + dx, 0.001), y: snapToStep(p.y + dy, 0.001) });
  return {
    ...model,
    origin: inside(body, model.origin) ? moved(model.origin) : model.origin,
    parts: model.parts.map((part) =>
      part.id === id || attached.has(part.id) ? ({ ...part, ...moved(part) } as FbdPart) : part,
    ),
  };
}

// checks-disable-next-line modifiability: one editor whose toolbar, drawing, and results share its state
export function FbdPanel({ data, readOnly, patch, announce }: BlockProps) {
  const save = useCallback((next: FbdModel) => patch({ model: next }, fbdFallback(next)), [patch]);
  const { model, draft, commit } = useBlockModel(data.model, readFbd, save);
  const [selected, setSelected] = useState<string | null>(null);
  const result = useMemo(() => solveFbd(model), [model]);
  const current = model.parts.find((part) => part.id === selected) ?? null;
  const drawing = useRef<HTMLDivElement>(null);

  const add = (kind: 'body' | 'force' | 'moment' | SupportKind) => {
    const body = model.parts.find((part) => part.kind === 'body');
    const cx = body?.x ?? FBD_COLUMNS / 2;
    const cy = body?.y ?? FBD_ROWS / 2;
    const top = body ? body.y + body.h / 2 : cy;
    const bottom = body ? body.y - body.h / 2 : cy;
    const left = body ? body.x - body.w / 2 : cx;
    const right = body ? body.x + body.w / 2 : cx;
    const id = nextId(model.parts);
    let part: FbdPart;
    if (kind === 'body') part = { id, kind, x: FBD_COLUMNS / 2, y: FBD_ROWS / 2, w: 6, h: 1 };
    else if (kind === 'force')
      part = { id, kind, x: cx, y: top, angle: 270, magnitude: 10, label: nextLabel(model.parts, 'F') };
    else if (kind === 'moment') part = { id, kind, x: cx, y: cy, magnitude: 5, label: nextLabel(model.parts, 'M') };
    else {
      const supports = model.parts.filter((one) => one.kind === 'support').length;
      const letter = String.fromCharCode(65 + (supports % 26));
      const label = model.parts.some((one) => 'label' in one && one.label === letter)
        ? nextLabel(model.parts, 'S')
        : letter;
      part =
        kind === 'fixed'
          ? { id, kind: 'support', support: kind, x: left, y: cy, angle: 0, label }
          : { id, kind: 'support', support: kind, x: supports % 2 === 0 ? left : right, y: bottom, angle: 90, label };
    }
    commit({ ...model, parts: [...model.parts, part] });
    setSelected(id);
    announce(t('engineering.common.added', { name: partName(part, model) }));
    requestAnimationFrame(() => drawing.current?.querySelector<SVGElement>(`[data-part="${id}"]`)?.focus());
  };

  const remove = (id: string) => {
    const part = model.parts.find((one) => one.id === id);
    if (!part) return;
    commit({ ...model, parts: model.parts.filter((one) => one.id !== id) });
    setSelected(null);
    announce(t('engineering.common.removed', { name: partName(part, model) }));
  };

  const change = (id: string, values: Partial<FbdPart>) => commit(replace(model, id, values));

  return (
    <div className={styles.root}>
      {readOnly ? null : (
        <div className={styles.bar} role="toolbar" aria-label={t('engineering.fbd.block')}>
          <Button onClick={() => add('body')}>{t('engineering.fbd.body')}</Button>
          <Button onClick={() => add('force')}>{t('engineering.fbd.force')}</Button>
          <Button onClick={() => add('moment')}>{t('engineering.fbd.moment')}</Button>
          <Button onClick={() => add('pin')}>{t('engineering.fbd.pin')}</Button>
          <Button onClick={() => add('roller')}>{t('engineering.fbd.roller')}</Button>
          <Button onClick={() => add('fixed')}>{t('engineering.fbd.fixed')}</Button>
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
            label={t('engineering.fbd.canvas')}
            columns={FBD_COLUMNS}
            rows={FBD_ROWS}
            onBackground={() => setSelected(null)}
          >
            {model.parts.map((part) => (
              <PartShape
                key={part.id}
                part={part}
                model={model}
                selected={part.id === selected}
                readOnly={readOnly}
                onSelect={() => setSelected(part.id)}
                onDraft={draft}
                onCommit={commit}
                onRemove={() => remove(part.id)}
              />
            ))}
            {result.status === 'solved' ? <Reactions model={model} reactions={result.reactions} /> : null}
            <Origin model={model} readOnly={readOnly} onDraft={draft} onCommit={commit} />
          </Canvas>
          {readOnly ? null : <KeysHint />}
        </div>
        <Results model={model} result={result} />
      </div>
      {readOnly ? null : current ? (
        <PartFields
          part={current}
          name={partName(current, model)}
          onChange={(values) => change(current.id, values)}
          onRemove={() => remove(current.id)}
          onOrigin={() => commit({ ...model, origin: { x: current.x, y: current.y } })}
        />
      ) : (
        <p className={styles.hint}>{t('engineering.common.noneSelected')}</p>
      )}
    </div>
  );
}

interface ShapeProps {
  part: FbdPart;
  model: FbdModel;
  selected: boolean;
  readOnly: boolean;
  onSelect(): void;
  onDraft(model: FbdModel): void;
  onCommit(model?: FbdModel): void;
  onRemove(): void;
}

function PartShape({ part, model, selected, readOnly, onSelect, onDraft, onCommit, onRemove }: ShapeProps) {
  const view = useView();
  const px = view.sx(part.x);
  const py = view.sy(part.y);

  const startMove = (event: ReactPointerEvent) => {
    onSelect();
    if (readOnly) return;
    const anchors = anchorsOf(model, part.id);
    let latest = model;
    const origin = { x: part.x, y: part.y };
    view.drag(
      event,
      (p, grab) => {
        if (part.kind === 'body') {
          const dx = snapToStep(p.x - grab.x, STEP);
          const dy = snapToStep(p.y - grab.y, STEP);
          latest = moveBody(model, part.id, dx, dy);
        } else {
          const to = snapPoint({ x: origin.x + p.x - grab.x, y: origin.y + p.y - grab.y }, anchors, STEP);
          latest = replace(model, part.id, to);
        }
        onDraft(latest);
      },
      () => {
        if (latest !== model) onCommit(latest);
      },
    );
  };

  const turnHead = (event: ReactPointerEvent) => {
    if (readOnly || part.kind !== 'force') return;
    onSelect();
    let latest = model;
    view.drag(
      event,
      (p) => {
        const angle = snapToStep((Math.atan2(p.y - part.y, p.x - part.x) * 180) / Math.PI, 15);
        latest = replace(model, part.id, { angle: normalize(angle) });
        onDraft(latest);
      },
      () => {
        if (latest !== model) onCommit(latest);
      },
    );
  };

  const keys = readOnly ? { select: onSelect } : editKeys(part, model, onSelect, onCommit, onRemove);
  const shape = glyph(part, model, px, py, view.scale, turnHead);

  return (
    <g
      className={`${styles.part} ${selected ? styles.selected : ''}`}
      data-part={part.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={partName(part, model)}
      onPointerDown={(event) => {
        if ((event.target as Element).hasAttribute('data-head')) return;
        startMove(event);
      }}
      onFocus={onSelect}
      onKeyDown={(event) => onPartKey(event, STEP, keys)}
    >
      {shape}
    </g>
  );
}

function editKeys(
  part: FbdPart,
  model: FbdModel,
  onSelect: () => void,
  onCommit: (model?: FbdModel) => void,
  onRemove: () => void,
) {
  return {
    select: onSelect,
    move: (dx: number, dy: number) =>
      onCommit(
        part.kind === 'body'
          ? moveBody(model, part.id, dx, dy)
          : replace(model, part.id, { x: snapToStep(part.x + dx, 0.1), y: snapToStep(part.y + dy, 0.1) }),
      ),
    rotate: (by: number) => {
      if (part.kind === 'force' || part.kind === 'support')
        onCommit(replace(model, part.id, { angle: normalize(part.angle + by) }));
    },
    remove: onRemove,
  };
}

/** What a part looks like, at screen point (px, py). */
function glyph(
  part: FbdPart,
  model: FbdModel,
  px: number,
  py: number,
  scale: number,
  onHead: (event: ReactPointerEvent) => void,
): ReactNode {
  switch (part.kind) {
    case 'body':
      return <BodyGlyph px={px} py={py} w={part.w * scale} h={part.h * scale} />;
    case 'force':
      return <ForceGlyph part={part} model={model} px={px} py={py} scale={scale} onHead={onHead} />;
    case 'moment':
      return <MomentGlyph part={part} model={model} px={px} py={py} r={0.6 * scale} />;
    case 'support':
      return (
        <>
          <circle className={styles.halo} cx={px} cy={py} r={14} />
          <g transform={`translate(${px} ${py}) rotate(${90 - part.angle})`}>
            <SupportSymbol kind={part.support} />
          </g>
          <text className={styles.label} x={px - 22} y={py + 4}>
            {part.label}
          </text>
        </>
      );
  }
}

function BodyGlyph({ px, py, w, h }: { px: number; py: number; w: number; h: number }) {
  return (
    <>
      <rect className={styles.halo} x={px - w / 2 - 4} y={py - h / 2 - 4} width={w + 8} height={h + 8} />
      <rect className={styles.body} x={px - w / 2} y={py - h / 2} width={w} height={h} rx={3} />
    </>
  );
}

interface ForceGlyphProps {
  part: ForcePart;
  model: FbdModel;
  px: number;
  py: number;
  scale: number;
  onHead(event: ReactPointerEvent): void;
}

function ForceGlyph({ part, model, px, py, scale, onHead }: ForceGlyphProps) {
  const a = (part.angle * Math.PI) / 180;
  const hx = px + ARROW * scale * Math.cos(a);
  const hy = py - ARROW * scale * Math.sin(a);
  return (
    <>
      <circle className={styles.halo} cx={px} cy={py} r={9} />
      <path className={styles.load} d={arrowPath(px, py, hx, hy, 10)} />
      <circle className={styles.dot} cx={px} cy={py} r={3} />
      <circle data-head="" className={styles.halo} cx={hx} cy={hy} r={9} onPointerDown={onHead} />
      <text className={styles.label} x={hx + 6} y={hy - 6}>
        {`${part.label} = ${q(part.magnitude, model.forceUnit)}`}
      </text>
    </>
  );
}

interface MomentGlyphProps {
  part: MomentPart;
  model: FbdModel;
  px: number;
  py: number;
  r: number;
}

function MomentGlyph({ part, model, px, py, r }: MomentGlyphProps) {
  return (
    <>
      <circle className={styles.halo} cx={px} cy={py} r={r + 4} />
      <path className={styles.load} d={momentPath(px, py, r, part.magnitude >= 0)} />
      <circle className={styles.dot} cx={px} cy={py} r={3} />
      <text className={styles.label} x={px + r + 4} y={py - r}>
        {`${part.label} = ${q(Math.abs(part.magnitude), `${model.forceUnit}·${model.lengthUnit}`)}`}
      </text>
    </>
  );
}

/** A support drawn for a reaction pointing up the page: the symbol sits under the point. */
export function SupportSymbol({ kind }: { kind: SupportKind }) {
  if (kind === 'fixed') {
    return (
      <g className={styles.ink}>
        <line x1={-18} y1={0} x2={18} y2={0} strokeWidth={3} />
        {[-14, -6, 2, 10].map((x) => (
          <line key={x} x1={x} y1={2} x2={x + 7} y2={10} />
        ))}
      </g>
    );
  }
  const base = kind === 'pin' ? 16 : 12;
  return (
    <g className={styles.ink}>
      <path d={`M0 0L-10 ${base}L10 ${base}Z`} />
      {kind === 'roller' ? (
        <>
          <circle cx={-5} cy={16} r={3.5} />
          <circle cx={5} cy={16} r={3.5} />
          <line x1={-16} y1={20} x2={16} y2={20} />
        </>
      ) : (
        <>
          <line x1={-16} y1={16} x2={16} y2={16} />
          {[-12, -4, 4, 12].map((x) => (
            <line key={x} x1={x} y1={16} x2={x - 5} y2={22} />
          ))}
        </>
      )}
    </g>
  );
}

function Reactions({ model, reactions }: { model: FbdModel; reactions: readonly Reaction[] }) {
  const view = useView();
  return (
    <g aria-hidden="true">
      {reactions.map((reaction) => {
        const support = model.parts.find((part) => part.id === reaction.support);
        if (!support || reaction.value === 0) return null;
        const px = view.sx(support.x);
        const py = view.sy(support.y);
        const text = `${reaction.name} = ${fmt(Math.abs(reaction.value))}`;
        if (reaction.component === 'm') {
          const r = 0.8 * view.scale;
          return (
            <g key={reaction.name}>
              <path className={styles.reaction} d={momentPath(px, py, r, reaction.value > 0)} />
              <text className={styles.muted} x={px - r} y={py - r - 4}>
                {text}
              </text>
            </g>
          );
        }
        const degrees = reaction.component === 'x' ? 0 : reaction.component === 'y' ? 90 : (reaction.angle ?? 90);
        const a = ((degrees + (reaction.value < 0 ? 180 : 0)) * Math.PI) / 180;
        const length = 1.2 * view.scale;
        // Drawn pushing on the support point, from outside the body.
        const tx = px - length * Math.cos(a);
        const ty = py + length * Math.sin(a);
        return (
          <g key={reaction.name}>
            <path className={styles.reaction} d={arrowPath(tx, ty, px, py, 8)} />
            <text className={styles.muted} x={tx + 4} y={ty + (Math.sin(a) > 0 ? 12 : -4)}>
              {text}
            </text>
          </g>
        );
      })}
    </g>
  );
}

interface OriginProps {
  model: FbdModel;
  readOnly: boolean;
  onDraft(model: FbdModel): void;
  onCommit(model?: FbdModel): void;
}

function Origin({ model, readOnly, onDraft, onCommit }: OriginProps) {
  const view = useView();
  const px = view.sx(model.origin.x);
  const py = view.sy(model.origin.y);
  const move = (to: Point) => ({ ...model, origin: to });
  return (
    <g
      className={styles.part}
      role="button"
      tabIndex={0}
      aria-label={t('engineering.fbd.partOrigin', { x: fmt(model.origin.x), y: fmt(model.origin.y) })}
      onPointerDown={(event) => {
        if (readOnly) return;
        const anchors = anchorsOf(model, null);
        let latest = model;
        view.drag(
          event,
          (p) => {
            latest = move(snapPoint(p, anchors, STEP));
            onDraft(latest);
          },
          () => onCommit(latest),
        );
      }}
      onKeyDown={(event) =>
        readOnly
          ? undefined
          : onPartKey(event, STEP, {
              move: (dx, dy) =>
                onCommit(move({ x: snapToStep(model.origin.x + dx, 0.1), y: snapToStep(model.origin.y + dy, 0.1) })),
            })
      }
    >
      <circle className={styles.halo} cx={px} cy={py} r={9} />
      <circle className={styles.origin} cx={px} cy={py} r={6} />
      <path className={styles.origin} d={`M${px - 9} ${py}H${px + 9}M${px} ${py - 9}V${py + 9}`} />
      <text className={styles.muted} x={px + 8} y={py + 14}>
        {t('engineering.fbd.originMark')}
      </text>
    </g>
  );
}

function Results({ model, result }: { model: FbdModel; result: FbdResult }) {
  const force = model.forceUnit;
  const moment = `${model.forceUnit}·${model.lengthUnit}`;
  const status: Record<FbdResult['status'], string> = {
    solved: t('engineering.fbd.solved'),
    none: t('engineering.fbd.none'),
    indeterminate: t('engineering.fbd.indeterminate', { count: result.unknowns }),
    unstable: t('engineering.fbd.unstable'),
  };
  return (
    <section className={styles.results} aria-label={t('engineering.common.results')}>
      <h3>{t('engineering.fbd.sums')}</h3>
      <table>
        <tbody>
          <tr>
            <th scope="row">{t('engineering.fbd.sumFx')}</th>
            <td>{`${fmt(result.sumFx)} ${force}`}</td>
          </tr>
          <tr>
            <th scope="row">{t('engineering.fbd.sumFy')}</th>
            <td>{`${fmt(result.sumFy)} ${force}`}</td>
          </tr>
          <tr>
            <th scope="row">{t('engineering.fbd.sumM')}</th>
            <td>{`${fmt(result.sumM)} ${moment}`}</td>
          </tr>
        </tbody>
      </table>
      <p className={styles.status}>
        {t('engineering.fbd.resultant', {
          force: q(result.resultant.magnitude, force),
          angle: fmt(result.resultant.angle),
        })}
      </p>
      {result.status === 'solved' ? (
        <>
          <h4>{t('engineering.fbd.reactions')}</h4>
          <table>
            <tbody>
              {result.reactions.map((reaction) => (
                <tr key={reaction.name}>
                  <th scope="row">{reaction.name}</th>
                  <td>{`${fmt(reaction.value)} ${reaction.component === 'm' ? moment : force}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      <p className={styles.status} aria-live="polite">
        {status[result.status]}
      </p>
    </section>
  );
}

interface FieldsProps {
  part: FbdPart;
  name: string;
  onChange(values: Partial<FbdPart>): void;
  onRemove(): void;
  onOrigin(): void;
}

function PartFields({ part, name, onChange, onRemove, onOrigin }: FieldsProps) {
  return (
    <div className={styles.fields} role="group" aria-label={name}>
      {'label' in part ? (
        <TextInput label={t('engineering.common.label')} value={part.label} onChange={(label) => onChange({ label })} />
      ) : null}
      {part.kind === 'force' || part.kind === 'moment' ? (
        <NumberField
          label={t('engineering.common.magnitude')}
          value={part.magnitude}
          onChange={(magnitude) => onChange({ magnitude })}
        />
      ) : null}
      {part.kind === 'force' || (part.kind === 'support' && part.support !== 'pin') ? (
        <NumberField
          label={t('engineering.common.angle')}
          value={part.angle}
          onChange={(angle) => onChange({ angle: normalize(angle) })}
        />
      ) : null}
      <NumberField label={t('engineering.common.x')} value={part.x} onChange={(x) => onChange({ x })} />
      <NumberField label={t('engineering.common.y')} value={part.y} onChange={(y) => onChange({ y })} />
      {part.kind === 'body' ? (
        <>
          <NumberField label={t('engineering.fbd.width')} value={part.w} min={0.5} onChange={(w) => onChange({ w })} />
          <NumberField label={t('engineering.fbd.height')} value={part.h} min={0.5} onChange={(h) => onChange({ h })} />
        </>
      ) : null}
      {part.kind === 'moment' ? <p className={styles.hint}>{t('engineering.fbd.momentHint')}</p> : null}
      {part.kind === 'support' && part.support === 'roller' ? (
        <p className={styles.hint}>{t('engineering.fbd.rollerHint')}</p>
      ) : null}
      {part.kind !== 'body' ? <Button onClick={onOrigin}>{t('engineering.fbd.setOrigin')}</Button> : null}
      <Button variant="danger" onClick={onRemove}>
        {t('engineering.common.removeSelected')}
      </Button>
    </div>
  );
}
