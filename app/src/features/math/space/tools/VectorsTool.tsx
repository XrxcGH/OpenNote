// The Vectors tool window. The Vectors tab works the dot and cross products, lengths, the angle, projections, the unit
// vector, the parallelogram's area, and the triple product of vectors typed as numbers, and plots them in 3D. The
// Lines and planes tab finds the distance, the meeting point or line, and the angle between two points, lines, or
// planes, with a plot. "Insert into page" adds the results as text and the plot as a 3D graph block.
import { useMemo, useState } from 'react';
import { isEnabled } from '../../../../app/flags';
import { t } from '../../../../strings/t';
import { TextField } from '../../../../ui';
import {
  compareLines,
  distancePointLine,
  distancePointPlane,
  distancePoints,
  footOnPlane,
  lineMeetsPlane,
  lineText,
  planesMeet,
  planeText,
  type Line3,
  type Plane,
} from '../geometry3d';
import { Graph3DView } from '../Graph3DView';
import { readItem } from '../source3d';
import {
  angleBetween,
  cross,
  dot,
  norm,
  parallelogramArea,
  projection,
  readVec,
  scalarProjection,
  tidy,
  tripleProduct,
  unit,
  vecText,
  type Vec3,
} from '../vec';
import { InsertResult, Results } from './common';
import styles from './lab.module.css';

type Tab = 'vectors' | 'geometry';

const num = (value: number) => String(tidy(Number(value.toPrecision(6))));
const degrees = (radians: number) => num((radians * 180) / Math.PI);
const plain = (v: Vec3) => vecText(v).replace(/[⟨⟩]/g, '');

export function VectorsTool() {
  const [tab, setTab] = useState<Tab>('vectors');
  const tabs: Tab[] = isEnabled('math.geometry3d') ? ['vectors', 'geometry'] : ['vectors'];
  return (
    <div className={styles.tool}>
      {tabs.length > 1 ? (
        <div className={styles.tabs} role="tablist" aria-label={t('graph3d.tools.vectors.title')}>
          {tabs.map((one) => (
            <button
              key={one}
              type="button"
              role="tab"
              id={`vectors-tab-${one}`}
              aria-selected={tab === one}
              aria-controls="vectors-panel"
              className={styles.tab}
              onClick={() => setTab(one)}
            >
              {t(one === 'vectors' ? 'graph3d.tools.vectors.tabVectors' : 'graph3d.tools.vectors.tabGeometry')}
            </button>
          ))}
        </div>
      ) : null}
      <div id="vectors-panel" role="tabpanel" aria-labelledby={`vectors-tab-${tab}`} className={styles.tool}>
        {tab === 'vectors' ? <VectorsPanel /> : <GeometryPanel />}
      </div>
    </div>
  );
}

/** A 3D graph in the tool: turnable, with its text kept here rather than in a page. */
function Plot({ source }: { source: string }) {
  const [edited, setEdited] = useState<{ from: string; text: string } | null>(null);
  const text = edited?.from === source ? edited.text : source;
  return <Graph3DView source={text} editable onSource={(next) => setEdited({ from: source, text: next })} />;
}

