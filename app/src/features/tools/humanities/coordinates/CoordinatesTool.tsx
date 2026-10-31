// Coordinates and navigation: convert between degrees, UTM, and MGRS; measure on the ellipsoid; work in grid zones
// and site grids; and do land and marine navigation problems.
import { useState } from 'react';
import { t } from '../../../../strings/t';
import { WGS84, direct, haversine, inverse, midpoint, rhumb } from '../geo/ellipsoid';
import { attempt, errorText, fixed, num } from '../ui/attempt';
import { Choice, Field, Fields, Source, Tabs, Tool, ht } from '../ui/parts';
import type { Outcome } from '../ui/parts';
import { ResultView } from '../ui/ResultView';
import { formatDm, formatDms, parseAngle } from './dms';
import { LandPanel, MarinePanel } from './NavPanels';
import { SitePanel, ZonePanel } from './ZonePanels';
import { centralMeridian, fromUtm, parseMgrs, toMgrs, toUtm } from './utm';

type Tab = 'convert' | 'distance' | 'zone' | 'site' | 'land' | 'marine';
const TABS: readonly Tab[] = ['convert', 'distance', 'zone', 'site', 'land', 'marine'];
const c = 'kitHumanities.coordinates';

const point = (lat: number, lon: number) =>
  t(`${c}.pointValue`, { lat: formatDms(lat, 1, 'lat'), lon: formatDms(lon, 1, 'lon') });

const utmText = (lat: number, lon: number) => {
  const utm = toUtm(lat, lon);
  return t(`${c}.utmValue`, {
    zone: utm.zone,
    band: utm.band,
    easting: fixed(utm.easting, 0),
    northing: fixed(utm.northing, 0),
  });
};

const deg = (value: number, digits = 4) => t(`${c}.degreesValue`, { value: fixed(value, digits) });

const distanceText = (meters: number) =>
  t(`${c}.distanceValue`, {
    km: fixed(meters / 1000, 3),
    mi: fixed(meters / 1609.344, 3),
    nmi: fixed(meters / 1852, 3),
  });

type Mode = 'degrees' | 'utm' | 'mgrs';
type FieldSpec = [key: string, label: string, numeric: boolean];

function readPoint(mode: Mode, fields: Record<string, string>) {
  if (mode === 'degrees') return { lat: parseAngle(fields.lat, 'lat'), lon: parseAngle(fields.lon, 'lon') };
  if (mode === 'utm') {
    return fromUtm(num(fields.zone), fields.hemisphere === 'S' ? 'S' : 'N', num(fields.easting), num(fields.northing));
  }
  const ref = parseMgrs(fields.mgrs);
  return fromUtm(ref.zone, ref.hemisphere, ref.easting + ref.precision / 2, ref.northing + ref.precision / 2);
}

function convertOutcome(mode: Mode, fields: Record<string, string>): Outcome {
  const { lat, lon } = readPoint(mode, fields);
  const utm = attempt(() => toUtm(lat, lon));
  const mgrs = attempt(() => toMgrs(lat, lon));
  const rows: [string, string][] = [
    [t(`${c}.rows.decimal`), `${fixed(lat, 6)}, ${fixed(lon, 6)}`],
    [t(`${c}.rows.dms`), point(lat, lon)],
    [t(`${c}.rows.dm`), `${formatDm(lat, 3, 'lat')}, ${formatDm(lon, 3, 'lon')}`],
    [t(`${c}.rows.utm`), utm.ok ? utmText(lat, lon) : errorText('coordinates', utm.code)],
    [t(`${c}.rows.mgrs`), mgrs.ok ? mgrs.value : errorText('coordinates', mgrs.code)],
  ];
  if (!utm.ok) return { rows, steps: [], answer: point(lat, lon) };
  rows.push(
    [t(`${c}.rows.convergence`), deg(utm.value.convergence)],
    [t(`${c}.rows.scale`), fixed(utm.value.scale, 7)],
  );
  const steps = [
    ht('coordinates.steps.zone', { zone: utm.value.zone, meridian: centralMeridian(utm.value.zone) }),
    ht('coordinates.steps.tm'),
    ...(utm.value.hemisphere === 'S' ? [ht('coordinates.steps.south')] : []),
    ht('coordinates.steps.utm', { utm: utmText(lat, lon) }),
    ...(mgrs.ok ? [ht('coordinates.steps.mgrs', { mgrs: mgrs.value })] : []),
  ];
  return { rows, steps, answer: `${point(lat, lon)} = ${utmText(lat, lon)}` };
}

