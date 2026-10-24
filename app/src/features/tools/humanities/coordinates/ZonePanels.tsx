// Grid zones typed from their published parameters, and site grids fitted to control points.
import { useState } from 'react';
import { t } from '../../../../strings/t';
import { GRS80, WGS84 } from '../geo/ellipsoid';
import { attempt, errorText, fixed, num } from '../ui/attempt';
import { Choice, DataTable, Field, Fields, InsertBar, Note, Problem, Results, Steps, ht } from '../ui/parts';
import { formatDms, parseAngle } from './dms';
import { fitHelmert, siteToMap } from './helmert';
import { INTERNATIONAL_FOOT, US_SURVEY_FOOT, zoneForward, zoneInverse } from './zones';
import type { Zone } from './zones';

const c = 'kitHumanities.coordinates';
type Unit = 'm' | 'usft' | 'ft';
const METERS: Record<Unit, number> = { m: 1, usft: US_SURVEY_FOOT, ft: INTERNATIONAL_FOOT };
const header = () => [t('kitHumanities.common.quantity'), t('kitHumanities.common.value')];

interface ZoneInput {
  kind: Zone['kind'];
  ellipsoid: 'grs80' | 'wgs84';
  unit: Unit;
  direction: 'toGrid' | 'toGeo';
  f: Record<string, string>;
}

function zoneOutcome({ kind, ellipsoid, unit, direction, f }: ZoneInput) {
  const scale = METERS[unit];
  const common = {
    lat0: parseAngle(f.lat0, 'lat'),
    lon0: parseAngle(f.lon0, 'lon'),
    falseEasting: num(f.fe) * scale,
    falseNorthing: num(f.fn) * scale,
  };
  const zone: Zone =
    kind === 'lambert'
      ? { kind, lat1: parseAngle(f.lat1, 'lat'), lat2: parseAngle(f.lat2, 'lat'), ...common }
      : { kind, k0: num(f.k0), ...common };
  const ell = ellipsoid === 'grs80' ? GRS80 : WGS84;
  const geo =
    direction === 'toGrid'
      ? { lat: parseAngle(f.lat, 'lat'), lon: parseAngle(f.lon, 'lon') }
      : zoneInverse(zone, num(f.e) * scale, num(f.n) * scale, ell);
  const grid = zoneForward(zone, geo.lat, geo.lon, ell);
  const rows: [string, string][] = [
    [t(`${c}.rows.latLon`), `${formatDms(geo.lat, 3, 'lat')}, ${formatDms(geo.lon, 3, 'lon')}`],
    [
      t(`${c}.rows.grid`),
      t(`${c}.shiftValue`, { e: fixed(grid.easting / scale, 3), n: fixed(grid.northing / scale, 3) }),
    ],
    [t(`${c}.rows.convergence`), t(`${c}.degreesValue`, { value: fixed(grid.convergence, 5) })],
    [t(`${c}.rows.scale`), fixed(grid.scale, 8)],
  ];
  const steps = [
    kind === 'lambert'
      ? ht('coordinates.steps.lambert')
      : ht('coordinates.steps.tmZone', { k0: f.k0, lat0: fixed(common.lat0, 5) }),
    ht('coordinates.steps.units', { unit: ht(`coordinates.unitNames.${unit}`), meters: fixed(scale, 10) }),
  ];
  return { rows, steps, answer: rows[direction === 'toGrid' ? 1 : 0][1] };
}

function options<T extends string>(ids: readonly T[], group: string) {
  return ids.map((id) => ({ value: id, label: ht(`coordinates.${group}.${id}`) }));
}

function ZoneChoices({ input, change }: { input: ZoneInput; change(next: Partial<ZoneInput>): void }) {
  return (
    <>
      <Choice<Zone['kind']>
        label={t(`${c}.zoneKind`)}
        value={input.kind}
        onChange={(kind) => change({ kind })}
        options={options(['lambert', 'tm'] as const, 'kinds')}
      />
      <Choice<ZoneInput['ellipsoid']>
        label={t(`${c}.ellipsoid`)}
        value={input.ellipsoid}
        onChange={(ellipsoid) => change({ ellipsoid })}
        options={options(['grs80', 'wgs84'] as const, 'ellipsoids')}
      />
      <Choice<Unit>
        label={t(`${c}.units`)}
        value={input.unit}
        onChange={(unit) => change({ unit })}
        options={options(['m', 'usft', 'ft'] as const, 'unitNames')}
      />
      <Choice<ZoneInput['direction']>
        label={t(`${c}.direction`)}
        value={input.direction}
        onChange={(direction) => change({ direction })}
        options={options(['toGrid', 'toGeo'] as const, 'directions')}
      />
    </>
  );
}

