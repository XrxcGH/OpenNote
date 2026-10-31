// Land navigation (azimuths, pace counts, intersection, and resection) and marine navigation (dead reckoning, the
// current triangle, time, speed, and distance, and chart scale).
import '../text';
import { useState } from 'react';
import { t } from '../../../../strings/t';
import { attempt, fixed, num } from '../ui/attempt';
import { ResultView } from '../ui/ResultView';
import { Choice, Field, Fields, ht } from '../ui/parts';
import type { Outcome } from '../ui/parts';
import { formatDms, parseAngle } from './dms';
import {
  backAzimuth,
  chartDistance,
  courseToSteer,
  deadReckon,
  gridMagneticAngle,
  intersect,
  magneticToTrue,
  paceDistance,
  resect,
  timeSpeedDistance,
  trueToGrid,
  trueToMagnetic,
  gridToTrue,
} from './nav';
import { currentSvg, intersectionSvg } from './picture';

const c = 'kitHumanities.coordinates';
const deg = (value: number) => t(`${c}.degreesValue`, { value: fixed(value, 2) });

type Land = 'azimuth' | 'pace' | 'intersect' | 'resect';
type Kind = 'true' | 'magnetic' | 'grid';

function landOutcome(mode: Land, kind: Kind, f: Record<string, string>): Outcome {
  if (mode === 'azimuth') {
    const az = num(f.az);
    const decl = num(f.decl);
    const conv = num(f.conv);
    const truth = kind === 'true' ? az : kind === 'magnetic' ? magneticToTrue(az, decl) : gridToTrue(az, conv);
    const magnetic = trueToMagnetic(truth, decl);
    const grid = trueToGrid(truth, conv);
    const rows: [string, string][] = [
      [t(`${c}.navRows.true`), deg(truth)],
      [t(`${c}.navRows.magnetic`), deg(magnetic)],
      [t(`${c}.navRows.grid`), deg(grid)],
      [t(`${c}.navRows.back`), deg(backAzimuth(truth))],
      [t(`${c}.navRows.gm`), deg(gridMagneticAngle(decl, conv))],
    ];
    const steps = [
      ht('coordinates.steps.declination', {
        true: fixed(truth, 2),
        decl: fixed(decl, 2),
        magnetic: fixed(magnetic, 2),
      }),
      ht('coordinates.steps.grid', { true: fixed(truth, 2), conv: fixed(conv, 2), grid: fixed(grid, 2) }),
      ht('coordinates.steps.back', { back: fixed(backAzimuth(truth), 2) }),
    ];
    return { rows, steps, answer: rows.map(([name, value]) => `${name} ${value}`).join('; ') };
  }
  if (mode === 'pace') {
    const meters = paceDistance(num(f.paces), num(f.per));
    const value = t(`${c}.metersValue`, { value: fixed(meters, 1) });
    const step = ht('coordinates.steps.pace', { paces: f.paces, per: f.per, distance: fixed(meters, 1) });
    return { rows: [[t(`${c}.navRows.distance`), value]], steps: [step], answer: value };
  }
  const p1 = { x: num(f.x1), y: num(f.y1) };
  const p2 = { x: num(f.x2), y: num(f.y2) };
  const [a1, a2] = [num(f.a1), num(f.a2)];
  const cross = mode === 'intersect' ? intersect(p1, a1, p2, a2) : resect(p1, a1, p2, a2);
  const place = t(`${c}.xyValue`, { x: fixed(cross.x, 3), y: fixed(cross.y, 3) });
  const rows: [string, string][] = [
    [t(`${c}.navRows.point`), place],
    [t(`${c}.navRows.along1`), fixed(Math.abs(cross.along1), 3)],
    [t(`${c}.navRows.along2`), fixed(Math.abs(cross.along2), 3)],
  ];
  const steps =
    mode === 'intersect'
      ? [ht('coordinates.steps.intersect', { x: fixed(cross.x, 3), y: fixed(cross.y, 3) })]
      : [ht('coordinates.steps.resect', { b1: fixed(backAzimuth(a1), 2), b2: fixed(backAzimuth(a2), 2) })];
  const alt = t(`${c}.diagram`);
  const svg = intersectionSvg(p1, p2, cross, ['1', '2', 'X'], alt);
  return {
    rows,
    steps,
    answer: place,
    picture: { svg, name: 'bearings', alt },
    note: mode === 'intersect' && cross.behind ? t(`${c}.behind`) : undefined,
  };
}