function FieldList(props: {
  specs: FieldSpec[];
  fields: Record<string, string>;
  set(key: string): (v: string) => void;
}) {
  return (
    <>
      {props.specs.map(([key, label, numeric]) => (
        <Field
          key={key}
          label={ht(`coordinates.${label}`)}
          value={props.fields[key]}
          onChange={props.set(key)}
          numeric={numeric}
          hint={key === 'lat' ? t(`${c}.angleHint`) : key === 'mgrs' ? t(`${c}.mgrsHint`) : undefined}
          wide={key === 'mgrs'}
        />
      ))}
    </>
  );
}

function ConvertPanel() {
  const [mode, setMode] = useState<Mode>('degrees');
  const [fields, setFields] = useState<Record<string, string>>({
    lat: '40.446',
    lon: '-79.982',
    zone: '18',
    hemisphere: 'N',
    easting: '500000',
    northing: '4427757',
    mgrs: '18T WK 00000 27757',
  });
  const set = (key: string) => (value: string) => setFields((current) => ({ ...current, [key]: value }));
  const specs: Record<Mode, FieldSpec[]> = {
    degrees: [
      ['lat', 'lat', false],
      ['lon', 'lon', false],
    ],
    utm: [
      ['zone', 'zone', true],
      ['easting', 'easting', true],
      ['northing', 'northing', true],
    ],
    mgrs: [['mgrs', 'mgrs', false]],
  };
  return (
    <>
      <Choice<Mode>
        label={t(`${c}.input`)}
        value={mode}
        onChange={setMode}
        options={(['degrees', 'utm', 'mgrs'] as const).map((id) => ({
          value: id,
          label: ht(`coordinates.inputs.${id}`),
        }))}
      />
      <Fields>
        {mode === 'utm' ? (
          <Choice
            label={t(`${c}.hemisphere`)}
            value={fields.hemisphere}
            onChange={set('hemisphere')}
            options={[
              { value: 'N', label: t(`${c}.north`) },
              { value: 'S', label: t(`${c}.south`) },
            ]}
          />
        ) : null}
        <FieldList specs={specs[mode]} fields={fields} set={set} />
      </Fields>
      <ResultView tool="coordinates" result={attempt(() => convertOutcome(mode, fields))} />
    </>
  );
}

type DistanceProblem = 'inverse' | 'direct';

function directOutcome(lat1: number, lon1: number, f: Record<string, string>): Outcome {
  const meters = num(f.km) * 1000;
  const end = direct(lat1, lon1, num(f.az), meters);
  const rows: [string, string][] = [
    [t(`${c}.rows.destination`), point(end.lat, end.lon)],
    [t(`${c}.rows.decimal`), `${fixed(end.lat, 6)}, ${fixed(end.lon, 6)}`],
    [t(`${c}.rows.arrival`), deg(end.azimuth)],
  ];
  const step = ht('coordinates.steps.direct', {
    lat: fixed(lat1, 5),
    lon: fixed(lon1, 5),
    az: f.az,
    distance: fixed(meters, 1),
  });
  return { rows, steps: [step], answer: point(end.lat, end.lon) };
}