function VectorsPanel() {
  const [a, setA] = useState('1, 3, 4');
  const [b, setB] = useState('2, 7, -5');
  const [c, setC] = useState('');
  const va = readVec(a);
  const vb = readVec(b);
  const vc = c.trim() === '' ? null : readVec(c);
  const bad = (name: string, text: string, value: Vec3 | null) =>
    value === null && text.trim() !== '' ? t('graph3d.tools.vectors.bad', { name }) : undefined;

  const rows = useMemo(() => {
    if (!va || !vb) return [];
    const none = t('graph3d.tools.vectors.none');
    const angle = angleBetween(va, vb);
    const comp = scalarProjection(va, vb);
    const proj = projection(va, vb);
    const ua = unit(va);
    const out: [string, string][] = [
      [t('graph3d.tools.vectors.dot'), num(dot(va, vb))],
      [t('graph3d.tools.vectors.cross'), vecText(cross(va, vb))],
      [t('graph3d.tools.vectors.lengthA'), num(norm(va))],
      [t('graph3d.tools.vectors.lengthB'), num(norm(vb))],
      [
        t('graph3d.tools.vectors.angle'),
        angle === null ? none : t('graph3d.tools.vectors.angleValue', { degrees: degrees(angle), radians: num(angle) }),
      ],
      [t('graph3d.tools.vectors.scalarProj'), comp === null ? none : num(comp)],
      [t('graph3d.tools.vectors.vectorProj'), proj === null ? none : vecText(proj)],
      [t('graph3d.tools.vectors.unitA'), ua === null ? none : vecText(ua)],
      [t('graph3d.tools.vectors.area'), num(parallelogramArea(va, vb))],
    ];
    if (vc) out.push([t('graph3d.tools.vectors.triple'), num(tripleProduct(va, vb, vc))]);
    return out;
  }, [va, vb, vc]);

  const notes: string[] = [];
  if (va && vb && norm(va) > 0 && norm(vb) > 0) {
    const angle = angleBetween(va, vb)!;
    if (Math.abs(dot(va, vb)) < 1e-12 * norm(va) * norm(vb)) notes.push(t('graph3d.tools.vectors.orthogonal'));
    else if (angle < 1e-9 || Math.PI - angle < 1e-9) notes.push(t('graph3d.tools.vectors.parallel'));
  }

  const graph =
    va && vb
      ? [
          '@3d',
          `vector <${plain(va)}>`,
          `vector <${plain(vb)}>`,
          `vector <${plain(cross(va, vb))}>`,
          ...(vc ? [`vector <${plain(vc)}>`] : []),
        ].join('\n')
      : null;
  const summary = rows.map(([name, value]) => `${name} = ${value}`).join('; ');

  return (
    <>
      <p className={styles.note}>{t('graph3d.tools.vectors.hint')}</p>
      <div className={styles.fields}>
        <TextField label={t('graph3d.tools.vectors.a')} value={a} onChange={setA} error={bad('a', a, va)} />
        <TextField label={t('graph3d.tools.vectors.b')} value={b} onChange={setB} error={bad('b', b, vb)} />
        <TextField label={t('graph3d.tools.vectors.c')} value={c} onChange={setC} error={bad('c', c, vc)} />
      </div>
      {rows.length > 0 ? <Results label={t('graph3d.tools.vectors.results')} rows={rows} /> : null}
      {notes.map((note) => (
        <p key={note} className={styles.note} role="status">
          {note}
        </p>
      ))}
      {graph ? <Plot source={graph} /> : null}
      {graph ? (
        <div className={styles.actions}>
          <InsertResult text={`a = ${vecText(va!)}, b = ${vecText(vb!)}: ${summary}.`} graph={graph} />
        </div>
      ) : null}
    </>
  );
}

type Kind = 'point' | 'line' | 'plane';
type Thing = { kind: 'point'; point: Vec3 } | { kind: 'line'; line: Line3 } | { kind: 'plane'; plane: Plane };

const HINTS: Record<Kind, 'pointHint' | 'lineHint' | 'planeHint'> = {
  point: 'pointHint',
  line: 'lineHint',
  plane: 'planeHint',
};

/** Reads one object as its kind says, through the 3D graph's own item reader. */
function readThing(kind: Kind, text: string): Thing | null {
  if (kind === 'point') {
    const point = readVec(text);
    return point ? { kind, point } : null;
  }
  const item = readItem(`${kind} ${text}`);
  if (item.kind === 'line') return { kind: 'line', line: item.line };
  if (item.kind === 'plane') return { kind: 'plane', plane: item.plane };
  return null;
}

const itemText = (thing: Thing, text: string) =>
  thing.kind === 'point' ? `point (${plain(thing.point)})` : `${thing.kind} ${text}`;

/** The answer for two objects, in sentences, and an extra point to plot (where they meet), if any. */
function relate(p: Thing, q: Thing): { lines: string[]; extra: Vec3 | null } {
  const k = 'graph3d.tools.geometry';
  if (p.kind === 'plane' && q.kind !== 'plane') {
    const swapped = relate(q, p);
    return swapped;
  }
  if (p.kind === 'line' && q.kind === 'point') return relate(q, p);
  const distance = (value: number) => t(`${k}.distance`, { value: num(value) });
  const angle = (radians: number) => t(`${k}.angle`, { degrees: degrees(radians) });
  if (p.kind === 'point' && q.kind === 'point')
    return { lines: [distance(distancePoints(p.point, q.point))], extra: null };
  if (p.kind === 'point' && q.kind === 'line')
    return { lines: [distance(distancePointLine(p.point, q.line))], extra: null };
  if (p.kind === 'point' && q.kind === 'plane') {
    const foot = footOnPlane(p.point, q.plane);
    return {
      lines: [distance(distancePointPlane(p.point, q.plane)), t(`${k}.foot`, { point: vecText(foot) })],
      extra: foot,
    };
  }
  if (p.kind === 'line' && q.kind === 'line') {
    const pair = compareLines(p.line, q.line);
    if (pair.kind === 'intersect') {
      return {
        lines: [t(`${k}.intersectPoint`, { point: vecText(pair.point) }), angle(pair.angle)],
        extra: pair.point,
      };
    }
    if (pair.kind === 'parallel') return { lines: [t(`${k}.parallel`), distance(pair.distance)], extra: null };
    if (pair.kind === 'same') return { lines: [t(`${k}.same`)], extra: null };
    return {
      lines: [
        t(`${k}.skew`),
        distance(pair.distance),
        t(`${k}.closest`, { p: vecText(pair.closest[0]), q: vecText(pair.closest[1]) }),
      ],
      extra: null,
    };
  }
  if (p.kind === 'line' && q.kind === 'plane') {
    const hit = lineMeetsPlane(p.line, q.plane);
    if (hit.kind === 'intersect') {
      return { lines: [t(`${k}.intersectPoint`, { point: vecText(hit.point) }), angle(hit.angle)], extra: hit.point };
    }
    if (hit.kind === 'parallel') return { lines: [t(`${k}.parallel`), distance(hit.distance)], extra: null };
    return { lines: [t(`${k}.inPlane`)], extra: null };
  }
  if (p.kind === 'plane' && q.kind === 'plane') {
    const pair = planesMeet(p.plane, q.plane);
    if (pair.kind === 'intersect')
      return { lines: [t(`${k}.intersectLine`, { line: lineText(pair.line) }), angle(pair.angle)], extra: null };
    if (pair.kind === 'parallel') return { lines: [t(`${k}.parallel`), distance(pair.distance)], extra: null };
    return { lines: [t(`${k}.same`)], extra: null };
  }
  return { lines: [], extra: null };
}

