// The map maker: a projection, the student's own layers (typed points with values, routes, and GeoJSON polygons
// as a choropleth), a graticule, Tissot indicatrices, a legend, a scale bar, and a north arrow; plus geodesic
// measures and a single point worked through a projection's formula.
import { useMemo, useState } from 'react';
import { t } from '../../../../strings/t';
import { GeoError, haversine, inverse } from '../geo/ellipsoid';
import { takeInputs } from '../open';
import { attempt, errorText, fixed, num } from '../ui/attempt';
import {
  Check,
  Choice,
  Field,
  Fields,
  InsertBar,
  Note,
  Picture,
  Problem,
  Results,
  Steps,
  Tabs,
  Tool,
  ht,
} from '../ui/parts';
import { drawMap } from './draw';
import { greatCircle, parseGeoJson, parsePoints, sphericalArea, toGeoJson } from './geometry';
import type { ClassMethod, Feature, Position } from './geometry';
import { FORMULA, PROJECTIONS, project } from './projections';
import type { ProjectionId } from './projections';

const k = 'kitHumanities.maps';
const fail = (code: string) => <Problem text={errorText('maps', code)} />;

export interface MapInputs {
  projection: ProjectionId;
  lon0: string;
  lat0: string;
  parallel1: string;
  parallel2: string;
  title: string;
  points: string;
  routes: string;
  great: boolean;
  geojson: string;
  field: string;
  classes: string;
  method: ClassMethod;
  graticule: boolean;
  tissot: boolean;
  scaleLat: string;
}

const START: MapInputs = {
  projection: 'equalEarth',
  lon0: '0',
  lat0: '0',
  parallel1: '29.5',
  parallel2: '45.5',
  title: '',
  points: 'Rome, 41.9, 12.5, 2800\nAlexandria, 31.2, 29.9, 5200\nChang’an, 34.3, 108.9, 7000',
  routes: 'Rome > Alexandria\nAlexandria > Chang’an',
  great: true,
  geojson: '',
  field: '',
  classes: '5',
  method: 'jenks',
  graticule: true,
  tissot: false,
  scaleLat: '0',
};

function startingMap(): MapInputs {
  const saved = takeInputs('maps') as Partial<MapInputs> | null;
  return saved && typeof saved === 'object' ? { ...START, ...saved } : { ...START, title: ht('maps.exampleTitle') };
}

/** Routes typed as "From > To", by name from the points list, or as lat, lon > lat, lon. */
function parseRoutes(text: string, points: readonly Feature[], great: boolean): Feature[] {
  const where = (part: string): Position => {
    const named = points.find((p) => p.name.toLowerCase() === part.trim().toLowerCase());
    if (named) return named.parts[0][0];
    const [lat, lon] = part.split(',').map((x) => num(x));
    if (lat === undefined || lon === undefined || Math.abs(lat) > 90) throw new Error('route');
    return [lon, lat];
  };
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [a, b] = line.split('>');
      if (!a || !b) throw new Error('route');
      const from = where(a);
      const to = where(b);
      return {
        kind: 'line',
        parts: [great ? greatCircle(from, to) : [from, to]],
        name: line,
        value: null,
        properties: {},
      };
    });
}

function ProjectionFields({ inputs, set }: { inputs: MapInputs; set(next: Partial<MapInputs>): void }) {
  const conic = inputs.projection === 'lambertConic' || inputs.projection === 'albers';
  const centered = ['azimuthalEquidistant', 'orthographic', 'stereographic', 'transverseMercator'].includes(
    inputs.projection,
  );
  return (
    <>
      <Fields>
        <Choice<ProjectionId>
          label={t(`${k}.projection`)}
          value={inputs.projection}
          options={PROJECTIONS.map((value) => ({ value, label: ht(`maps.projections.${value}`) }))}
          onChange={(projection) => set({ projection })}
        />
        <Field label={t(`${k}.lon0`)} value={inputs.lon0} onChange={(lon0) => set({ lon0 })} numeric />
        {centered || conic ? (
          <Field label={t(`${k}.lat0`)} value={inputs.lat0} onChange={(lat0) => set({ lat0 })} numeric />
        ) : null}
        {conic ? (
          <>
            <Field
              label={t(`${k}.parallel1`)}
              value={inputs.parallel1}
              onChange={(parallel1) => set({ parallel1 })}
              numeric
            />
            <Field
              label={t(`${k}.parallel2`)}
              value={inputs.parallel2}
              onChange={(parallel2) => set({ parallel2 })}
              numeric
            />
          </>
        ) : null}
        <Field label={t(`${k}.mapTitle`)} value={inputs.title} onChange={(title) => set({ title })} />
      </Fields>
    </>
  );
}