function ZoneFields({ input, set }: { input: ZoneInput; set(key: string): (value: string) => void }) {
  const field = (key: string, label: string, numeric = false) => (
    <Field key={key} label={ht(`coordinates.${label}`)} value={input.f[key]} onChange={set(key)} numeric={numeric} />
  );
  const keys: [string, string, boolean][] =
    input.kind === 'lambert'
      ? [
          ['lat1', 'lat1', false],
          ['lat2', 'lat2', false],
        ]
      : [['k0', 'k0', true]];
  keys.push(
    ['lat0', 'lat0', false],
    ['lon0', 'lon0', false],
    ['fe', 'falseEasting', true],
    ['fn', 'falseNorthing', true],
  );
  if (input.direction === 'toGrid') keys.push(['lat', 'lat', false], ['lon', 'lon', false]);
  else keys.push(['e', 'gridE', true], ['n', 'gridN', true]);
  return <>{keys.map(([key, label, numeric]) => field(key, label, numeric))}</>;
}

export function ZonePanel() {
  const [input, setInput] = useState<ZoneInput>({
    kind: 'lambert',
    ellipsoid: 'grs80',
    unit: 'm',
    direction: 'toGrid',
    f: {
      lat1: '34 02',
      lat2: '35 28',
      lat0: '33 30',
      lon0: '-118',
      k0: '0.9999',
      fe: '2000000',
      fn: '500000',
      lat: '34.05',
      lon: '-118.25',
      e: '1980000',
      n: '560000',
    },
  });
  const change = (next: Partial<ZoneInput>) => setInput((current) => ({ ...current, ...next }));
  const set = (key: string) => (value: string) =>
    setInput((current) => ({ ...current, f: { ...current.f, [key]: value } }));
  const result = attempt(() => zoneOutcome(input));
  return (
    <>
      <Note>{t(`${c}.zoneNote`)}</Note>
      <Fields>
        <ZoneChoices input={input} change={change} />
        <ZoneFields input={input} set={set} />
      </Fields>
      <Problem text={result.ok ? null : errorText('coordinates', result.code)} />
      {result.ok ? (
        <>
          <Results label={t('kitHumanities.common.results')} rows={result.value.rows} />
          <Steps steps={result.value.steps} />
          <InsertBar
            payloads={{
              answer: result.value.answer,
              table: { header: header(), rows: result.value.rows },
              steps: result.value.steps,
            }}
          />
        </>
      ) : null}
    </>
  );
}

function readControls(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const parts = line
        .split(/[\s,;]+/)
        .filter(Boolean)
        .map(num);
      if (parts.length !== 4) throw new Error('number');
      const [x, y, e, n] = parts;
      return { x, y, e, n };
    });
}

export function SitePanel() {
  const [controls, setControls] = useState('0 0 500000 4000000\n100 0 500086.62 4000050\n0 100 499950 4000086.62');
  const [x, setX] = useState('50');
  const [y, setY] = useState('50');
  const result = attempt(() => {
    const points = readControls(controls);
    const fit = fitHelmert(points);
    const mapped = siteToMap(fit, num(x), num(y));
    const rows: [string, string][] = [
      [t(`${c}.siteRows.scale`), fixed(fit.scale, 8)],
      [t(`${c}.siteRows.rotation`), t(`${c}.degreesValue`, { value: fixed(fit.rotation, 5) })],
      [t(`${c}.siteRows.shift`), t(`${c}.shiftValue`, { e: fixed(fit.c, 3), n: fixed(fit.d, 3) })],
      [t(`${c}.siteRows.rms`), fixed(fit.rms, 4)],
      [t(`${c}.siteRows.mapped`), t(`${c}.shiftValue`, { e: fixed(mapped.e, 3), n: fixed(mapped.n, 3) })],
    ];
    const residuals = fit.residuals.map((r, index) => [String(index + 1), fixed(r.de, 4), fixed(r.dn, 4)]);
    const steps = [
      ht('coordinates.steps.helmert', { count: points.length }),
      ht('coordinates.steps.helmertResult', {
        a: fixed(fit.a, 8),
        b: fixed(fit.b, 8),
        scale: fixed(fit.scale, 8),
        rotation: fixed(fit.rotation, 5),
      }),
    ];
    return { rows, residuals, steps, answer: rows[4][1] };
  });
  const residualHeader = [t(`${c}.residualHeader.point`), t(`${c}.residualHeader.de`), t(`${c}.residualHeader.dn`)];
  return (
    <>
      <Field
        label={t(`${c}.controls`)}
        value={controls}
        onChange={setControls}
        rows={4}
        mono
        hint={t(`${c}.controlsHint`)}
      />
      <Fields>
        <Field label={t(`${c}.siteX`)} value={x} onChange={setX} numeric />
        <Field label={t(`${c}.siteY`)} value={y} onChange={setY} numeric />
      </Fields>
      <Problem text={result.ok ? null : errorText('coordinates', result.code)} />
      {result.ok ? (
        <>
          <Results label={t('kitHumanities.common.results')} rows={result.value.rows} />
          <DataTable caption={t(`${c}.residualCaption`)} header={residualHeader} rows={result.value.residuals} />
          <Steps steps={result.value.steps} />
          <InsertBar
            payloads={{
              answer: result.value.answer,
              table: { header: residualHeader, rows: result.value.residuals },
              steps: result.value.steps,
            }}
          />
        </>
      ) : null}
    </>
  );
}