export function LandPanel() {
  const [mode, setMode] = useState<Land>('azimuth');
  const [kind, setKind] = useState<Kind>('true');
  const [f, setF] = useState<Record<string, string>>({
    az: '100',
    decl: '12',
    conv: '0',
    paces: '130',
    per: '65',
    x1: '0',
    y1: '0',
    x2: '100',
    y2: '0',
    a1: '45',
    a2: '315',
  });
  const set = (key: string) => (value: string) => setF((current) => ({ ...current, [key]: value }));
  const field = (key: string, label: string) => (
    <Field key={key} label={ht(`coordinates.${label}`)} value={f[key]} onChange={set(key)} numeric />
  );
  const result = attempt(() => landOutcome(mode, kind, f));
  const landmarks = mode === 'resect';
  return (
    <>
      <Choice<Land>
        label={t(`${c}.landMode`)}
        value={mode}
        onChange={setMode}
        options={(['azimuth', 'pace', 'intersect', 'resect'] as const).map((id) => ({
          value: id,
          label: ht(`coordinates.landModes.${id}`),
        }))}
      />
      <Fields>
        {mode === 'azimuth' ? (
          <>
            {field('az', `azimuthValue`)}
            <Choice<Kind>
              label={t(`${c}.azimuthKind`)}
              value={kind}
              onChange={setKind}
              options={(['true', 'magnetic', 'grid'] as const).map((id) => ({
                value: id,
                label: ht(`coordinates.azimuthKinds.${id}`),
              }))}
            />
            {field('decl', `declination`)}
            {field('conv', `convergence`)}
          </>
        ) : mode === 'pace' ? (
          <>
            {field('paces', `paces`)}
            {field('per', `pacesPer100`)}
          </>
        ) : (
          <>
            {field('x1', landmarks ? `l1x` : `p1x`)}
            {field('y1', landmarks ? `l1y` : `p1y`)}
            {field('a1', landmarks ? `taz1` : `az1`)}
            {field('x2', landmarks ? `l2x` : `p2x`)}
            {field('y2', landmarks ? `l2y` : `p2y`)}
            {field('a2', landmarks ? `taz2` : `az2`)}
          </>
        )}
      </Fields>
      <ResultView tool="coordinates" result={result} />
    </>
  );
}

type Marine = 'reckon' | 'current' | 'tsd' | 'chart';