function LayerFields({ inputs, set }: { inputs: MapInputs; set(next: Partial<MapInputs>): void }) {
  return (
    <>
      <Field
        label={t(`${k}.points`)}
        value={inputs.points}
        onChange={(points) => set({ points })}
        rows={4}
        hint={t(`${k}.pointsHint`)}
      />
      <Field
        label={t(`${k}.routes`)}
        value={inputs.routes}
        onChange={(routes) => set({ routes })}
        rows={2}
        hint={t(`${k}.routesHint`)}
      />
      <Check label={t(`${k}.great`)} checked={inputs.great} onChange={(great) => set({ great })} />
      <Field
        label={t(`${k}.geojson`)}
        value={inputs.geojson}
        onChange={(geojson) => set({ geojson })}
        rows={4}
        mono
        hint={t(`${k}.geojsonHint`)}
      />
    </>
  );
}

function StyleFields({ inputs, set }: { inputs: MapInputs; set(next: Partial<MapInputs>): void }) {
  return (
    <>
      <Fields>
        <Field label={t(`${k}.field`)} value={inputs.field} onChange={(field) => set({ field })} />
        <Choice<ClassMethod>
          label={t(`${k}.method`)}
          value={inputs.method}
          options={(['equal', 'quantile', 'jenks'] as const).map((value) => ({
            value,
            label: ht(`maps.methods.${value}`),
          }))}
          onChange={(method) => set({ method })}
        />
        <Field label={t(`${k}.classes`)} value={inputs.classes} onChange={(classes) => set({ classes })} numeric />
        <Field label={t(`${k}.scaleLat`)} value={inputs.scaleLat} onChange={(scaleLat) => set({ scaleLat })} numeric />
      </Fields>
      <Check label={t(`${k}.graticule`)} checked={inputs.graticule} onChange={(graticule) => set({ graticule })} />
      <Check label={t(`${k}.tissot`)} checked={inputs.tissot} onChange={(tissot) => set({ tissot })} />
    </>
  );
}

/** Reads the layers and draws the map; throws a code from the strings when an input is wrong. */
function buildMap(inputs: MapInputs) {
  const points = parsePoints(inputs.points);
  const features = [
    ...parseGeoJson(inputs.geojson, inputs.field.trim()),
    ...parseRoutes(inputs.routes, points, inputs.great),
    ...points,
  ];
  const map = drawMap({
    projection: inputs.projection,
    options: {
      lon0: num(inputs.lon0),
      lat0: num(inputs.lat0),
      parallels: [num(inputs.parallel1), num(inputs.parallel2)],
    },
    title: inputs.title,
    features,
    graticule: inputs.graticule,
    tissot: inputs.tissot,
    classes: Math.round(num(inputs.classes)),
    method: inputs.method,
    scaleLat: num(inputs.scaleLat),
    labels: {
      legend: t(`${k}.legend`, { field: inputs.field || t(`${k}.value`) }),
      scale: (km) => t(`${k}.scaleBar`, { km, lat: inputs.scaleLat }),
      north: t(`${k}.north`),
    },
  });
  return { map, features };
}

function MapPanel({ inputs, set }: { inputs: MapInputs; set(next: Partial<MapInputs>): void }) {
  const result = useMemo(() => attempt(() => buildMap(inputs)), [inputs]);
  return (
    <>
      <ProjectionFields inputs={inputs} set={set} />
      <LayerFields inputs={inputs} set={set} />
      <StyleFields inputs={inputs} set={set} />
      {result.ok ? <MapResult inputs={inputs} {...result.value} /> : fail(result.code)}
    </>
  );
}

function MapResult({
  inputs,
  map,
  features,
}: { inputs: MapInputs } & { map: ReturnType<typeof drawMap>; features: Feature[] }) {
  const alt = t(`${k}.alt`, {
    projection: ht(`maps.projections.${inputs.projection}`),
    count: features.length,
    title: inputs.title || t(`${k}.untitled`),
  });
  const steps = [
    t(`${k}.formulaStep`, { formula: FORMULA[inputs.projection] }),
    ...(map.breaks
      ? [
          t(`${k}.classStep`, {
            method: ht(`maps.methods.${inputs.method}`),
            breaks: map.breaks.map((b) => fixed(b, 2)).join(', '),
          }),
        ]
      : []),
    map.unitsPerKm ? t(`${k}.scaleStep`, { lat: inputs.scaleLat }) : t(`${k}.noScale`),
    ...(inputs.tissot ? [t(`${k}.tissotStep`)] : []),
  ];
  const geojson = toGeoJson(features);
  return (
    <>
      <Picture svg={map.svg} alt={alt} />
      <Steps steps={steps} />
      <Note>{t(`${k}.seamNote`)}</Note>
      <InsertBar
        payloads={{
          steps,
          picture: { svg: map.svg, name: 'map', alt },
          figure: { tool: 'maps', inputs, svg: map.svg, alt, summary: inputs.title || alt },
        }}
      />
      <details>
        <summary>{t(`${k}.export`)}</summary>
        <Field label={t(`${k}.exportField`)} value={geojson} onChange={() => undefined} rows={6} mono />
      </details>
    </>
  );
}

