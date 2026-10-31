// Map projections on the unit sphere, from the formulas in Snyder, Map Projections: A Working Manual (USGS
// Professional Paper 1395, 1987, a public-domain work), Šavrič, Patterson, and Jenny's Equal Earth paper (2018),
// and Robinson's table of 1974 as Snyder prints it. Each takes longitude and latitude in degrees and gives x to the
// east and y to the north, or null for a point the projection cannot show (the far side of an orthographic globe).

export type ProjectionId =
  | 'equirectangular'
  | 'mercator'
  | 'transverseMercator'
  | 'lambertConic'
  | 'albers'
  | 'azimuthalEquidistant'
  | 'orthographic'
  | 'stereographic'
  | 'mollweide'
  | 'robinson'
  | 'winkelTripel'
  | 'equalEarth';

export const PROJECTIONS: readonly ProjectionId[] = [
  'equirectangular',
  'mercator',
  'transverseMercator',
  'lambertConic',
  'albers',
  'azimuthalEquidistant',
  'orthographic',
  'stereographic',
  'mollweide',
  'robinson',
  'winkelTripel',
  'equalEarth',
];

export interface ProjectionOptions {
  /** The central meridian, degrees. */
  lon0: number;
  /** The latitude of the center for azimuthal maps, and of the origin for conics, degrees. */
  lat0: number;
  /** The standard parallels of a conic, degrees. */
  parallels: [number, number];
}

export const DEFAULTS: ProjectionOptions = { lon0: 0, lat0: 0, parallels: [29.5, 45.5] };

const RAD = Math.PI / 180;
// +180 stays +180 so the east edge of a map is not folded onto the west edge.
const wrap = (deg: number) => {
  const w = ((((deg + 180) % 360) + 360) % 360) - 180;
  return w === -180 && deg > 0 ? 180 : w;
};

/** The longitude of a point measured from the central meridian, in -180 to 180. */
export const relativeLon = (lon: number, lon0: number) => wrap(lon - lon0);

/** True for projections whose edge is a straight or curved meridian at 180° from the center. */
export const hasSeam = (id: ProjectionId) => !['orthographic', 'azimuthalEquidistant', 'stereographic'].includes(id);

const MERCATOR_LIMIT = 85;

const EE = { A1: 1.340264, A2: -0.081106, A3: 0.000893, A4: 0.003796 };

/** Robinson's table: for every 5° of latitude, the length of the parallel and its distance from the equator. */
const ROBINSON_X = [
  1, 0.9986, 0.9954, 0.99, 0.9822, 0.973, 0.96, 0.9427, 0.9216, 0.8962, 0.8679, 0.835, 0.7986, 0.7597, 0.7186, 0.6732,
  0.6213, 0.5722, 0.5322,
];
const ROBINSON_Y = [
  0, 0.062, 0.124, 0.186, 0.248, 0.31, 0.372, 0.434, 0.4958, 0.5571, 0.6176, 0.6769, 0.7346, 0.7903, 0.8435, 0.8936,
  0.9394, 0.9761, 1,
];

function robinson(lam: number, latDeg: number): [number, number] {
  const a = Math.min(Math.abs(latDeg), 90) / 5;
  const i = Math.min(Math.floor(a), 17);
  const t = a - i;
  const lerp = (table: number[]) => table[i] + (table[i + 1] - table[i]) * t;
  return [0.8487 * lerp(ROBINSON_X) * lam, 1.3523 * lerp(ROBINSON_Y) * Math.sign(latDeg)];
}

function mollweideTheta(phi: number): number {
  if (Math.abs(Math.abs(phi) - Math.PI / 2) < 1e-12) return Math.sign(phi) * (Math.PI / 2);
  let theta = phi;
  for (let k = 0; k < 50; k++) {
    const d = -(2 * theta + Math.sin(2 * theta) - Math.PI * Math.sin(phi)) / (2 + 2 * Math.cos(2 * theta));
    theta += d;
    if (Math.abs(d) < 1e-13) break;
  }
  return theta;
}

