// The truss solver block (item 7): joints on a grid, members between them, pin and roller supports, and joint loads.
// Member forces are solved as the truss changes and drawn on the members, blue in tension and red in compression,
// with a table beside the drawing that says T or C in words.
import { useCallback, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { t } from '../../../strings/t';
import { Button } from '../../../ui';
import { Canvas, onPartKey, useView } from '../canvas/Canvas';
import { NumberField, SelectField, TextInput } from '../canvas/Field';
import { arrowPath, snapPoint, snapToStep } from '../canvas/geometry';
import type { Point } from '../canvas/geometry';
import { fmt, q, useBlockModel } from '../canvas/shared';
import type { BlockProps } from '../canvas/shared';
import { KeysHint } from '../canvas/KeysHint';
import styles from '../canvas/canvas.module.css';
import { SupportSymbol } from '../fbd/FbdPanel';
import { readTruss, solveTruss } from './truss';
import type { Joint, Member, TrussModel, TrussResult } from './truss';

const COLUMNS = 16;
const ROWS = 8;
const STEP = 0.5;

type Mode = 'joints' | 'members';

const jointName = (joint: Joint) =>
  t('engineering.truss.partJoint', { label: joint.label || joint.id, x: fmt(joint.x), y: fmt(joint.y) });

function memberName(member: Member, model: TrussModel) {
  const label = (id: string) => model.joints.find((joint) => joint.id === id)?.label || id;
  return t('engineering.truss.partMember', { name: `${label(member.a)}${label(member.b)}` });
}

function forceText(value: number, unit: string): string {
  if (Math.abs(value) < 1e-9) return t('engineering.truss.zero');
  return t(value > 0 ? 'engineering.truss.tension' : 'engineering.truss.compression', {
    force: q(Math.abs(value), unit),
  });
}

export function trussFallback(model: TrussModel): string {
  const result = solveTruss(model);
  const forces = model.members
    .map((member) => {
      const force = result.forces.get(member.id);
      return force === undefined ? '' : `${memberName(member, model)} ${forceText(force, model.forceUnit)}`;
    })
    .filter(Boolean)
    .join('; ');
  return t('engineering.truss.fallback', {
    joints: model.joints.length,
    members: model.members.length,
    forces: forces || '—',
  });
}

function nextLabel(model: TrussModel): string {
  const used = new Set(model.joints.map((joint) => joint.label));
  for (let n = 0; n < 26 * 4; n++) {
    const label = String.fromCharCode(65 + (n % 26)) + (n >= 26 ? String(Math.floor(n / 26)) : '');
    if (!used.has(label)) return label;
  }
  return `J${model.joints.length + 1}`;
}

function nextId(ids: readonly string[], prefix: string): string {
  const used = new Set(ids);
  let n = ids.length + 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** Adds a member between two joints, unless they are the same joint or already joined. */
export function connect(model: TrussModel, a: string, b: string): TrussModel {
  if (a === b || model.members.some((m) => (m.a === a && m.b === b) || (m.a === b && m.b === a))) return model;
  const id = nextId(
    model.members.map((m) => m.id),
    'm',
  );
  return { ...model, members: [...model.members, { id, a, b }] };
}

// checks-disable-next-line modifiability: one editor whose toolbar, drawing, and results share its state
export function TrussPanel({ data, readOnly, patch, announce }: BlockProps) {
  const save = useCallback((next: TrussModel) => patch({ model: next }, trussFallback(next)), [patch]);
  const { model, draft, commit } = useBlockModel(data.model, readTruss, save);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('joints');
  const [pull, setPull] = useState<{ from: string; to: Point } | null>(null);
  const result = useMemo(() => solveTruss(model), [model]);
  const drawing = useRef<HTMLDivElement>(null);
  const joint = model.joints.find((one) => one.id === selected) ?? null;
  const member = model.members.find((one) => one.id === selected) ?? null;

  const addJoint = (p: Point) => {
    const at = { x: snapToStep(p.x, STEP), y: snapToStep(p.y, STEP) };
    if (at.x < 0 || at.y < 0 || at.x > COLUMNS || at.y > ROWS) return;
    if (model.joints.some((one) => one.x === at.x && one.y === at.y)) return;
    const made: Joint = {
      id: nextId(
        model.joints.map((one) => one.id),
        'j',
      ),
      label: nextLabel(model),
      ...at,
    };
    commit({ ...model, joints: [...model.joints, made] });
    setSelected(made.id);
    announce(t('engineering.common.added', { name: jointName(made) }));
  };

  const changeJoint = (id: string, change: Partial<Joint>) =>
    commit({ ...model, joints: model.joints.map((one) => (one.id === id ? { ...one, ...change } : one)) });

  const remove = (id: string) => {
    const name = joint ? jointName(joint) : member ? memberName(member, model) : '';
    commit({
      ...model,
      joints: model.joints.filter((one) => one.id !== id),
      members: model.members.filter((one) => one.id !== id && one.a !== id && one.b !== id),
    });
    setSelected(null);
    if (name) announce(t('engineering.common.removed', { name }));
  };

  const link = (a: string, b: string) => {
    const next = connect(model, a, b);
    if (next === model) return;
    commit(next);
    const made = next.members[next.members.length - 1];
    announce(t('engineering.common.added', { name: memberName(made, next) }));
  };

  return (
    <div className={styles.root}>
      {readOnly ? null : (
        <div className={styles.bar} role="toolbar" aria-label={t('engineering.truss.block')}>
          <div className={styles.bar} role="group" aria-label={t('engineering.truss.mode')}>
            <Button aria-pressed={mode === 'joints'} onClick={() => setMode('joints')}>
              {t('engineering.truss.modeJoints')}
            </Button>
            <Button aria-pressed={mode === 'members'} onClick={() => setMode('members')}>
              {t('engineering.truss.modeMembers')}
            </Button>
          </div>
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
            label={t('engineering.truss.canvas')}
            columns={COLUMNS}
            rows={ROWS}
            onBackground={(p) => {
              setSelected(null);
              if (!readOnly && mode === 'joints') addJoint(p);
            }}
          >
            {model.members.map((one) => (
              <MemberLine
                key={one.id}
                member={one}
                model={model}
                force={result.forces.get(one.id)}
                selected={one.id === selected}
                onSelect={() => setSelected(one.id)}
                onRemove={readOnly ? undefined : () => remove(one.id)}
              />
            ))}
            {pull ? <PullLine model={model} pull={pull} /> : null}
            {model.joints.map((one) => (
              <JointDot
                key={one.id}
                joint={one}
                model={model}
                mode={mode}
                selected={one.id === selected}
                readOnly={readOnly}
                onSelect={() => setSelected(one.id)}
                onDraft={draft}
                onCommit={commit}
                onPull={setPull}
                onLink={link}
                onRemove={() => remove(one.id)}
              />
            ))}
          </Canvas>
          {readOnly ? null : (
            <KeysHint lead={mode === 'joints' ? t('engineering.truss.jointHint') : t('engineering.truss.memberHint')} />
          )}
        </div>
        <TrussResults model={model} result={result} />
      </div>
      {readOnly ? null : joint ? (
        <JointFields
          joint={joint}
          model={model}
          onChange={(change) => changeJoint(joint.id, change)}
          onLink={(other) => link(joint.id, other)}
          onRemove={() => remove(joint.id)}
        />
      ) : member ? (
        <div className={styles.fields} role="group" aria-label={memberName(member, model)}>
          <Button variant="danger" onClick={() => remove(member.id)}>
            {t('engineering.common.removeSelected')}
          </Button>
        </div>
      ) : (
        <p className={styles.hint}>{t('engineering.common.noneSelected')}</p>
      )}
    </div>
  );
}

interface MemberProps {
  member: Member;
  model: TrussModel;
  force: number | undefined;
  selected: boolean;
  onSelect(): void;
  onRemove?: () => void;
}

function MemberLine({ member, model, force, selected, onSelect, onRemove }: MemberProps) {
  const view = useView();
  const a = model.joints.find((one) => one.id === member.a);
  const b = model.joints.find((one) => one.id === member.b);
  if (!a || !b) return null;
  const [x1, y1, x2, y2] = [view.sx(a.x), view.sy(a.y), view.sx(b.x), view.sy(b.y)];
  const labelAt = memberLabelAt(x1, y1, x2, y2);
  const tone = force === undefined || Math.abs(force) < 1e-9 ? '' : force > 0 ? styles.tension : styles.compression;
  return (
    <g
      className={`${styles.part} ${selected ? styles.selected : ''}`}
      data-part={member.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={
        force === undefined
          ? memberName(member, model)
          : `${memberName(member, model)}: ${forceText(force, model.forceUnit)}`
      }
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onFocus={onSelect}
      onKeyDown={(event) => onPartKey(event, STEP, { select: onSelect, ...(onRemove ? { remove: onRemove } : {}) })}
    >
      <line className={styles.halo} x1={x1} y1={y1} x2={x2} y2={y2} />
      <line className={`${styles.ink} ${tone}`} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={3} />
      {force !== undefined ? (
        <text className={styles.muted} x={labelAt.x} y={labelAt.y} textAnchor={labelAt.anchor}>
          {Math.abs(force) < 1e-9
            ? fmt(0)
            : t(force > 0 ? 'engineering.truss.shortTension' : 'engineering.truss.shortCompression', {
                value: fmt(Math.abs(force)),
              })}
        </text>
      ) : null}
    </g>
  );
}

/** A member's force label: centered beside the middle of the member, on its upper side, clear of the line. */
function memberLabelAt(x1: number, y1: number, x2: number, y2: number) {
  const [dx, dy] = [x2 - x1, y2 - y1];
  const length = Math.hypot(dx, dy) || 1;
  let [nx, ny] = [dy / length, -dx / length];
  if (ny > 0 || (ny === 0 && nx < 0)) [nx, ny] = [-nx, -ny];
  const gap = 11;
  const side = Math.abs(nx) > 0.8;
  return {
    x: (x1 + x2) / 2 + nx * gap * (side ? 1.2 : 1),
    y: (y1 + y2) / 2 + ny * gap + (side ? 4 : 3),
    anchor: side ? ('start' as const) : ('middle' as const),
  };
}

/** The load's label, past the tail of its arrow and away from the joint. */
function loadLabelAt(px: number, py: number, lx: number, ly: number, length: number) {
  const [ux, uy] = [-lx / (length || 1), -ly / (length || 1)];
  return {
    x: px + ux * length + ux * 6,
    y: py + uy * length + (Math.abs(uy) < 0.3 ? 4 : uy < 0 ? -6 : 14),
    anchor: ux > 0.3 ? ('start' as const) : ux < -0.3 ? ('end' as const) : ('middle' as const),
  };
}

/** A joint's name sits on the side away from its members, its support, and its load. */
function jointLabelAt(
  model: TrussModel,
  joint: TrussModel['joints'][number],
  view: ReturnType<typeof useView>,
  load: [number, number] | null,
) {
  let [sx, sy] = [0, 0];
  const add = (dx: number, dy: number) => {
    const d = Math.hypot(dx, dy) || 1;
    sx += dx / d;
    sy += dy / d;
  };
  for (const member of model.members) {
    const other = member.a === joint.id ? member.b : member.b === joint.id ? member.a : null;
    const to = other ? model.joints.find((one) => one.id === other) : null;
    if (to) add(view.sx(to.x) - view.sx(joint.x), view.sy(to.y) - view.sy(joint.y));
  }
  if (joint.support) add(0, 1.5);
  if (load) add(load[0], load[1]);
  const d = Math.hypot(sx, sy);
  const [ux, uy] = d < 0.2 ? [0.7, -0.7] : [-sx / d, -sy / d];
  return { x: view.sx(joint.x) + ux * 17, y: view.sy(joint.y) + uy * 17 + 4 };
}

function PullLine({ model, pull }: { model: TrussModel; pull: { from: string; to: Point } }) {
  const view = useView();
  const from = model.joints.find((one) => one.id === pull.from);
  if (!from) return null;
  return (
    <line
      className={styles.reaction}
      x1={view.sx(from.x)}
      y1={view.sy(from.y)}
      x2={view.sx(pull.to.x)}
      y2={view.sy(pull.to.y)}
      aria-hidden="true"
    />
  );
}

interface JointProps {
  joint: Joint;
  model: TrussModel;
  mode: Mode;
  selected: boolean;
  readOnly: boolean;
  onSelect(): void;
  onDraft(model: TrussModel): void;
  onCommit(model?: TrussModel): void;
  onPull(pull: { from: string; to: Point } | null): void;
  onLink(a: string, b: string): void;
  onRemove(): void;
}

function JointDot({
  joint,
  model,
  mode,
  selected,
  readOnly,
  onSelect,
  onDraft,
  onCommit,
  onPull,
  onLink,
  onRemove,
}: JointProps) {
  const view = useView();
  const px = view.sx(joint.x);
  const py = view.sy(joint.y);
  const others = model.joints.filter((one) => one.id !== joint.id);
  const nearest = (p: Point) => others.find((one) => Math.hypot(one.x - p.x, one.y - p.y) <= 0.4) ?? null;

  const start = (event: ReactPointerEvent) => {
    onSelect();
    if (readOnly) return;
    if (mode === 'members') {
      view.drag(
        event,
        (p) => onPull({ from: joint.id, to: p }),
        (p) => {
          onPull(null);
          const target = nearest(p);
          if (target) onLink(joint.id, target.id);
        },
      );
      return;
    }
    let latest = model;
    view.drag(
      event,
      (p, grab) => {
        const to = snapPoint({ x: joint.x + p.x - grab.x, y: joint.y + p.y - grab.y }, others, STEP);
        latest = { ...model, joints: model.joints.map((one) => (one.id === joint.id ? { ...one, ...to } : one)) };
        onDraft(latest);
      },
      () => {
        if (latest !== model) onCommit(latest);
      },
    );
  };

  const load = Math.hypot(joint.fx ?? 0, joint.fy ?? 0);
  const length = 1.3 * view.scale;
  const lx = load > 0 ? ((joint.fx ?? 0) / load) * length : 0;
  const ly = load > 0 ? (-(joint.fy ?? 0) / load) * length : 0;
  const loadAt = loadLabelAt(px, py, lx, ly, length);
  const jointAt = jointLabelAt(model, joint, view, load > 0 ? [-lx, -ly] : null);
  return (
    <g
      className={`${styles.part} ${selected ? styles.selected : ''}`}
      data-part={joint.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={jointName(joint)}
      onPointerDown={start}
      onFocus={onSelect}
      onKeyDown={(event) =>
        onPartKey(
          event,
          STEP,
          readOnly
            ? { select: onSelect }
            : {
                select: onSelect,
                move: (dx, dy) =>
                  onCommit({
                    ...model,
                    joints: model.joints.map((one) =>
                      one.id === joint.id
                        ? { ...one, x: snapToStep(one.x + dx, 0.1), y: snapToStep(one.y + dy, 0.1) }
                        : one,
                    ),
                  }),
                remove: onRemove,
              },
        )
      }
    >
      {joint.support ? (
        <g transform={`translate(${px} ${py}) rotate(${90 - (joint.support === 'roller' ? (joint.angle ?? 90) : 90)})`}>
          <SupportSymbol kind={joint.support} />
        </g>
      ) : null}
      {load > 0 ? (
        <>
          <path className={styles.load} d={arrowPath(px - lx, py - ly, px - lx * 0.12, py - ly * 0.12, 9)} />
          <text className={styles.label} x={loadAt.x} y={loadAt.y} textAnchor={loadAt.anchor}>
            {`${fmt(load)} ${model.forceUnit}`}
          </text>
        </>
      ) : null}
      <circle className={styles.halo} cx={px} cy={py} r={10} />
      <circle className={styles.body} cx={px} cy={py} r={5} />
      <text className={styles.label} x={jointAt.x} y={jointAt.y} textAnchor="middle">
        {joint.label}
      </text>
    </g>
  );
}

function TrussResults({ model, result }: { model: TrussModel; result: TrussResult }) {
  const status = {
    determinate: t('engineering.truss.determinate', result.counts),
    indeterminate: t('engineering.truss.indeterminate'),
    unstable: t('engineering.truss.unstable'),
    none: t('engineering.truss.noSupports'),
  }[result.status];
  const label = (id: string) => model.joints.find((joint) => joint.id === id)?.label || id;
  return (
    <div className={styles.results} role="group" aria-label={t('engineering.common.results')}>
      {result.forces.size > 0 ? (
        <>
          <table>
            <caption>{t('engineering.truss.forces')}</caption>
            <tbody>
              {model.members.map((member) => {
                const force = result.forces.get(member.id);
                return force === undefined ? null : (
                  <tr key={member.id}>
                    <th scope="row">{`${label(member.a)}${label(member.b)}`}</th>
                    <td>{forceText(force, model.forceUnit)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className={styles.status}>{t('engineering.truss.legend')}</p>
          <table>
            <caption>{t('engineering.truss.reactions')}</caption>
            <tbody>
              {result.reactions.map((reaction) => (
                <tr key={`${reaction.joint}${reaction.component}`}>
                  <th scope="row">{`${label(reaction.joint)}${reaction.component === 'n' ? '' : reaction.component}`}</th>
                  <td>{`${fmt(reaction.value)} ${model.forceUnit}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      <p className={styles.status} aria-live="polite">
        {status}
      </p>
    </div>
  );
}

interface JointFieldsProps {
  joint: Joint;
  model: TrussModel;
  onChange(change: Partial<Joint>): void;
  onLink(other: string): void;
  onRemove(): void;
}

function JointFields({ joint, model, onChange, onLink, onRemove }: JointFieldsProps) {
  const others = model.joints.filter(
    (one) =>
      one.id !== joint.id &&
      !model.members.some((m) => (m.a === joint.id && m.b === one.id) || (m.b === joint.id && m.a === one.id)),
  );
  return (
    <div className={styles.fields} role="group" aria-label={jointName(joint)}>
      <TextInput label={t('engineering.common.label')} value={joint.label} onChange={(label) => onChange({ label })} />
      <NumberField label={t('engineering.common.x')} value={joint.x} onChange={(x) => onChange({ x })} />
      <NumberField label={t('engineering.common.y')} value={joint.y} onChange={(y) => onChange({ y })} />
      <SelectField
        label={t('engineering.truss.support')}
        value={joint.support ?? 'none'}
        options={[
          { value: 'none', label: t('engineering.truss.noSupport') },
          { value: 'pin', label: t('engineering.truss.pin') },
          { value: 'roller', label: t('engineering.truss.roller') },
        ]}
        onChange={(value) => onChange({ support: value === 'none' ? undefined : value })}
      />
      {joint.support === 'roller' ? (
        <NumberField
          label={t('engineering.truss.rollerAngle')}
          value={joint.angle ?? 90}
          onChange={(angle) => onChange({ angle })}
        />
      ) : null}
      <NumberField label={t('engineering.truss.loadX')} value={joint.fx ?? 0} onChange={(fx) => onChange({ fx })} />
      <NumberField label={t('engineering.truss.loadY')} value={joint.fy ?? 0} onChange={(fy) => onChange({ fy })} />
      {others.length > 0 ? (
        <SelectField
          label={t('engineering.truss.addMember')}
          value=""
          options={[
            { value: '', label: t('engineering.truss.chooseJoint') },
            ...others.map((one) => ({ value: one.id, label: one.label || one.id })),
          ]}
          onChange={(value) => {
            if (value) onLink(value);
          }}
        />
      ) : null}
      <Button variant="danger" onClick={onRemove}>
        {t('engineering.common.removeSelected')}
      </Button>
    </div>
  );
}
