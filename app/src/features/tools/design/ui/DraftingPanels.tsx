// The side panels of the drafting sheet: the sheet's settings, the title block, shapes typed by coordinates (the
// keyboard way to draw), what is selected, and the list of every shape and dimension. A number is committed when its
// field loses focus or Enter is pressed, so one edit is one undo step.
import { useId, useState } from 'react';
import { Button } from '../../../../ui';
import { addEntity, remove, updateDim, updateEntity } from '../drafting/edit';
import {
  DRAWN_LINE_TYPES,
  MM_PER_IN,
  SHEET_MM,
  TITLE_KEYS,
  dimLines,
  parseScale,
  scaleText,
  type Dim,
  type DraftingDoc,
  type Entity,
  type LineType,
  type SheetId,
  type SnapOptions,
  type Tol,
} from '../drafting/model';
import { parseNumber } from '../kit/read';
import { say } from './ToolPanel';
import styles from './design.module.css';

const unitsPerMm = (doc: DraftingDoc): number => (doc.units === 'in' ? 1 / MM_PER_IN : 1);
const toShown = (doc: DraftingDoc, mm: number): string => String(Number((mm * unitsPerMm(doc)).toPrecision(6)));

interface CommitProps {
  label: string;
  value: number;
  doc: DraftingDoc;
  length?: boolean;
  onCommit(value: number): void;
}

/** A number field that commits on blur or Enter. `length` says the value is a length in the sheet's units. */
export function CommitNumber(props: CommitProps) {
  const shown = props.length ? toShown(props.doc, props.value) : String(Number(props.value.toPrecision(6)));
  // A new value from outside (an undo, a change in another field) starts the field again from that value.
  return <CommitField key={shown} shown={shown} {...props} />;
}

function CommitField(props: CommitProps & { shown: string }) {
  const id = useId();
  const [text, setText] = useState(props.shown);
  const parsed = parseNumber(text);
  const bad = typeof parsed === 'string';
  const commit = () => {
    if (bad) return;
    const mm = props.length ? parsed / unitsPerMm(props.doc) : parsed;
    if (Math.abs(mm - props.value) > 1e-9) props.onCommit(mm);
  };
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        className={styles.input}
        value={text}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={bad ? true : undefined}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
    </div>
  );
}

