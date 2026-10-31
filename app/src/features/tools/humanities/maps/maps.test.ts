import { describe, expect, it } from 'vitest';
import { haversine, inverse } from '../geo/ellipsoid';
import { drawMap } from './draw';
import {
  classBreaks,
  cutAtSeam,
  greatCircle,
  jenks,
  parseGeoJson,
  parsePoints,
  sphericalArea,
  toGeoJson,
} from './geometry';
import { DEFAULTS, PROJECTIONS, project } from './projections';

describe('projections', () => {
  it('put latitude 60 at y 1.3169579 on Mercator', () => {
    // ln tan(45° + 30°) = ln(2 + √3) = 1.31695790
    expect(project('mercator', 0, 60)?.[1]).toBeCloseTo(1.3169579, 7);
  });

  it('put (180, 0) at x 2.70663 and (0, 90) at y 1.31736 on Equal Earth', () => {
    const edge = project('equalEarth', 180, 0) as [number, number];
    expect(edge[0]).toBeCloseTo(2.70663, 5);
    expect(edge[1]).toBeCloseTo(0, 12);
    const pole = project('equalEarth', 0, 90) as [number, number];
    expect(pole[0]).toBeCloseTo(0, 12);
    expect(pole[1]).toBeCloseTo(1.31736, 5);
  });

  it('give known values for the others', () => {
    // Mollweide's pole is at y = √2; its equator ends at x = 2√2.
    expect(project('mollweide', 0, 90)?.[1]).toBeCloseTo(Math.SQRT2, 9);
    expect(project('mollweide', 180, 0)?.[0]).toBeCloseTo(2 * Math.SQRT2, 9);
    // Robinson's equator at 180° is 0.8487 π, and its pole is at 1.3523.
    expect(project('robinson', 180, 0)?.[0]).toBeCloseTo(0.8487 * Math.PI, 9);
    expect(project('robinson', 0, 90)?.[1]).toBeCloseTo(1.3523, 9);
    // The far side of an orthographic globe is hidden; azimuthal equidistant keeps distance from the center.
    expect(project('orthographic', 120, 0)).toBeNull();
    expect(project('azimuthalEquidistant', 0, 90)?.[1]).toBeCloseTo(Math.PI / 2, 9);
    expect(project('stereographic', 90, 0)?.[0]).toBeCloseTo(2, 9);
    expect(project('winkelTripel', 0, 0)).toEqual([0, 0]);
    expect(() => project('mercator', 0, 95)).toThrow('latLon');
    for (const id of PROJECTIONS) expect(() => project(id, 10, 20, { ...DEFAULTS, lat0: 10 })).not.toThrow();
  });
});

describe('measures and classes', () => {
  it('measure JFK to LHR as 5554.909 km at 51.3816°, and 5540.02 km by haversine', () => {
    const g = inverse(40.6413, -73.7781, 51.47, -0.4543);
    expect(g.distance / 1000).toBeCloseTo(5554.909, 2);
    expect(g.azimuth1).toBeCloseTo(51.3816, 3);
    expect(haversine(40.6413, -73.7781, 51.47, -0.4543) / 1000).toBeCloseTo(5540.02, 1);
  });

  it('split 1, 2, 3, 10, 11, 12 into {1, 2, 3} and {10, 11, 12}', () => {
    expect(jenks([10, 2, 12, 1, 11, 3], 2)).toEqual([
      [1, 2, 3],
      [10, 11, 12],
    ]);
    expect(classBreaks([1, 2, 3, 10, 11, 12], 2, 'jenks')).toEqual([3, 12]);
    expect(classBreaks([0, 10], 2, 'equal')).toEqual([5, 10]);
    expect(classBreaks([1, 2, 3, 4], 2, 'quantile')).toEqual([2, 4]);
    expect(() => classBreaks([], 2, 'equal')).toThrow('noValues');
    expect(() => classBreaks([1], 9, 'equal')).toThrow('classes');
  });

  it('give a hemisphere half the sphere’s area', () => {
    const ring: [number, number][] = [
      [0, 0],
      [90, 0],
      [180, 0],
      [-90, 0],
    ];
    const r = 6371007.2;
    expect(sphericalArea(ring, r)).toBeCloseTo(2 * Math.PI * r * r, -3);
  });
});

describe('lines', () => {
  it('cut a line from 170° E to 170° W into 2 pieces that meet the edge', () => {
    const pieces = cutAtSeam(
      [
        [170, 0],
        [-170, 0],
      ],
      0,
    );
    expect(pieces).toHaveLength(2);
    expect(pieces[0][1][0]).toBeCloseTo(180, 6);
    expect(pieces[1][0][0]).toBeCloseTo(-180, 6);
    expect(pieces[0][1][1]).toBeCloseTo(0, 9);
  });

  it('follow a great circle over the pole between points 180° apart in longitude', () => {
    const path = greatCircle([0, 60], [180, 60]);
    expect(Math.max(...path.map((p) => p[1]))).toBeCloseTo(90, 6);
  });
});