/** Projects a point; x and y are in units of the sphere's radius. */
export function project(
  id: ProjectionId,
  lonDeg: number,
  latDeg: number,
  options: ProjectionOptions = DEFAULTS,
): [number, number] | null {
  if (!Number.isFinite(lonDeg) || !Number.isFinite(latDeg) || Math.abs(latDeg) > 90) throw new Error('latLon');
  const lam = relativeLon(lonDeg, options.lon0) * RAD;
  const phi = latDeg * RAD;
  const phi0 = options.lat0 * RAD;
  switch (id) {
    case 'equirectangular':
      return [lam, phi];
    case 'mercator': {
      const p = Math.max(-MERCATOR_LIMIT, Math.min(MERCATOR_LIMIT, latDeg)) * RAD;
      return [lam, Math.log(Math.tan(Math.PI / 4 + p / 2))];
    }
    case 'transverseMercator': {
      const b = Math.cos(phi) * Math.sin(lam);
      if (Math.abs(b) > 0.999999) return null;
      return [0.5 * Math.log((1 + b) / (1 - b)), Math.atan2(Math.tan(phi), Math.cos(lam)) - phi0];
    }
    case 'lambertConic': {
      const [p1, p2] = options.parallels.map((p) => p * RAD);
      const n =
        Math.abs(p1 - p2) < 1e-10
          ? Math.sin(p1)
          : Math.log(Math.cos(p1) / Math.cos(p2)) /
            Math.log(Math.tan(Math.PI / 4 + p2 / 2) / Math.tan(Math.PI / 4 + p1 / 2));
      if (Math.abs(n) < 1e-10) throw new Error('parallels');
      const F = (Math.cos(p1) * Math.tan(Math.PI / 4 + p1 / 2) ** n) / n;
      const rho = (p: number) => {
        const c = Math.max(-89.5 * RAD, Math.min(89.5 * RAD, p));
        return F / Math.tan(Math.PI / 4 + c / 2) ** n;
      };
      const r = rho(phi);
      return [r * Math.sin(n * lam), rho(phi0) - r * Math.cos(n * lam)];
    }
    case 'albers': {
      const [p1, p2] = options.parallels.map((p) => p * RAD);
      const n = (Math.sin(p1) + Math.sin(p2)) / 2;
      if (Math.abs(n) < 1e-10) throw new Error('parallels');
      const C = Math.cos(p1) ** 2 + 2 * n * Math.sin(p1);
      const rho = (p: number) => Math.sqrt(Math.max(0, C - 2 * n * Math.sin(p))) / n;
      const r = rho(phi);
      return [r * Math.sin(n * lam), rho(phi0) - r * Math.cos(n * lam)];
    }
    case 'azimuthalEquidistant':
    case 'orthographic':
    case 'stereographic': {
      const cosc = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lam);
      const xs = Math.cos(phi) * Math.sin(lam);
      const ys = Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lam);
      if (id === 'orthographic') return cosc < 0 ? null : [xs, ys];
      if (id === 'stereographic') {
        if (cosc < -0.9) return null;
        const k = 2 / (1 + cosc);
        return [k * xs, k * ys];
      }
      const c = Math.acos(Math.max(-1, Math.min(1, cosc)));
      if (c > Math.PI - 1e-9) return null;
      const k = c < 1e-12 ? 1 : c / Math.sin(c);
      return [k * xs, k * ys];
    }
    case 'mollweide': {
      const theta = mollweideTheta(phi);
      return [(2 * Math.SQRT2 * lam * Math.cos(theta)) / Math.PI, Math.SQRT2 * Math.sin(theta)];
    }
    case 'robinson':
      return robinson(lam, latDeg);
    case 'winkelTripel': {
      const phi1 = Math.acos(2 / Math.PI);
      const alpha = Math.acos(Math.cos(phi) * Math.cos(lam / 2));
      const sinc = alpha < 1e-12 ? 1 : Math.sin(alpha) / alpha;
      const x = (lam * Math.cos(phi1) + (2 * Math.cos(phi) * Math.sin(lam / 2)) / sinc) / 2;
      const y = (phi + Math.sin(phi) / sinc) / 2;
      return [x, y];
    }
    case 'equalEarth': {
      const theta = Math.asin((Math.sqrt(3) / 2) * Math.sin(phi));
      const t2 = theta * theta;
      const t6 = t2 * t2 * t2;
      const x =
        (2 * Math.sqrt(3) * lam * Math.cos(theta)) / (3 * (EE.A1 + 3 * EE.A2 * t2 + t6 * (7 * EE.A3 + 9 * EE.A4 * t2)));
      const y = theta * (EE.A1 + EE.A2 * t2 + t6 * (EE.A3 + EE.A4 * t2));
      return [x, y];
    }
  }
}

/** The formula behind each projection, for the steps. */
export const FORMULA: Record<ProjectionId, string> = {
  equirectangular: 'x = λ, y = φ',
  mercator: 'x = λ, y = ln tan(π/4 + φ/2)',
  transverseMercator: 'B = cos φ sin λ; x = ½ ln((1 + B)/(1 − B)), y = atan2(tan φ, cos λ) − φ₀',
  lambertConic: 'n = ln(cos φ₁/cos φ₂) / ln(tan(π/4 + φ₂/2)/tan(π/4 + φ₁/2)); ρ = F / tanⁿ(π/4 + φ/2)',
  albers: 'n = (sin φ₁ + sin φ₂)/2; ρ = √(C − 2n sin φ)/n; x = ρ sin nλ, y = ρ₀ − ρ cos nλ',
  azimuthalEquidistant: 'cos c = sin φ₀ sin φ + cos φ₀ cos φ cos λ; k = c / sin c',
  orthographic: 'x = cos φ sin λ, y = cos φ₀ sin φ − sin φ₀ cos φ cos λ, shown where cos c ≥ 0',
  stereographic: 'k = 2 / (1 + cos c); x = k cos φ sin λ',
  mollweide: '2θ + sin 2θ = π sin φ; x = (2√2/π) λ cos θ, y = √2 sin θ',
  robinson: 'x = 0.8487 X(φ) λ, y = 1.3523 Y(φ), from Robinson’s table',
  winkelTripel: 'α = arccos(cos φ cos λ/2); x = ½(λ cos φ₁ + 2 cos φ sin(λ/2)/sinc α), y = ½(φ + sin φ/sinc α)',
  equalEarth:
    'sin θ = (√3/2) sin φ; x = 2√3 λ cos θ / 3(A₁ + 3A₂θ² + θ⁶(7A₃ + 9A₄θ²)); y = θ(A₁ + A₂θ² + θ⁶(A₃ + A₄θ²))',
};