function distanceOutcome(problem: DistanceProblem, f: Record<string, string>): Outcome {
  const lat1 = parseAngle(f.lat1, 'lat');
  const lon1 = parseAngle(f.lon1, 'lon');
  if (problem === 'direct') return directOutcome(lat1, lon1, f);
  const lat2 = parseAngle(f.lat2, 'lat');
  const lon2 = parseAngle(f.lon2, 'lon');
  const path = inverse(lat1, lon1, lat2, lon2, WGS84);
  const sphere = haversine(lat1, lon1, lat2, lon2);
  const line = rhumb(lat1, lon1, lat2, lon2);
  const mid = midpoint(lat1, lon1, lat2, lon2);
  const rows: [string, string][] = [
    [t(`${c}.rows.distance`), distanceText(path.distance)],
    [t(`${c}.rows.azimuth1`), deg(path.azimuth1)],
    [t(`${c}.rows.azimuth2`), deg(path.azimuth2)],
    [t(`${c}.rows.haversine`), distanceText(sphere)],
    [t(`${c}.rows.rhumbCourse`), deg(line.course)],
    [t(`${c}.rows.rhumbDistance`), distanceText(line.distance)],
    [t(`${c}.rows.midpoint`), point(mid.lat, mid.lon)],
  ];
  const steps = [
    ht('coordinates.steps.vincenty', { ellipsoid: 'WGS 84', count: path.iterations }),
    ht('coordinates.steps.distance', {
      distance: fixed(path.distance, 3),
      az1: fixed(path.azimuth1, 4),
      az2: fixed(path.azimuth2, 4),
    }),
    ht('coordinates.steps.haversine', { distance: fixed(sphere, 1) }),
  ];
  return { rows, steps, answer: `${distanceText(path.distance)}, ${deg(path.azimuth1)}` };
}

function DistancePanel() {
  const [problem, setProblem] = useState<DistanceProblem>('inverse');
  const [f, setF] = useState<Record<string, string>>({
    lat1: '40.6413 N',
    lon1: '73.7781 W',
    lat2: '51.47 N',
    lon2: '0.4543 W',
    az: '45',
    km: '100',
  });
  const set = (key: string) => (value: string) => setF((current) => ({ ...current, [key]: value }));
  const start: FieldSpec[] = [
    ['lat1', 'fromLat', false],
    ['lon1', 'fromLon', false],
  ];
  const rest: FieldSpec[] =
    problem === 'inverse'
      ? [
          ['lat2', 'toLat', false],
          ['lon2', 'toLon', false],
        ]
      : [
          ['az', 'azimuth', true],
          ['km', 'distanceKm', true],
        ];
  return (
    <>
      <Choice<DistanceProblem>
        label={t(`${c}.problem`)}
        value={problem}
        onChange={setProblem}
        options={(['inverse', 'direct'] as const).map((id) => ({ value: id, label: ht(`coordinates.problems.${id}`) }))}
      />
      <Fields>
        <FieldList specs={[...start, ...rest]} fields={f} set={set} />
      </Fields>
      <ResultView tool="coordinates" result={attempt(() => distanceOutcome(problem, f))} />
    </>
  );
}

export function CoordinatesTool() {
  const [tab, setTab] = useState<Tab>('convert');
  return (
    <Tool label={t(`${c}.title`)}>
      <Tabs<Tab>
        label={t(`${c}.modes`)}
        items={TABS.map((id) => ({ id, label: ht(`coordinates.tabs.${id}`) }))}
        value={tab}
        onChange={setTab}
      />
      {tab === 'convert' ? <ConvertPanel /> : null}
      {tab === 'distance' ? <DistancePanel /> : null}
      {tab === 'zone' ? <ZonePanel /> : null}
      {tab === 'site' ? <SitePanel /> : null}
      {tab === 'land' ? <LandPanel /> : null}
      {tab === 'marine' ? <MarinePanel /> : null}
      <Source of="coordinates" />
    </Tool>
  );
}