function MeasurePanel() {
  const [from, setFrom] = useState('40.6413, -73.7781');
  const [to, setTo] = useState('51.47, -0.4543');
  const [ring, setRing] = useState('');
  const pair = (text: string): [number, number] => {
    const [lat, lon] = text.split(',').map((x) => num(x));
    if (lat === undefined || lon === undefined || Math.abs(lat) > 90) throw new Error('latLon');
    return [lat, lon];
  };
  const distance = attempt(() => {
    const [a1, o1] = pair(from);
    const [a2, o2] = pair(to);
    // Vincenty's iteration does not converge for nearly antipodal points; give the spherical answer there.
    let g: ReturnType<typeof inverse> | null = null;
    try {
      g = inverse(a1, o1, a2, o2);
    } catch (error) {
      if (!(error instanceof GeoError && error.code === 'antipodal')) throw error;
    }
    return { g, h: haversine(a1, o1, a2, o2) };
  });
  const area = attempt(() => {
    if (ring.trim() === '') return null;
    const positions = ring
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l): Position => {
        const [lat, lon] = pair(l);
        return [lon, lat];
      });
    return sphericalArea(positions);
  });
  return (
    <>
      <Fields>
        <Field label={t(`${k}.from`)} value={from} onChange={setFrom} hint={t(`${k}.latLonHint`)} />
        <Field label={t(`${k}.to`)} value={to} onChange={setTo} />
      </Fields>
      {distance.ok ? (
        <>
          <Results
            label={t('kitHumanities.common.results')}
            rows={
              distance.value.g
                ? [
                    [t(`${k}.geodesic`), `${fixed(distance.value.g.distance / 1000, 3)} km`],
                    [t(`${k}.azimuth`), `${fixed(distance.value.g.azimuth1, 4)}°`],
                    [t(`${k}.haversine`), `${fixed(distance.value.h / 1000, 2)} km`],
                  ]
                : [[t(`${k}.haversine`), `${fixed(distance.value.h / 1000, 2)} km`]]
            }
          />
          {distance.value.g ? null : <Note>{t(`${k}.antipodalNote`)}</Note>}
          <Steps steps={[t(`${k}.geodesicStep`), t(`${k}.haversineStep`)]} />
          <InsertBar
            payloads={{
              answer: distance.value.g
                ? `${fixed(distance.value.g.distance / 1000, 3)} km`
                : `${fixed(distance.value.h / 1000, 2)} km`,
            }}
          />
        </>
      ) : (
        fail(distance.code)
      )}
      <Field label={t(`${k}.ring`)} value={ring} onChange={setRing} rows={4} hint={t(`${k}.ringHint`)} />
      {area.ok ? (
        area.value === null ? null : (
          <>
            <Results
              label={t('kitHumanities.common.results')}
              rows={[[t(`${k}.area`), `${fixed(area.value / 1e6, 1)} km²`]]}
            />
            <Note>{t(`${k}.areaNote`)}</Note>
          </>
        )
      ) : (
        fail(area.code)
      )}
    </>
  );
}

function PointPanel() {
  const [projection, setProjection] = useState<ProjectionId>('mercator');
  const [lat, setLat] = useState('60');
  const [lon, setLon] = useState('0');
  const result = attempt(() => project(projection, num(lon), num(lat)));
  return (
    <>
      <Fields>
        <Choice<ProjectionId>
          label={t(`${k}.projection`)}
          value={projection}
          options={PROJECTIONS.map((value) => ({ value, label: ht(`maps.projections.${value}`) }))}
          onChange={setProjection}
        />
        <Field label={t(`${k}.lat`)} value={lat} onChange={setLat} numeric />
        <Field label={t(`${k}.lon`)} value={lon} onChange={setLon} numeric />
      </Fields>
      {result.ok ? (
        result.value === null ? (
          <Note>{t(`${k}.hidden`)}</Note>
        ) : (
          <>
            <Results
              label={t('kitHumanities.common.results')}
              rows={[
                ['x', fixed(result.value[0], 7)],
                ['y', fixed(result.value[1], 7)],
              ]}
            />
            <Steps steps={[t(`${k}.formulaStep`, { formula: FORMULA[projection] }), t(`${k}.unitSphere`)]} />
            <InsertBar payloads={{ answer: `(${fixed(result.value[0], 7)}, ${fixed(result.value[1], 7)})` }} />
          </>
        )
      ) : (
        fail(result.code)
      )}
    </>
  );
}

type Tab = 'map' | 'measure' | 'point';

export function MapsTool() {
  const [tab, setTab] = useState<Tab>('map');
  const [inputs, setInputs] = useState(startingMap);
  return (
    <Tool label={t(`${k}.title`)}>
      <Tabs<Tab>
        label={t(`${k}.modes`)}
        items={(['map', 'measure', 'point'] as const).map((id) => ({ id, label: ht(`maps.tabs.${id}`) }))}
        value={tab}
        onChange={setTab}
      />
      {tab === 'map' ? (
        <MapPanel inputs={inputs} set={(next) => setInputs((before) => ({ ...before, ...next }))} />
      ) : null}
      {tab === 'measure' ? <MeasurePanel /> : null}
      {tab === 'point' ? <PointPanel /> : null}
    </Tool>
  );
}