function Pick<T extends string>(props: {
  label: string;
  value: T;
  options: readonly T[];
  name(option: T): string;
  onChange(value: T): void;
}) {
  return (
    <label className={styles.field}>
      <span>{props.label}</span>
      <select
        className={styles.input}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value as T)}
      >
        {props.options.map((option) => (
          <option key={option} value={option}>
            {props.name(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ScaleField(props: { doc: DraftingDoc; onDoc(next: DraftingDoc): void }) {
  return <ScaleInput key={scaleText(props.doc.scale)} {...props} />;
}

function ScaleInput(props: { doc: DraftingDoc; onDoc(next: DraftingDoc): void }) {
  const { doc } = props;
  const scaleId = useId();
  const [scale, setScale] = useState(scaleText(doc.scale));
  const parsed = parseScale(scale);
  const applyScale = () => {
    if (!parsed) return;
    const old = scaleText(doc.scale);
    const title =
      doc.title.scale === '' || doc.title.scale === old ? { ...doc.title, scale: scaleText(parsed) } : doc.title;
    props.onDoc({ ...doc, scale: parsed, title });
  };
  return (
    <div className={styles.field}>
      <label htmlFor={scaleId}>{say('kitDesign.drafting.scale')}</label>
      <input
        id={scaleId}
        type="text"
        className={styles.input}
        value={scale}
        spellCheck={false}
        aria-invalid={parsed ? undefined : true}
        aria-describedby={`${scaleId}-hint`}
        onChange={(event) => setScale(event.target.value)}
        onBlur={applyScale}
        onKeyDown={(event) => {
          if (event.key === 'Enter') applyScale();
        }}
      />
      <span id={`${scaleId}-hint`} className={parsed ? styles.hint : styles.problem}>
        {say(parsed ? 'kitDesign.drafting.scaleHint' : 'kitDesign.drafting.scaleBad')}
      </span>
    </div>
  );
}

export function Settings(props: {
  doc: DraftingDoc;
  snaps: SnapOptions;
  onDoc(next: DraftingDoc): void;
  onSnaps(next: SnapOptions): void;
}) {
  const { doc } = props;
  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>{say('kitDesign.drafting.settings')}</h3>
      <div className={styles.row}>
        <Pick
          label={say('kitDesign.drafting.sheet')}
          value={doc.sheet}
          options={Object.keys(SHEET_MM) as SheetId[]}
          name={(o) => say(`kitDesign.drafting.sheets.${o}`)}
          onChange={(sheet) => props.onDoc({ ...doc, sheet })}
        />
        <Pick
          label={say('kitDesign.drafting.units')}
          value={doc.units}
          options={['mm', 'in'] as const}
          name={(o) => say(`kitDesign.drafting.unitNames.${o}`)}
          onChange={(units) => props.onDoc({ ...doc, units, decimals: units === 'mm' ? 2 : 3 })}
        />
        <ScaleField doc={doc} onDoc={props.onDoc} />
        <Pick
          label={say('kitDesign.drafting.decimals')}
          value={String(doc.decimals)}
          options={['0', '1', '2', '3', '4']}
          name={(o) => o}
          onChange={(n) => props.onDoc({ ...doc, decimals: Number(n) })}
        />
        <Pick
          label={say('kitDesign.drafting.grid')}
          value={String(doc.gridMm)}
          options={['0', '1', '2', '2.5', '5', '10']}
          name={(o) => (o === '0' ? say('kitDesign.drafting.gridOff') : `${o} mm`)}
          onChange={(n) => props.onDoc({ ...doc, gridMm: Number(n) })}
        />
      </div>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={doc.dual}
          onChange={(event) => props.onDoc({ ...doc, dual: event.target.checked })}
        />
        <span>{say('kitDesign.drafting.dual')}</span>
      </label>
      <fieldset className={styles.fieldset}>
        <legend>{say('kitDesign.drafting.snapTo')}</legend>
        {(['endpoint', 'midpoint', 'center', 'intersection', 'grid'] as const).map((kind) => (
          <label key={kind} className={styles.check}>
            <input
              type="checkbox"
              checked={props.snaps[kind]}
              onChange={(event) => props.onSnaps({ ...props.snaps, [kind]: event.target.checked })}
            />
            <span>{say(`kitDesign.drafting.snaps.${kind}`)}</span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}

function TitleField(props: { id: (typeof TITLE_KEYS)[number]; value: string; onCommit(text: string): void }) {
  return <TitleInput key={props.value} {...props} />;
}

function TitleInput(props: { id: (typeof TITLE_KEYS)[number]; value: string; onCommit(text: string): void }) {
  const [text, setText] = useState(props.value);
  const commit = () => {
    if (text !== props.value) props.onCommit(text);
  };
  return (
    <label className={styles.field}>
      <span>{say(`kitDesign.drafting.titleKeys.${props.id}`)}</span>
      <input
        type="text"
        className={styles.input}
        value={text}
        maxLength={80}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
    </label>
  );
}

export function TitleBlock(props: { doc: DraftingDoc; onDoc(next: DraftingDoc): void }) {
  const { doc } = props;
  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>{say('kitDesign.drafting.titleBlock')}</h3>
      <div className={styles.row}>
        {TITLE_KEYS.map((key) => (
          <TitleField
            key={key}
            id={key}
            value={doc.title[key]}
            onCommit={(text) => props.onDoc({ ...doc, title: { ...doc.title, [key]: text } })}
          />
        ))}
      </div>
    </section>
  );
}

type Typed = 'line' | 'rect' | 'circle';

/** Shapes by typed coordinates, in the sheet's units: the way to draw exactly, and with the keyboard alone. */
export function TypedShape(props: {
  doc: DraftingDoc;
  lineType: LineType;
  onAdd(next: DraftingDoc, id: string): void;
  onProblem(p: string): void;
}) {
  const { doc } = props;
  const [kind, setKind] = useState<Typed>('line');
  const [v, setV] = useState({ x1: '20', y1: '40', x2: '120', y2: '40', cx: '60', cy: '90', r: '15' });
  const set = (key: keyof typeof v) => (value: string) => setV((current) => ({ ...current, [key]: value }));
  const mm = (text: string): number => (parseNumber(text) as number) / unitsPerMm(doc);
  const names = kind === 'circle' ? (['cx', 'cy', 'r'] as const) : (['x1', 'y1', 'x2', 'y2'] as const);
  const bad = names.some((n) => typeof parseNumber(v[n]) === 'string');
  const add = () => {
    if (bad) return;
    const lt = props.lineType;
    const made =
      kind === 'circle'
        ? addEntity(doc, { k: 'circle', c: [mm(v.cx), mm(v.cy)], r: mm(v.r), lt })
        : addEntity(doc, {
            k: kind === 'rect' ? 'rect' : 'line',
            a: [mm(v.x1), mm(v.y1)],
            b: [mm(v.x2), mm(v.y2)],
            lt,
          });
    if (made.ok) props.onAdd(made.doc, made.id);
    else props.onProblem(made.problem);
  };
  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>{say('kitDesign.drafting.typed')}</h3>
      <p className={styles.hint}>{say('kitDesign.drafting.typedHint', { unit: doc.units })}</p>
      <div className={styles.row}>
        <Pick
          label={say('kitDesign.drafting.shape')}
          value={kind}
          options={['line', 'rect', 'circle'] as const}
          name={(o) => say(`kitDesign.drafting.shapes.${o}`)}
          onChange={(next) => setKind(next as Typed)}
        />
        {names.map((n) => (
          <label key={n} className={styles.field}>
            <span>{say(`kitDesign.drafting.coord.${n}`)}</span>
            <input
              type="text"
              inputMode="decimal"
              className={styles.input}
              value={v[n]}
              aria-invalid={typeof parseNumber(v[n]) === 'string' ? true : undefined}
              onChange={(event) => set(n)(event.target.value)}
            />
          </label>
        ))}
      </div>
      <div className={styles.buttons}>
        <Button onClick={add} disabled={bad}>
          {say('kitDesign.drafting.addShape')}
        </Button>
      </div>
    </section>
  );
}

function TolFields(props: { doc: DraftingDoc; dim: Dim & { tol?: Tol }; onDoc(next: DraftingDoc): void }) {
  const { doc, dim } = props;
  const tol = dim.tol;
  const mode = tol ? tol.mode : 'none';
  const set = (next: Tol | undefined) => {
    const copy = { ...dim } as Dim & { tol?: Tol };
    if (next) copy.tol = next;
    else delete copy.tol;
    props.onDoc({ ...doc, dims: doc.dims.map((d) => (d.id === dim.id ? copy : d)) });
  };
  return (
    <>
      <Pick
        label={say('kitDesign.drafting.tolerance')}
        value={mode}
        options={['none', 'bilateral', 'limits'] as const}
        name={(o) => say(`kitDesign.drafting.tolModes.${o}`)}
        onChange={(m) => set(m === 'none' ? undefined : { mode: m, plus: tol?.plus ?? 0.1, minus: tol?.minus ?? 0.1 })}
      />
      {tol && (
        <>
          <CommitNumber
            label={say('kitDesign.drafting.tolPlus')}
            value={tol.plus}
            doc={doc}
            onCommit={(plus) => set({ ...tol, plus, minus: tol.mode === 'bilateral' ? plus : tol.minus })}
          />
          {tol.mode === 'limits' || tol.plus !== tol.minus ? (
            <CommitNumber
              label={say('kitDesign.drafting.tolMinus')}
              value={tol.minus}
              doc={doc}
              onCommit={(minus) => set({ ...tol, minus })}
            />
          ) : null}
        </>
      )}
    </>
  );
}

function EntityFields(props: { doc: DraftingDoc; e: Entity; onDoc(next: DraftingDoc): void }) {
  const { doc, e } = props;
  const patch = (p: Partial<Entity>) => props.onDoc(updateEntity(doc, e.id, p));
  const len = (label: string, value: number, apply: (n: number) => void) => (
    <CommitNumber key={label} label={label} value={value} doc={doc} length onCommit={apply} />
  );
  const num = (label: string, value: number, apply: (n: number) => void) => (
    <CommitNumber key={label} label={label} value={value} doc={doc} onCommit={apply} />
  );
  const c = (key: string) => say(`kitDesign.drafting.coord.${key}`);
  switch (e.k) {
    case 'line':
    case 'rect':
      return (
        <>
          {len(c('x1'), e.a[0], (n) => patch({ a: [n, e.a[1]] }))}
          {len(c('y1'), e.a[1], (n) => patch({ a: [e.a[0], n] }))}
          {len(c('x2'), e.b[0], (n) => patch({ b: [n, e.b[1]] }))}
          {len(c('y2'), e.b[1], (n) => patch({ b: [e.b[0], n] }))}
        </>
      );
    case 'circle':
    case 'arc':
      return (
        <>
          {len(c('cx'), e.c[0], (n) => patch({ c: [n, e.c[1]] }))}
          {len(c('cy'), e.c[1], (n) => patch({ c: [e.c[0], n] }))}
          {len(c('r'), e.r, (n) => n > 0 && patch({ r: n }))}
          {e.k === 'arc' && num(c('a0'), e.a0, (n) => patch({ a0: n }))}
          {e.k === 'arc' && num(c('a1'), e.a1, (n) => patch({ a1: n }))}
        </>
      );
    case 'note':
      return (
        <>
          {len(c('x1'), e.p[0], (n) => patch({ p: [n, e.p[1]] }))}
          {len(c('y1'), e.p[1], (n) => patch({ p: [e.p[0], n] }))}
          <label className={styles.field}>
            <span>{say('kitDesign.drafting.noteText')}</span>
            <input
              type="text"
              className={styles.input}
              value={e.text}
              maxLength={80}
              onChange={(event) => patch({ text: event.target.value })}
            />
          </label>
        </>
      );
    case 'hatch':
      return (
        <>
          {len(say('kitDesign.drafting.hatchSpacing'), e.spacing, (n) => n > 0 && patch({ spacing: n }))}
          {num(say('kitDesign.drafting.hatchAngle'), e.angle, (n) => patch({ angle: n }))}
        </>
      );
    case 'poly':
      return (
        <label className={styles.check}>
          <input type="checkbox" checked={e.closed} onChange={(event) => patch({ closed: event.target.checked })} />
          <span>{say('kitDesign.drafting.closed')}</span>
        </label>
      );
  }
}

function DimFields(props: { doc: DraftingDoc; d: Dim; onDoc(next: DraftingDoc): void }) {
  const { doc, d } = props;
  const set = (p: Partial<Dim>) => props.onDoc(updateDim(doc, d.id, p));
  return (
    <>
      {(d.k === 'linear' || d.k === 'aligned') && (
        <CommitNumber
          label={say('kitDesign.drafting.offset')}
          value={d.off}
          doc={doc}
          length
          onCommit={(off) => set({ off })}
        />
      )}
      {d.k === 'angular' && (
        <CommitNumber
          label={say('kitDesign.drafting.arcRadius')}
          value={d.r}
          doc={doc}
          length
          onCommit={(r) => r > 0 && set({ r })}
        />
      )}
      {(d.k === 'radius' || d.k === 'diameter') && (
        <CommitNumber
          label={say('kitDesign.drafting.leaderAngle')}
          value={d.ang}
          doc={doc}
          onCommit={(ang) => set({ ang })}
        />
      )}
      {d.k !== 'angular' && <TolFields doc={doc} dim={d} onDoc={props.onDoc} />}
    </>
  );
}

export function Selection(props: {
  doc: DraftingDoc;
  id: string;
  onDoc(next: DraftingDoc): void;
  onSelect(id: string | null): void;
}) {
  const { doc, id } = props;
  const entity = doc.entities.find((e) => e.id === id);
  const dim = doc.dims.find((d) => d.id === id);
  if (!entity && !dim) return null;
  const hasLt = entity && entity.k !== 'note' && entity.k !== 'hatch';
  const label = entity ? say(`kitDesign.drafting.shapes.${entity.k}`) : say(`kitDesign.drafting.dimKinds.${dim!.k}`);
  return (
    <section className={styles.section} aria-label={say('kitDesign.drafting.selected', { what: label })}>
      <h3 className={styles.heading}>{say('kitDesign.drafting.selected', { what: label })}</h3>
      <div className={styles.row}>
        {hasLt && (
          <Pick
            label={say('kitDesign.drafting.lineType')}
            value={(entity as Entity & { lt: LineType }).lt}
            options={DRAWN_LINE_TYPES}
            name={(o) => say(`kitDesign.drafting.lineTypes.${o}`)}
            onChange={(lt) => props.onDoc(updateEntity(doc, id, { lt } as Partial<Entity>))}
          />
        )}
        {entity && <EntityFields doc={doc} e={entity} onDoc={props.onDoc} />}
        {dim && <DimFields doc={doc} d={dim} onDoc={props.onDoc} />}
      </div>
      <div className={styles.buttons}>
        <Button
          onClick={() => {
            props.onDoc(remove(doc, id));
            props.onSelect(null);
          }}
        >
          {say('kitDesign.drafting.delete')}
        </Button>
      </div>
    </section>
  );
}

/** Every shape and dimension as a list that can be read and chosen without the pointer. */
export function Contents(props: { doc: DraftingDoc; selected: string | null; onSelect(id: string): void }) {
  const { doc } = props;
  const lines = dimLines(doc);
  const shown = (mm: number) => toShown(doc, mm);
  const describe = (e: Entity): string => {
    switch (e.k) {
      case 'line':
      case 'rect':
        return `(${shown(e.a[0])}, ${shown(e.a[1])}) → (${shown(e.b[0])}, ${shown(e.b[1])})`;
      case 'circle':
        return `(${shown(e.c[0])}, ${shown(e.c[1])}), r ${shown(e.r)}`;
      case 'arc':
        return `(${shown(e.c[0])}, ${shown(e.c[1])}), r ${shown(e.r)}, ${e.a0.toFixed(0)}° → ${e.a1.toFixed(0)}°`;
      case 'poly':
        return say('kitDesign.drafting.points', { count: e.pts.length });
      case 'note':
        return e.text;
      case 'hatch':
        return say('kitDesign.drafting.hatchOf', { of: e.of });
    }
  };
  if (doc.entities.length === 0 && doc.dims.length === 0)
    return <p className={styles.hint}>{say('kitDesign.drafting.emptySheet')}</p>;
  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>{say('kitDesign.drafting.contents')}</h3>
      <ul className={styles.contents}>
        {doc.entities.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              className={styles.item}
              aria-pressed={props.selected === e.id}
              onClick={() => props.onSelect(e.id)}
            >
              <span>{say(`kitDesign.drafting.shapes.${e.k}`)}</span>{' '}
              <span className={styles.number}>{describe(e)}</span>
            </button>
          </li>
        ))}
        {doc.dims.map((d) => {
          const line = lines.find((l) => l.id === d.id);
          return (
            <li key={d.id}>
              <button
                type="button"
                className={styles.item}
                aria-pressed={props.selected === d.id}
                onClick={() => props.onSelect(d.id)}
              >
                <span>{say(`kitDesign.drafting.dimKinds.${d.k}`)}</span>{' '}
                <span className={styles.number}>
                  {line && !line.problem
                    ? line.text
                    : say(`kitDesign.drafting.dimProblems.${line?.problem ?? 'missing'}`)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
