// The circuit block (item 10): resistor, source, and ground symbols as parts on a grid, joined by wires drawn from
// point to point. Nodal analysis runs as the circuit changes; node voltages are marked in the drawing, and the
// voltages, currents, and power of every part are listed beside it.
import { useCallback, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { t } from '../../../strings/t';
import { Button } from '../../../ui';
import { Canvas, onPartKey, useView } from '../canvas/Canvas';
import type { View } from '../canvas/Canvas';
import { NumberField, TextInput } from '../canvas/Field';
import { KeysHint } from '../canvas/KeysHint';
import { arrowPath, snapToStep } from '../canvas/geometry';
import type { Point } from '../canvas/geometry';
import { fmt, useBlockModel } from '../canvas/shared';
import type { BlockProps } from '../canvas/shared';
import styles from '../canvas/canvas.module.css';
import { parsePrefixed, withPrefix } from '../../../core/units';
import { PREFIXES, UNITS, readCircuit, terminals, turn } from './model';
import type { CircuitKind, CircuitModel, CircuitPart } from './model';
import { solveCircuit } from './solve';
import type { CircuitResult } from './solve';
import { QuantityField } from './QuantityField';

const COLUMNS = 16;
const ROWS = 10;

type Mode = 'parts' | 'wires';

export function partName(part: CircuitPart): string {
  const [a, b] = terminals(part);
  const value = withPrefix(part.value, UNITS[part.kind]);
  const ends = { x1: fmt(a.x), y1: fmt(a.y), x2: fmt(b?.x ?? a.x), y2: fmt(b?.y ?? a.y) };
  switch (part.kind) {
    case 'resistor':
      return t('engineering.circuit.partResistor', { label: part.label, value, ...ends });
    case 'voltage':
      return t('engineering.circuit.partVoltage', { label: part.label, value, ...ends });
    case 'current':
      return t('engineering.circuit.partCurrent', { label: part.label, value, ...ends });
    case 'ground':
      return t('engineering.circuit.partGround', { x: fmt(a.x), y: fmt(a.y) });
    case 'wire':
      return t('engineering.circuit.partWire', ends);
  }
}

const nodeName = (n: number) => (n === 0 ? t('engineering.circuit.groundNode') : t('engineering.circuit.node', { n }));

export function circuitFallback(model: CircuitModel): string {
  const result = solveCircuit(model);
  const parts = model.parts
    .filter((p) => p.kind === 'resistor' || p.kind === 'voltage' || p.kind === 'current')
    .map((p) => `${p.label} ${withPrefix(p.value, UNITS[p.kind])}`)
    .join(', ');
  const nodes = result.nodes
    .filter((node) => node.index > 0)
    .map((node) => `${nodeName(node.index)} ${withPrefix(node.voltage, 'V')}`)
    .join(', ');
  return t('engineering.circuit.fallback', { parts: parts || '—', nodes: nodes || '—' });
}

function nextLabel(model: CircuitModel, kind: CircuitKind): string {
  const used = new Set(model.parts.map((p) => p.label));
  let n = 1;
  while (used.has(`${PREFIXES[kind]}${n}`)) n++;
  return `${PREFIXES[kind]}${n}`;
}

function nextId(model: CircuitModel): string {
  const used = new Set(model.parts.map((p) => p.id));
  let n = model.parts.length + 1;
  while (used.has(`p${n}`)) n++;
  return `p${n}`;
}

/** A free spot for a new part: the first grid point that no terminal uses, row by row from the top. */
function freeSpot(model: CircuitModel): Point {
  const used = new Set(model.parts.flatMap((p) => terminals(p).map((pt) => `${pt.x},${pt.y}`)));
  for (let y = ROWS - 2; y >= 1; y -= 2) {
    for (let x = 1; x <= COLUMNS - 3; x += 1) {
      if (!used.has(`${x},${y}`) && !used.has(`${x + 2},${y}`)) return { x, y };
    }
  }
  return { x: 1, y: 1 };
}

const DEFAULTS: Readonly<Record<CircuitKind, number>> = {
  resistor: 1000,
  voltage: 5,
  current: 0.001,
  ground: 0,
  wire: 0,
};

const movePart = (part: CircuitPart, dx: number, dy: number): CircuitPart => ({
  ...part,
  x: part.x + dx,
  y: part.y + dy,
  ...(part.kind === 'wire' ? { x2: (part.x2 ?? part.x) + dx, y2: (part.y2 ?? part.y) + dy } : {}),
});

// checks-disable-next-line modifiability: one editor whose toolbar, drawing, and results share its state
export function CircuitPanel({ data, readOnly, patch, announce }: BlockProps) {
  const save = useCallback((next: CircuitModel) => patch({ model: next }, circuitFallback(next)), [patch]);
  const { model, draft, commit } = useBlockModel(data.model, readCircuit, save);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('parts');
  const [pending, setPending] = useState<{ from: Point; to: Point } | null>(null);
  const result = useMemo(() => solveCircuit(model), [model]);
  const drawing = useRef<HTMLDivElement>(null);
  const current = model.parts.find((p) => p.id === selected) ?? null;

  const replacePart = (next: CircuitPart) =>
    commit({ ...model, parts: model.parts.map((p) => (p.id === next.id ? next : p)) });

  const add = (kind: CircuitKind) => {
    const spot = freeSpot(model);
    const part: CircuitPart = {
      id: nextId(model),
      kind,
      label: nextLabel(model, kind),
      ...spot,
      rotation: 0,
      value: DEFAULTS[kind],
      ...(kind === 'wire' ? { x2: spot.x + 2, y2: spot.y } : {}),
    };
    commit({ ...model, parts: [...model.parts, part] });
    setSelected(part.id);
    announce(t('engineering.common.added', { name: partName(part) }));
    requestAnimationFrame(() => drawing.current?.querySelector<SVGElement>(`[data-part="${part.id}"]`)?.focus());
  };

  const remove = (id: string) => {
    const part = model.parts.find((p) => p.id === id);
    commit({ ...model, parts: model.parts.filter((p) => p.id !== id) });
    setSelected(null);
    if (part) announce(t('engineering.common.removed', { name: partName(part) }));
  };

  /** Starts a wire at a grid point and adds it where the pointer lets go. */
  const startWire = (p: Point, event: ReactPointerEvent, view: View) => {
    const from = { x: snapToStep(p.x, 1), y: snapToStep(p.y, 1) };
    let to = from;
    view.drag(
      event,
      (q) => {
        to = { x: snapToStep(q.x, 1), y: snapToStep(q.y, 1) };
        setPending({ from, to });
      },
      () => {
        setPending(null);
        if (to.x === from.x && to.y === from.y) return;
        const part: CircuitPart = {
          id: nextId(model),
          kind: 'wire',
          label: nextLabel(model, 'wire'),
          ...from,
          x2: to.x,
          y2: to.y,
          rotation: 0,
          value: 0,
        };
        commit({ ...model, parts: [...model.parts, part] });
        announce(t('engineering.common.added', { name: partName(part) }));
      },
    );
  };

  return (
    <div className={styles.root}>
      {readOnly ? null : (
        <div className={styles.bar} role="toolbar" aria-label={t('engineering.circuit.block')}>
          {(['resistor', 'voltage', 'current', 'ground', 'wire'] as const).map((kind) => (
            <Button key={kind} onClick={() => add(kind)}>
              {t(`engineering.circuit.${kind}`)}
            </Button>
          ))}
          <div className={styles.bar} role="group" aria-label={t('engineering.circuit.mode')}>
            <Button aria-pressed={mode === 'parts'} onClick={() => setMode('parts')}>
              {t('engineering.circuit.modeParts')}
            </Button>
            <Button aria-pressed={mode === 'wires'} onClick={() => setMode('wires')}>
              {t('engineering.circuit.modeWires')}
            </Button>
          </div>
        </div>
      )}
      <div className={styles.layout}>
        <div className={styles.drawing} ref={drawing}>
          <Canvas
            label={t('engineering.circuit.canvas')}
            columns={COLUMNS}
            rows={ROWS}
            onBackground={(p, event, view) => {
              setSelected(null);
              if (!readOnly && mode === 'wires') startWire(p, event, view);
            }}
          >
            {model.parts.map((part) => (
              <PartGlyph
                key={part.id}
                part={part}
                model={model}
                mode={mode}
                selected={part.id === selected}
                readOnly={readOnly}
                onSelect={() => setSelected(part.id)}
                onDraft={draft}
                onCommit={commit}
                onWire={startWire}
                onRemove={() => remove(part.id)}
              />
            ))}
            {pending ? <PendingWire pending={pending} /> : null}
            <NodeMarks result={result} />
          </Canvas>
          {readOnly ? null : (
            <KeysHint lead={t(mode === 'wires' ? 'engineering.circuit.wireHint' : 'engineering.circuit.partsHint')} />
          )}
        </div>
        <CircuitResults model={model} result={result} />
      </div>
      {readOnly ? null : current ? (
        <PartFields part={current} onChange={replacePart} onRemove={() => remove(current.id)} />
      ) : (
        <p className={styles.hint}>{t('engineering.common.noneSelected')}</p>
      )}
    </div>
  );
}

interface GlyphProps {
  part: CircuitPart;
  model: CircuitModel;
  mode: Mode;
  selected: boolean;
  readOnly: boolean;
  onSelect(): void;
  onDraft(model: CircuitModel): void;
  onCommit(model?: CircuitModel): void;
  onWire(p: Point, event: ReactPointerEvent, view: View): void;
  onRemove(): void;
}

function PartGlyph({
  part,
  model,
  mode,
  selected,
  readOnly,
  onSelect,
  onDraft,
  onCommit,
  onWire,
  onRemove,
}: GlyphProps) {
  const view = useView();
  const swap = (next: CircuitPart): CircuitModel => ({
    ...model,
    parts: model.parts.map((p) => (p.id === next.id ? next : p)),
  });
  const start = (event: ReactPointerEvent) => {
    if (readOnly) return onSelect();
    if (mode === 'wires') {
      // A wire may start on a part's terminal: it begins at the grid point nearest the pointer.
      return onWire(view.toModel(event.clientX, event.clientY), event, view);
    }
    onSelect();
    let latest = model;
    view.drag(
      event,
      (p, grab) => {
        latest = swap(movePart(part, snapToStep(p.x - grab.x, 1), snapToStep(p.y - grab.y, 1)));
        onDraft(latest);
      },
      () => {
        if (latest !== model) onCommit(latest);
      },
    );
  };
  return (
    <g
      className={`${styles.part} ${selected ? styles.selected : ''}`}
      data-part={part.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={partName(part)}
      onPointerDown={start}
      onFocus={onSelect}
      onKeyDown={(event) =>
        onPartKey(
          event,
          1,
          readOnly
            ? { select: onSelect }
            : {
                select: onSelect,
                move: (dx, dy) => onCommit(swap(movePart(part, Math.sign(dx), Math.sign(dy)))),
                rotate: (by) => {
                  if (part.kind !== 'wire' && part.kind !== 'ground')
                    onCommit(swap({ ...part, rotation: turn(part.rotation, by > 0 ? 90 : -90) }));
                },
                remove: onRemove,
              },
        )
      }
    >
      <Symbol part={part} />
    </g>
  );
}

/** The drawing of a part: a symbol from its first terminal to its second, turned with it. */
function Symbol({ part }: { part: CircuitPart }) {
  const view = useView();
  const [a, b] = terminals(part);
  const ax = view.sx(a.x);
  const ay = view.sy(a.y);
  if (part.kind === 'wire') {
    const [bx, by] = [view.sx(b.x), view.sy(b.y)];
    return (
      <>
        <line className={styles.halo} x1={ax} y1={ay} x2={bx} y2={by} />
        <line className={styles.ink} x1={ax} y1={ay} x2={bx} y2={by} />
        <circle className={styles.dot} cx={ax} cy={ay} r={2.5} />
        <circle className={styles.dot} cx={bx} cy={by} r={2.5} />
      </>
    );
  }
  if (part.kind === 'ground') {
    return (
      <>
        <circle className={styles.halo} cx={ax} cy={ay + 10} r={14} />
        <path
          className={styles.ink}
          d={`M${ax} ${ay}V${ay + 12}M${ax - 12} ${ay + 12}H${ax + 12}M${ax - 8} ${ay + 17}H${ax + 8}M${ax - 4} ${ay + 22}H${ax + 4}`}
        />
      </>
    );
  }
  const L = 2 * view.scale;
  let body: ReactNode;
  if (part.kind === 'resistor') {
    const zig = [24, 28, 33, 38, 43, 48, 53, 56]
      .map((x, i) => `L${x} ${i === 0 || i === 7 ? 0 : i % 2 === 1 ? -7 : 7}`)
      .join('');
    body = <path className={styles.ink} d={`M0 0H24${zig}H${L}`} />;
  } else if (part.kind === 'voltage') {
    body = <path className={styles.ink} d={`M0 0H35M35 -7V7M45 -14V14M45 0H${L}M54 -16H62M58 -20V-12`} />;
  } else {
    body = (
      <>
        <path className={styles.ink} d={`M0 0H26M54 0H${L}`} />
        <circle className={styles.ink} cx={40} cy={0} r={14} />
        <path className={styles.ink} d={arrowPath(31, 0, 49, 0, 6)} />
      </>
    );
  }
  return (
    <>
      <g transform={`translate(${ax} ${ay}) rotate(${-part.rotation})`}>
        <rect className={styles.halo} x={-4} y={-18} width={L + 8} height={36} />
        {body}
      </g>
      <text
        className={styles.label}
        x={(ax + view.sx(b.x)) / 2 + (Math.abs(Math.cos((part.rotation * Math.PI) / 180)) > 0.7 ? 0 : 26)}
        y={(ay + view.sy(b.y)) / 2 + (Math.abs(Math.cos((part.rotation * Math.PI) / 180)) > 0.7 ? -26 : 4)}
        textAnchor={Math.abs(Math.cos((part.rotation * Math.PI) / 180)) > 0.7 ? 'middle' : 'start'}
      >
        {`${part.label} ${withPrefix(part.value, UNITS[part.kind])}`}
      </text>
    </>
  );
}

function PendingWire({ pending }: { pending: { from: Point; to: Point } }) {
  const view = useView();
  return (
    <line
      className={styles.reaction}
      aria-hidden="true"
      x1={view.sx(pending.from.x)}
      y1={view.sy(pending.from.y)}
      x2={view.sx(pending.to.x)}
      y2={view.sy(pending.to.y)}
    />
  );
}

function NodeMarks({ result }: { result: CircuitResult }) {
  const view = useView();
  if (result.status !== 'solved') return null;
  return (
    <g aria-hidden="true">
      {result.nodes.map((node) => (
        <text key={node.index} className={styles.muted} x={view.sx(node.at.x) + 4} y={view.sy(node.at.y) + 14}>
          {node.index === 0
            ? withPrefix(0, 'V')
            : `${t('engineering.circuit.nodeMark', { n: node.index })} ${withPrefix(node.voltage, 'V')}`}
        </text>
      ))}
    </g>
  );
}

function CircuitResults({ model, result }: { model: CircuitModel; result: CircuitResult }) {
  const status = {
    solved: t('engineering.circuit.solved'),
    empty: t('engineering.circuit.empty'),
    noGround: t('engineering.circuit.noGround'),
    floating: t('engineering.circuit.floating', {
      list: (result.floating ?? []).map((id) => model.parts.find((p) => p.id === id)?.label ?? id).join(', '),
    }),
    singular: t('engineering.circuit.singular'),
    badValue: t('engineering.circuit.badValue'),
  }[result.status];
  return (
    <div className={styles.results} role="group" aria-label={t('engineering.common.results')}>
      {result.status === 'solved' ? (
        <>
          <table>
            <caption>{t('engineering.circuit.nodes')}</caption>
            <tbody>
              {result.nodes.map((node) => (
                <tr key={node.index}>
                  <th scope="row">{nodeName(node.index)}</th>
                  <td>{withPrefix(node.voltage, 'V')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table>
            <caption>{t('engineering.circuit.branches')}</caption>
            <tbody>
              {result.branches.map((branch) => {
                const part = model.parts.find((p) => p.id === branch.part)!;
                const forward = branch.current >= 0;
                return (
                  <tr key={branch.part}>
                    <th scope="row">{part.label}</th>
                    <td>
                      <div>
                        {t('engineering.circuit.flows', {
                          current: withPrefix(Math.abs(branch.current), 'A'),
                          from: nodeName(forward ? branch.from : branch.to),
                          to: nodeName(forward ? branch.to : branch.from),
                        })}
                      </div>
                      <div>
                        {t(branch.power > 0 ? 'engineering.circuit.delivers' : 'engineering.circuit.takes', {
                          label: part.label,
                          power: withPrefix(Math.abs(branch.power), 'W'),
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : null}
      <p className={result.status === 'solved' ? styles.status : styles.problem} aria-live="polite">
        {status}
      </p>
    </div>
  );
}

interface FieldsProps {
  part: CircuitPart;
  onChange(part: CircuitPart): void;
  onRemove(): void;
}

function PartFields({ part, onChange, onRemove }: FieldsProps) {
  const two = part.kind !== 'ground' && part.kind !== 'wire';
  return (
    <div className={styles.fields} role="group" aria-label={partName(part)}>
      {part.kind !== 'ground' ? (
        <TextInput
          label={t('engineering.common.label')}
          value={part.label}
          onChange={(label) => onChange({ ...part, label })}
        />
      ) : null}
      {two ? (
        <QuantityField
          label={t('engineering.circuit.value')}
          help={t('engineering.circuit.valueHelp')}
          unit={UNITS[part.kind]}
          value={part.value}
          parse={parsePrefixed}
          show={withPrefix}
          onChange={(value) => onChange({ ...part, value })}
        />
      ) : null}
      <NumberField
        label={t('engineering.common.x')}
        value={part.x}
        onChange={(x) => onChange({ ...part, x: Math.round(x) })}
      />
      <NumberField
        label={t('engineering.common.y')}
        value={part.y}
        onChange={(y) => onChange({ ...part, y: Math.round(y) })}
      />
      {part.kind === 'wire' ? (
        <>
          <NumberField
            label={t('engineering.circuit.endX')}
            value={part.x2 ?? part.x}
            onChange={(x2) => onChange({ ...part, x2: Math.round(x2) })}
          />
          <NumberField
            label={t('engineering.circuit.endY')}
            value={part.y2 ?? part.y}
            onChange={(y2) => onChange({ ...part, y2: Math.round(y2) })}
          />
        </>
      ) : null}
      {two ? (
        <Button onClick={() => onChange({ ...part, rotation: turn(part.rotation, 90) })}>
          {t('engineering.circuit.rotate')}
        </Button>
      ) : null}
      <Button variant="danger" onClick={onRemove}>
        {t('engineering.common.removeSelected')}
      </Button>
    </div>
  );
}
