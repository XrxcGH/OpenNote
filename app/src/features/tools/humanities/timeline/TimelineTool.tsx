// The timeline builder: rows of events and periods become a drawing with tracks, era bands, and uncertainty bars.
// Zoom and pan from the keyboard, compare two rows, and insert the picture, an editable figure, the table, or steps.
import '../text';
import { useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { t } from '../../../../strings/t';
import { Button, announce } from '../../../../ui';
import { tablesOf, gridOf } from '../../subjects/data/page';
import { pageBlocks } from '../../subjects/ui/fields';
import { attempt, errorText, sig } from '../ui/attempt';
import {
  Choice,
  DataTable,
  Field,
  Fields,
  InsertBar,
  Note,
  Picture,
  Problem,
  Results,
  Steps,
  Tool,
  ht,
} from '../ui/parts';
import styles from '../ui/kit.module.css';
import { takeInputs } from '../open';
import { beforePresent, duration, historianYear, overlap } from './dates';
import type { TimeDate } from './dates';
import { timelineSvg } from './draw';
import { RowError, checkScale, fitScale, parseRows } from './layout';
import type { Row, Scale } from './layout';

const k = 'kitHumanities.timeline';
type ScaleKind = Scale['kind'];
const SCALES: readonly ScaleKind[] = ['linear', 'log', 'broken'];

interface Inputs {
  text: string;
  scale: ScaleKind;
  from: string;
  to: string;
}

function restored(): Inputs {
  const saved = takeInputs('timeline') as Partial<Inputs> | null;
  const fallback: Inputs = { text: ht('timeline.example'), scale: 'linear', from: '', to: '' };
  if (!saved || typeof saved.text !== 'string') return fallback;
  return {
    text: saved.text,
    scale: SCALES.includes(saved.scale as ScaleKind) ? (saved.scale as ScaleKind) : 'linear',
    from: typeof saved.from === 'string' ? saved.from : '',
    to: typeof saved.to === 'string' ? saved.to : '',
  };
}

/** A year the historian's way: 44 BCE, 1603 CE, or 1603 when no date is before the common era. */
export function yearText(year: number, era: boolean): string {
  const rounded = Math.round(year);
  if (Math.abs(year) >= 100000) return deepText(beforePresent(year));
  const { year: shown, bce } = historianYear(rounded);
  if (bce) return t(`${k}.yearBce`, { year: String(shown) });
  return era ? t(`${k}.yearCe`, { year: String(shown) }) : t(`${k}.yearPlain`, { year: String(shown) });
}

/** Years before present as Ga, Ma, ka, or BP. */
export function deepText(bp: number): string {
  if (bp >= 1e9) return t(`${k}.ga`, { value: sig(bp / 1e9, 3) });
  if (bp >= 1e6) return t(`${k}.ma`, { value: sig(bp / 1e6, 3) });
  if (bp >= 1e3) return t(`${k}.ka`, { value: sig(bp / 1e3, 3) });
  return t(`${k}.bp`, { value: sig(bp, 4) });
}

function rowProblem(error: unknown): string {
  if (error instanceof RowError)
    return t(`${k}.errors.line`, { line: error.line, problem: errorText('timeline', error.code) });
  return errorText('timeline', error instanceof Error ? error.message : 'unknown');
}

function readStep(text: string, date: TimeDate): string {
  const value = sig(date.mid, 10);
  if (date.low === date.high) return t(`${k}.steps.read`, { text, value });
  if (date.mid - date.low === date.high - date.mid && date.approx)
    return t(`${k}.steps.readSpread`, { text, value, spread: sig(date.mid - date.low, 6) });
  return t(`${k}.steps.readRange`, { text, low: sig(date.low, 10), high: sig(date.high, 10) });
}

function zoomed(scale: Scale, factor: number, shift: number): Scale {
  if (scale.kind === 'log') {
    const top = Math.log10(scale.oldest);
    const bottom = Math.log10(scale.youngest);
    const middle = (top + bottom) / 2 - shift * (top - bottom);
    const half = Math.max(((top - bottom) / 2) * factor, 0.5);
    return { kind: 'log', oldest: 10 ** (middle + half), youngest: 10 ** Math.max(middle - half, 0) };
  }
  const middle = (scale.from + scale.to) / 2 + shift * (scale.to - scale.from);
  const half = Math.max(((scale.to - scale.from) / 2) * factor, 0.5);
  if (scale.kind === 'linear') return { kind: 'linear', from: middle - half, to: middle + half };
  return { ...scale, from: Math.min(middle - half, scale.gapFrom - 1), to: Math.max(middle + half, scale.gapTo + 1) };
}

function viewOf(rows: readonly Row[], inputs: Inputs, view: Scale | null): Scale {
  const fitted = view ?? fitScale(rows, inputs.scale);
  if (view || fitted.kind === 'log') return fitted;
  const from = inputs.from.trim() === '' ? NaN : Number(inputs.from);
  const to = inputs.to.trim() === '' ? NaN : Number(inputs.to);
  const custom = {
    ...fitted,
    from: Number.isFinite(from) ? from : fitted.from,
    to: Number.isFinite(to) ? to : fitted.to,
  } as Scale;
  checkScale(custom);
  return custom;
}

function Compare({ rows, era }: { rows: readonly Row[]; era: boolean }) {
  const [first, setFirst] = useState('0');
  const [second, setSecond] = useState(String(Math.min(1, rows.length - 1)));
  const a = rows[Number(first)] ?? rows[0]!;
  const b = rows[Number(second)] ?? rows[0]!;
  const options = rows.map((row, index) => ({ value: String(index), label: row.label }));
  const spanOf = (row: Row): [number, number] => [row.start.mid, (row.end ?? row.start).mid];
  const shared = overlap(spanOf(a), spanOf(b));
  const results: [string, string][] = [
    [
      t(`${k}.between`, { first: a.label, second: b.label }),
      t(`${k}.years`, { value: Number(sig(duration(a.start, b.start), 8)) }),
    ],
    [
      t(`${k}.overlapRow`),
      shared
        ? t(`${k}.overlapValue`, {
            start: yearText(shared.start, era),
            end: yearText(shared.end, era),
            length: Number(sig(shared.length, 8)),
          })
        : t(`${k}.noOverlap`),
    ],
  ];
  const steps = shared
    ? [
        t(`${k}.steps.overlap`, {
          start: sig(shared.start, 10),
          end: sig(shared.end, 10),
          length: sig(shared.length, 8),
        }),
      ]
    : [];
  return (
    <div role="group" aria-label={t(`${k}.query`)} className={styles.group}>
      <strong>{t(`${k}.query`)}</strong>
      <Fields>
        <Choice<string> label={t(`${k}.first`)} value={first} options={options} onChange={setFirst} />
        <Choice<string> label={t(`${k}.second`)} value={second} options={options} onChange={setSecond} />
      </Fields>
      <Results label={t(`${k}.query`)} rows={results} />
      <Steps steps={steps} />
    </div>
  );
}

function timelineSteps(rows: readonly Row[]): string[] {
  return [
    t(`${k}.steps.era`),
    ...(rows.some((row) => row.start.read === 'bp' || row.start.precision === 'deep') ? [t(`${k}.steps.bp`)] : []),
    ...rows.flatMap((row) => {
      const out = [readStep(row.startText, row.start)];
      if (row.end) {
        out.push(readStep(row.endText, row.end));
        out.push(
          t(`${k}.steps.length`, {
            label: row.label,
            start: sig(row.start.mid, 10),
            end: sig(row.end.mid, 10),
            length: sig(duration(row.start, row.end), 8),
          }),
        );
      }
      return out;
    }),
    t(`${k}.steps.lanes`),
  ];
}

function timelineTable(rows: readonly Row[], era: boolean) {
  const lengthOf = (row: Row) =>
    row.end ? t(`${k}.years`, { value: Number(sig(duration(row.start, row.end), 8)) }) : '';
  const header = (['label', 'start', 'end', 'track', 'length'] as const).map((key) =>
    ht(`timeline.tableHeader.${key}`),
  );
  const table = rows.map((row) => [
    row.label,
    yearText(row.start.mid, era),
    row.end ? yearText(row.end.mid, era) : '',
    row.track || t(`${k}.noTrack`),
    lengthOf(row),
  ]);
  return { header, table };
}

const MOVES: Record<string, [number, number]> = {
  '+': [0.5, 0],
  '=': [0.5, 0],
  '-': [2, 0],
  ArrowLeft: [1, -0.25],
  ArrowRight: [1, 0.25],
};

function ZoomBar({ scale, view, setView }: { scale: Scale; view: Scale | null; setView(next: Scale | null): void }) {
  return (
    <div className={styles.actions} role="group" aria-label={t(`${k}.pictureLabel`)}>
      <Button variant="quiet" onClick={() => setView(zoomed(scale, 0.5, 0))}>
        {t(`${k}.zoomIn`)}
      </Button>
      <Button variant="quiet" onClick={() => setView(zoomed(scale, 2, 0))}>
        {t(`${k}.zoomOut`)}
      </Button>
      <Button variant="quiet" onClick={() => setView(zoomed(scale, 1, -0.25))}>
        {t(`${k}.earlier`)}
      </Button>
      <Button variant="quiet" onClick={() => setView(zoomed(scale, 1, 0.25))}>
        {t(`${k}.later`)}
      </Button>
      <Button variant="quiet" disabled={view === null} onClick={() => setView(null)}>
        {t(`${k}.fit`)}
      </Button>
    </div>
  );
}

interface DrawingProps {
  rows: readonly Row[];
  scale: Scale;
  inputs: Inputs;
  view: Scale | null;
  setView(next: Scale | null): void;
}

function Drawing({ rows, scale, inputs, view, setView }: DrawingProps) {
  const era = rows.some((row) => row.start.mid <= 0);
  const label = (row: Row) =>
    row.start.qualifier === 'on' ? row.label : t(`${k}.${row.start.qualifier}`, { label: row.label });
  const tick = (value: number, axis: Scale) => (axis.kind === 'log' ? deepText(value) : yearText(value, era));
  const drawing = attempt(() => timelineSvg(rows, { width: 820, scale, title: t(`${k}.title`), tick, label }));
  if (!drawing.ok) return <Problem text={errorText('timeline', drawing.code)} />;
  const { svg, tracks } = drawing.value;
  const ends =
    scale.kind === 'log'
      ? [deepText(scale.oldest), deepText(scale.youngest)]
      : [yearText(scale.from, era), yearText(scale.to, era)];
  const items = rows.filter((row) => row.kind !== 'era').length;
  const alt = t(`${k}.alt`, { items, tracks: tracks.length, from: ends[0]!, to: ends[1]! });
  const { header, table } = timelineTable(rows, era);
  const steps = timelineSteps(rows);
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = MOVES[event.key];
    if (!move) return;
    event.preventDefault();
    setView(zoomed(scale, move[0], move[1]));
  };
  return (
    <>
      <Note>{t(`${k}.summary`, { items, tracks: tracks.length })}</Note>
      <ZoomBar scale={scale} view={view} setView={setView} />
      <div tabIndex={0} role="group" aria-label={t(`${k}.pictureLabel`)} onKeyDown={onKey}>
        <Picture svg={svg} alt={alt} />
      </div>
      <DataTable caption={t(`${k}.rows`)} header={header} rows={table} />
      {rows.length > 1 ? <Compare rows={rows} era={era} /> : null}
      <Steps steps={steps} />
      <InsertBar
        payloads={{
          table: { header, rows: table },
          steps,
          picture: { svg, name: 'timeline', alt },
          figure: { tool: 'timeline', inputs, svg, alt, summary: alt },
        }}
      />
    </>
  );
}