function marineOutcome(mode: Marine, method: 'mid' | 'start', f: Record<string, string>): Outcome {
  if (mode === 'reckon') {
    const run = deadReckon(
      { lat: parseAngle(f.lat, 'lat'), lon: parseAngle(f.lon, 'lon') },
      num(f.course),
      num(f.knots),
      num(f.hours),
      method,
    );
    const position = `${formatDms(run.lat, 1, 'lat')}, ${formatDms(run.lon, 1, 'lon')}`;
    const rows: [string, string][] = [
      [t(`${c}.marineRows.run`), t(`${c}.milesValue`, { value: fixed(run.distance, 3) })],
      [t(`${c}.marineRows.dlat`), t(`${c}.degreesValue`, { value: fixed(run.dLat, 5) })],
      [t(`${c}.marineRows.departure`), t(`${c}.milesValue`, { value: fixed(run.departure, 3) })],
      [t(`${c}.marineRows.dlon`), t(`${c}.degreesValue`, { value: fixed(run.dLon, 5) })],
      [t(`${c}.marineRows.position`), position],
    ];
    const steps = [
      ht('coordinates.steps.reckon', { knots: f.knots, hours: f.hours, distance: fixed(run.distance, 3) }),
      ht('coordinates.steps.dlat', { dlat: fixed(run.dLat, 5) }),
      ht('coordinates.steps.dlon', { lat: fixed(run.usedLat, 5), dlon: fixed(run.dLon, 5) }),
    ];
    return { rows, steps, answer: position };
  }
  if (mode === 'current') {
    const [track, speed, set, drift] = [num(f.track), num(f.knots), num(f.set), num(f.drift)];
    const steer = courseToSteer(track, speed, set, drift);
    const rows: [string, string][] = [
      [t(`${c}.marineRows.heading`), deg(steer.heading)],
      [t(`${c}.marineRows.correction`), deg(steer.correction)],
      [t(`${c}.marineRows.made`), t(`${c}.knotsValue`, { value: fixed(steer.speedMadeGood, 2) })],
    ];
    const steps = [
      ht('coordinates.steps.steer', { heading: fixed(steer.heading, 2), made: fixed(steer.speedMadeGood, 2) }),
    ];
    const alt = t(`${c}.currentDiagram`);
    const svg = currentSvg(steer.heading, speed, set, drift, alt);
    return { rows, steps, answer: rows[0][1], picture: { svg, name: 'current-triangle', alt } };
  }
  if (mode === 'tsd') {
    const read = (text: string) => (text.trim() === '' ? null : num(text));
    const solved = timeSpeedDistance(read(f.hours), read(f.knots), read(f.miles));
    const rows: [string, string][] = [
      [t(`${c}.marineRows.time`), t(`${c}.hoursValue`, { value: fixed(solved.hours, 3) })],
      [t(`${c}.marineRows.speed`), t(`${c}.knotsValue`, { value: fixed(solved.knots, 3) })],
      [t(`${c}.marineRows.distance`), t(`${c}.milesValue`, { value: fixed(solved.miles, 3) })],
    ];
    return { rows, steps: [ht('coordinates.steps.tsd')], answer: rows.map(([, value]) => value).join(', ') };
  }
  const meters = chartDistance(num(f.cm) / 100, num(f.denominator));
  const rows: [string, string][] = [
    [
      t(`${c}.marineRows.ground`),
      `${t(`${c}.kmValue`, { value: fixed(meters / 1000, 3) })}, ${t(`${c}.milesValue`, { value: fixed(meters / 1852, 3) })}`,
    ],
  ];
  return {
    rows,
    steps: [ht('coordinates.steps.chart', { denominator: f.denominator, meters: fixed(meters, 1) })],
    answer: rows[0][1],
  };
}

export function MarinePanel() {
  const [mode, setMode] = useState<Marine>('reckon');
  const [method, setMethod] = useState<'mid' | 'start'>('mid');
  const [f, setF] = useState<Record<string, string>>({
    lat: '30 N',
    lon: '40 W',
    course: '45',
    knots: '10',
    hours: '3',
    track: '0',
    set: '90',
    drift: '2',
    miles: '',
    cm: '4.5',
    denominator: '80000',
  });
  const set = (key: string) => (value: string) => setF((current) => ({ ...current, [key]: value }));
  const field = (key: string, label: string, numeric = true, hint?: string) => (
    <Field
      key={key}
      label={ht(`coordinates.${label}`)}
      value={f[key]}
      onChange={set(key)}
      numeric={numeric}
      hint={hint}
    />
  );
  const result = attempt(() => marineOutcome(mode, method, f));
  return (
    <>
      <Choice<Marine>
        label={t(`${c}.landMode`)}
        value={mode}
        onChange={setMode}
        options={(['reckon', 'current', 'tsd', 'chart'] as const).map((id) => ({
          value: id,
          label: ht(`coordinates.marineModes.${id}`),
        }))}
      />
      <Fields>
        {mode === 'reckon' ? (
          <>
            {field('lat', `lat`, false)}
            {field('lon', `lon`, false)}
            {field('course', `course`)}
            {field('knots', `knots`)}
            {field('hours', `hours`)}
            <Choice<'mid' | 'start'>
              label={t(`${c}.method`)}
              value={method}
              onChange={setMethod}
              options={(['mid', 'start'] as const).map((id) => ({ value: id, label: ht(`coordinates.methods.${id}`) }))}
            />
          </>
        ) : mode === 'current' ? (
          <>
            {field('track', `track`)}
            {field('knots', `knots`)}
            {field('set', `set`)}
            {field('drift', `drift`)}
          </>
        ) : mode === 'tsd' ? (
          <>
            {field('hours', `hours`, true, t(`${c}.tsdHint`))}
            {field('knots', `knots`)}
            {field('miles', `miles`)}
          </>
        ) : (
          <>
            {field('cm', `chartCm`)}
            {field('denominator', `denominator`)}
          </>
        )}
      </Fields>
      <ResultView tool="coordinates" result={result} />
    </>
  );
}