function ObjectFields(props: {
  which: 'first' | 'second';
  kind: Kind;
  text: string;
  bad: boolean;
  onKind(kind: Kind): void;
  onText(text: string): void;
}) {
  const { which, kind, text, bad, onKind, onText } = props;
  const name = t(`graph3d.tools.geometry.${which}`);
  const hint = t(`graph3d.tools.geometry.${HINTS[kind]}`);
  return (
    <div className={styles.fields}>
      <label className={styles.select}>
        <span>{t('graph3d.tools.geometry.kindLabel', { which: name.toLowerCase() })}</span>
        <select value={kind} onChange={(event) => onKind(event.target.value as Kind)}>
          {(['point', 'line', 'plane'] as const).map((one) => (
            <option key={one} value={one}>
              {t(`graph3d.tools.geometry.${one}`)}
            </option>
          ))}
        </select>
      </label>
      <TextField
        label={hint}
        value={text}
        onChange={onText}
        error={bad ? t('graph3d.tools.geometry.bad', { which: name.toLowerCase(), hint }) : undefined}
      />
    </div>
  );
}

function GeometryPanel() {
  const [kinds, setKinds] = useState<[Kind, Kind]>(['line', 'line']);
  const [texts, setTexts] = useState<[string, string]>(['(1, -2, 4) + t<1, 3, -1>', '(0, 3, -3) + t<2, 1, 4>']);
  const things = [readThing(kinds[0], texts[0]), readThing(kinds[1], texts[1])] as const;
  const answer = things[0] && things[1] ? relate(things[0], things[1]) : null;
  const graph =
    things[0] && things[1]
      ? [
          '@3d',
          itemText(things[0], texts[0]),
          itemText(things[1], texts[1]),
          ...(answer?.extra ? [`point (${plain(answer.extra)})`] : []),
        ].join('\n')
      : null;
  const set = (index: 0 | 1, kind: Kind | null, text: string | null) => {
    if (kind) setKinds((current) => (index === 0 ? [kind, current[1]] : [current[0], kind]));
    if (text !== null) setTexts((current) => (index === 0 ? [text, current[1]] : [current[0], text]));
  };
  const description = [planeOrText(things[0], texts[0]), planeOrText(things[1], texts[1])].join('; ');
  return (
    <>
      <ObjectFields
        which="first"
        kind={kinds[0]}
        text={texts[0]}
        bad={!things[0] && texts[0].trim() !== ''}
        onKind={(kind) => set(0, kind, null)}
        onText={(text) => set(0, null, text)}
      />
      <ObjectFields
        which="second"
        kind={kinds[1]}
        text={texts[1]}
        bad={!things[1] && texts[1].trim() !== ''}
        onKind={(kind) => set(1, kind, null)}
        onText={(text) => set(1, null, text)}
      />
      {answer ? (
        <div role="status" className={styles.results}>
          {answer.lines.map((line) => (
            <p key={line} className={styles.note}>
              {line}
            </p>
          ))}
        </div>
      ) : null}
      {graph ? <Plot source={graph} /> : null}
      {graph && answer ? (
        <div className={styles.actions}>
          <InsertResult text={`${description}: ${answer.lines.join(' ')}`} graph={graph} />
        </div>
      ) : null}
    </>
  );
}

function planeOrText(thing: Thing | null, text: string): string {
  if (!thing) return text;
  if (thing.kind === 'plane') return planeText(thing.plane);
  if (thing.kind === 'line') return lineText(thing.line);
  return vecText(thing.point);
}