export function TimelineTool() {
  const [inputs, setInputs] = useState<Inputs>(restored);
  const [view, setView] = useState<Scale | null>(null);
  const set = (patch: Partial<Inputs>) => {
    setInputs({ ...inputs, ...patch });
    setView(null);
  };
  const result = useMemo(() => {
    try {
      const rows = parseRows(inputs.text);
      return { ok: true as const, rows, scale: viewOf(rows, inputs, view) };
    } catch (error) {
      return { ok: false as const, problem: rowProblem(error) };
    }
  }, [inputs, view]);

  const fromPage = () => {
    const tables = tablesOf(pageBlocks() ?? []);
    const table = tables[0];
    if (!table) return announce(t(`${k}.noTable`));
    set({
      text: gridOf(table)
        .map((cells) => cells.join('\t'))
        .join('\n'),
    });
    announce(t(`${k}.tookTable`, { number: table.number }));
  };

  const body = result.ok ? (
    <Drawing rows={result.rows} scale={result.scale} inputs={inputs} view={view} setView={setView} />
  ) : (
    <Problem text={result.problem} />
  );

  return (
    <Tool label={t(`${k}.title`)}>
      <Field
        label={t(`${k}.rows`)}
        value={inputs.text}
        onChange={(text) => set({ text })}
        rows={8}
        mono
        hint={t(`${k}.rowsHint`)}
      />
      <div className={styles.actions}>
        <Button variant="quiet" onClick={fromPage}>
          {t(`${k}.fromPage`)}
        </Button>
      </div>
      <Fields>
        <Choice<ScaleKind>
          label={t(`${k}.scale`)}
          value={inputs.scale}
          options={SCALES.map((id) => ({ value: id, label: ht(`timeline.scales.${id}`) }))}
          onChange={(scale) => set({ scale })}
        />
        {inputs.scale !== 'log' ? (
          <>
            <Field label={t(`${k}.viewFrom`)} value={inputs.from} onChange={(from) => set({ from })} numeric />
            <Field
              label={t(`${k}.viewTo`)}
              value={inputs.to}
              onChange={(to) => set({ to })}
              numeric
              hint={t(`${k}.viewHint`)}
            />
          </>
        ) : null}
      </Fields>
      {body}
    </Tool>
  );
}