describe('layers', () => {
  it('read GeoJSON and typed points, and write GeoJSON back', () => {
    const features = parseGeoJson(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { name: 'A', pop: 5 }, geometry: { type: 'Point', coordinates: [1, 2] } },
          {
            type: 'Feature',
            properties: { name: 'B', pop: 9 },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [0, 0],
                  [10, 0],
                  [10, 10],
                  [0, 0],
                ],
              ],
            },
          },
        ],
      }),
      'pop',
    );
    expect(features.map((f) => [f.kind, f.name, f.value])).toEqual([
      ['point', 'A', 5],
      ['polygon', 'B', 9],
    ]);
    expect(JSON.parse(toGeoJson(features)).features[1].geometry.type).toBe('Polygon');
    expect(parsePoints('Rome, 41.9, 12.5, 2800')[0].parts[0][0]).toEqual([12.5, 41.9]);
    expect(() => parseGeoJson('{')).toThrow('geojson');
    expect(() => parsePoints('Rome, 95, 12')).toThrow('latLon');
  });
});

describe('TopoJSON', () => {
  it('decode arcs forward, backward, and quantized', () => {
    // Plain arcs: (0,0)→(5,0) and (5,0)→(5,5). Arcs [0, 1] join at (5,0) once; ~1 runs the second arc backward.
    const plain = parseGeoJson(
      JSON.stringify({
        type: 'Topology',
        arcs: [
          [
            [0, 0],
            [5, 0],
          ],
          [
            [5, 0],
            [5, 5],
          ],
        ],
        objects: {
          roads: {
            type: 'GeometryCollection',
            geometries: [
              { type: 'LineString', arcs: [0, 1], properties: { name: 'Joined' } },
              { type: 'LineString', arcs: [-2], id: 'X' },
            ],
          },
        },
      }),
    );
    expect(plain.map((f) => f.parts[0])).toEqual([
      [
        [0, 0],
        [5, 0],
        [5, 5],
      ],
      [
        [5, 5],
        [5, 0],
      ],
    ]);
    expect(plain[0].name).toBe('Joined');
    expect(plain[1].properties.id).toBe('X');
    // Quantized: deltas (0,0), (2,0), (0,3) sum to (0,0), (2,0), (2,3); scale (0.5, 2) and shift (100, −50) give
    // (100,−50), (101,−50), (101,−44). A point is not delta-encoded: (4,1) → (102, −48).
    const quantized = parseGeoJson(
      JSON.stringify({
        type: 'Topology',
        transform: { scale: [0.5, 2], translate: [100, -50] },
        arcs: [
          [
            [0, 0],
            [2, 0],
            [0, 3],
          ],
        ],
        objects: {
          a: { type: 'Polygon', arcs: [[0]] },
          b: { type: 'Point', coordinates: [4, 1] },
        },
      }),
    );
    expect(quantized[0].parts).toEqual([
      [
        [100, -50],
        [101, -50],
        [101, -44],
      ],
    ]);
    expect(quantized[1].parts[0][0]).toEqual([102, -48]);
    expect(() =>
      parseGeoJson('{"type":"Topology","arcs":[],"objects":{"a":{"type":"LineString","arcs":[3]}}}'),
    ).toThrow('geojsonCoordinates');
  });
});

describe('drawing', () => {
  it('draw a map with a choropleth legend and a scale bar', () => {
    const features = [
      ...parseGeoJson('{"type":"Polygon","coordinates":[[[0,0],[20,0],[20,20],[0,0]]]}').map((f) => ({
        ...f,
        value: 1,
      })),
      ...parseGeoJson('{"type":"Polygon","coordinates":[[[30,0],[50,0],[50,20],[30,0]]]}').map((f) => ({
        ...f,
        value: 9,
      })),
    ];
    const map = drawMap({
      projection: 'equalEarth',
      options: DEFAULTS,
      title: 'Test',
      features,
      graticule: true,
      tissot: true,
      classes: 2,
      method: 'jenks',
      scaleLat: 0,
      labels: { legend: 'Classes', scale: (km) => `${km} km`, north: 'N' },
    });
    expect(map.breaks).toEqual([1, 9]);
    expect(map.unitsPerKm).toBeGreaterThan(0);
    expect(map.svg).toContain('<svg');
  });
});
