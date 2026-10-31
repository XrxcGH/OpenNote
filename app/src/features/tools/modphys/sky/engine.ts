// Sky positions and sun paths. It covers time systems, coordinate conversions, sun-path diagrams, shadows, and the
// times of rising and setting with twilight. It also places the Sun and the Moon. Inputs are a local date and time
// with a zone offset (hours east of Greenwich) and a site's latitude and longitude (east positive). Universal time
// stands in for terrestrial time.
import { fixed } from '../shared/calc';
import type { Calc, Item, Step } from '../shared/calc';
import { fail, need, positive } from '../shared/errors';
import { fmt } from '../shared/format';
import type { Series } from '../shared/plot';
import {
  J2000,
  acosd,
  airmass,
  calendar,
  cosd,
  equatorialToEcliptic,
  equatorialToGalactic,
  gmst,
  horizontal,
  hourAngleAt,
  julianDate,
  moon,
  precess,
  sind,
  sun,
  tand,
  wrap,
} from './astro';
import type { Equatorial } from './astro';

export type SkyKey =
  | 'jd'
  | 'mjd'
  | 'days'
  | 'gmst'
  | 'lst'
  | 'eot'
  | 'ut'
  | 'ra'
  | 'dec'
  | 'alt'
  | 'az'
  | 'hourAngle'
  | 'distanceAu'
  | 'distanceEarth'
  | 'lambda'
  | 'beta'
  | 'galL'
  | 'galB'
  | 'raDate'
  | 'decDate'
  | 'airmass'
  | 'phase'
  | 'elongation'
  | 'sunAngles'
  | 'rise'
  | 'transit'
  | 'set'
  | 'dayLength'
  | 'transitAlt'
  | 'civil'
  | 'nautical'
  | 'astronomical'
  | 'altPlot'
  | 'timeAxis'
  | 'altAxis'
  | 'pathPlot'
  | 'azAxis'
  | 'eastAxis'
  | 'northAxis'
  | 'noonJune'
  | 'noonEquinox'
  | 'noonDecember'
  | 'profile'
  | 'shadow'
  | 'overhang'
  | 'sunAlt';

export const SKY_SOURCES = [
  'US Naval Observatory, approximate solar coordinates and sidereal time (public domain).',
  'Astronomical Almanac low-precision lunar formulas.',
  'Lieske et al. (1977) IAU 1976 precession angles; Hipparcos J2000 galactic pole.',
] as const;

export interface Site {
  /** Local date as [year, month, day], local time in hours, and the zone offset in hours. */
  date: readonly [number, number, number];
  time: number;
  zone: number;
  lat: number;
  lon: number;
}

function checkSite(s: Site) {
  if (!Number.isFinite(s.lat) || Math.abs(s.lat) > 90) need('tooLarge', 'latitude');
  if (!Number.isFinite(s.lon) || Math.abs(s.lon) > 180) need('tooLarge', 'longitude');
  if (!Number.isFinite(s.zone) || Math.abs(s.zone) > 14) need('tooLarge', 'zone');
}

export const jdOf = (s: Site) => julianDate(s.date[0], s.date[1], s.date[2], s.time - s.zone);

/** Hours as h:mm:ss. */
export function hms(hours: number): string {
  const total = Math.round(wrap(hours, 24) * 3600) % 86400;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

/** Degrees as ±d° mm′ ss″. */
export function dms(deg: number): string {
  const sign = deg < 0 ? '−' : '+';
  const total = Math.round(Math.abs(deg) * 3600);
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  return `${sign}${Math.floor(total / 3600)}° ${minutes}′ ${String(total % 60).padStart(2, '0')}″`;
}

const clock = (hours: number) => {
  const total = Math.round(wrap(hours, 24) * 60) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** Julian Date, MJD, sidereal times, and the equation of time. */
export function timeCalc(s: Site): Calc<SkyKey> {
  checkSite(s);
  const jd = jdOf(s);
  const g = gmst(jd);
  const lst = wrap(g + s.lon / 15, 24);
  const eot = sun(jd).eot;
  return {
    items: [
      // A JD is read as a seven-digit day count with a decimal day, never with a power of ten.
      { key: 'jd', value: jd, unit: '', text: jd.toFixed(5) },
      fixed('mjd', jd - 2400000.5, '', 11),
      { key: 'ut', value: wrap(s.time - s.zone, 24), unit: 'h', text: hms(s.time - s.zone) },
      { key: 'gmst', value: g, unit: 'h', text: `${fmt(g, 10)} h = ${hms(g)}` },
      { key: 'lst', value: lst, unit: 'h', text: `${fmt(lst, 8)} h = ${hms(lst)}` },
      fixed('eot', eot, 'min', 4),
      fixed('days', jd - J2000, 'd', 10),
    ],
    steps: [
      {
        key: 'jd',
        text: `JD = JD(0h) + UT/24 with UT = local time − zone = ${fmt(wrap(s.time - s.zone, 24), 8)} h: JD = ${jd.toFixed(5)}`,
      },
      {
        key: 'gmst',
        text: `GMST = 18.697374558 + 24.06570982441908 D (mod 24), D = JD − 2451545.0 = ${fmt(jd - J2000, 10)}: ${fmt(g, 10)} h`,
        tex: `\\mathrm{GMST} = 18.697374558 + 24.06570982441908\\,D`,
      },
      { key: 'lst', text: `LST = GMST + longitude/15 = ${fmt(g, 8)} + ${fmt(s.lon / 15, 6)} = ${fmt(lst, 8)} h` },
    ],
  };
}

const position = (eq: Equatorial, s: Site, jd: number) => {
  const ha = wrap(gmst(jd) + s.lon / 15 - eq.ra + 12, 24) - 12;
  return { ha, ...horizontal(ha, eq.dec, s.lat) };
};

/** The Sun's coordinates, distance, and place in the sky. */
export function sunCalc(s: Site): Calc<SkyKey> {
  checkSite(s);
  const jd = jdOf(s);
  const p = sun(jd);
  const h = position(p, s, jd);
  return {
    items: [
      { key: 'alt', value: h.alt, unit: '°', fixed: true, sig: 6 },
      { key: 'az', value: h.az, unit: '°', fixed: true, sig: 6 },
      { key: 'ra', value: p.ra, unit: 'h', text: `${fmt(p.ra, 7)} h = ${hms(p.ra)}` },
      { key: 'dec', value: p.dec, unit: '°', text: `${fmt(p.dec, 7)}° = ${dms(p.dec)}` },
      fixed('hourAngle', h.ha, 'h', 6),
      fixed('distanceAu', p.distance, 'au', 6),
      fixed('eot', p.eot, 'min', 4),
      fixed('airmass', airmass(h.alt), '', 5),
    ],
    steps: [
      {
        key: 'sunAngles',
        text:
          `D = ${fmt(jd - J2000, 9)}; g = 357.529 + 0.98560028 D = ${fmt(p.g, 7)}°, q = 280.459 + 0.98564736 D = ${fmt(p.q, 7)}°; ` +
          `L = q + 1.915 sin g + 0.020 sin 2g = ${fmt(p.lambda, 7)}°, ε = 23.439 − 3.6e-7 D = ${fmt(p.epsilon, 7)}°`,
      },
      {
        key: 'ra',
        text: `RA = atan2(cos ε sin L, cos L) = ${fmt(p.ra, 7)} h; Dec = asin(sin ε sin L) = ${fmt(p.dec, 7)}°`,
        tex: `\\alpha = \\operatorname{atan2}(\\cos\\varepsilon\\sin L, \\cos L),\\quad \\delta = \\arcsin(\\sin\\varepsilon\\sin L)`,
      },
      {
        key: 'alt',
        text: `sin h = sin φ sin δ + cos φ cos δ cos H with H = ${fmt(h.ha, 6)} h: h = ${fmt(h.alt, 6)}°`,
        tex: `\\sin h = \\sin\\varphi\\sin\\delta + \\cos\\varphi\\cos\\delta\\cos H`,
      },
    ],
  };
}

/** The Moon's coordinates, distance, place in the sky, and illuminated fraction. */
export function moonCalc(s: Site): Calc<SkyKey> {
  checkSite(s);
  const jd = jdOf(s);
  const m = moon(jd);
  const sp = sun(jd);
  const h = position(m, s, jd);
  const elong = acosd(cosd(m.beta) * cosd(m.lambda - sp.lambda));
  const illuminated = (1 - cosd(elong)) / 2;
  return {
    items: [
      { key: 'alt', value: h.alt, unit: '°', fixed: true, sig: 4 },
      { key: 'az', value: h.az, unit: '°', fixed: true, sig: 4 },
      { key: 'ra', value: m.ra, unit: 'h', text: `${fmt(m.ra, 5)} h = ${hms(m.ra)}` },
      { key: 'dec', value: m.dec, unit: '°', text: `${fmt(m.dec, 5)}°` },
      fixed('lambda', m.lambda, '°', 5),
      fixed('beta', m.beta, '°', 4),
      fixed('distanceEarth', m.distance, 'R⊕', 5),
      fixed('elongation', elong, '°', 4),
      fixed('phase', illuminated, '', 3),
    ],
    steps: [
      {
        key: 'lambda',
        text:
          `T = (JD − 2451545)/36525 = ${fmt((jd - J2000) / 36525, 8)}; ` +
          `λ = 218.32 + 481267.881 T + 6.29 sin(135.0 + 477198.87 T) + … = ${fmt(m.lambda, 5)}°`,
      },
      {
        key: 'phase',
        text: `illuminated fraction k = (1 − cos ψ)/2 with elongation ψ = ${fmt(elong, 4)}°: k = ${fmt(illuminated, 3)}`,
        tex: `k = \\frac{1 - \\cos\\psi}{2}`,
      },
    ],
  };
}

/** An object's J2000 coordinates converted to the date, the horizon, the ecliptic, and the galaxy. */
export function convertCalc(eq: Equatorial, s: Site): Calc<SkyKey> {
  checkSite(s);
  if (!(eq.ra >= 0 && eq.ra < 24)) need('tooLarge', 'rightAscension');
  if (!(Math.abs(eq.dec) <= 90)) need('tooLarge', 'declination');
  const jd = jdOf(s);
  const now = precess(eq, jd);
  const h = position(now, s, jd);
  const ecl = equatorialToEcliptic(eq, 23.4392911);
  const gal = equatorialToGalactic(eq);
  return {
    items: [
      { key: 'alt', value: h.alt, unit: '°', fixed: true, sig: 6 },
      { key: 'az', value: h.az, unit: '°', fixed: true, sig: 6 },
      fixed('hourAngle', h.ha, 'h', 6),
      fixed('airmass', airmass(h.alt), '', 5),
      { key: 'raDate', value: now.ra, unit: 'h', text: `${fmt(now.ra, 7)} h = ${hms(now.ra)}` },
      { key: 'decDate', value: now.dec, unit: '°', text: `${fmt(now.dec, 7)}° = ${dms(now.dec)}` },
      fixed('lambda', ecl.lambda, '°', 7),
      fixed('beta', ecl.beta, '°', 7),
      fixed('galL', gal.l, '°', 7),
      fixed('galB', gal.b, '°', 7),
    ],
    steps: [
      {
        key: 'raDate',
        text: `IAU 1976 precession to the date: ζ = ${fmt(now.zeta, 6)}°, z = ${fmt(now.z, 6)}°, θ = ${fmt(now.theta, 6)}°`,
      },
      {
        key: 'alt',
        text:
          `H = LST − α = ${fmt(h.ha, 6)} h; sin h = sin φ sin δ + cos φ cos δ cos H gives ` +
          `h = ${fmt(h.alt, 6)}°, azimuth ${fmt(h.az, 6)}°`,
        tex: `\\sin h = \\sin\\varphi\\sin\\delta + \\cos\\varphi\\cos\\delta\\cos H`,
      },
      { key: 'airmass', text: `airmass = sec z = 1 / sin h = ${fmt(airmass(h.alt), 5)} (plane-parallel)` },
    ],
  };
}

/** The day length (hours) for a declination at a latitude, for a horizon altitude h0. */
export function dayLength(lat: number, dec: number, h0: number): number {
  const ha = hourAngleAt(dec, lat, h0);
  if (ha === Infinity) return 24;
  if (ha === -Infinity) return 0;
  return 2 * ha;
}

/** The local clock time (hours) when the Sun's hour angle is `ha` on the site's date, refined for its motion. */
function sunEvent(s: Site, target: (dec: number) => number): number {
  let local = 12;
  for (let k = 0; k < 4; k += 1) {
    const jd = julianDate(s.date[0], s.date[1], s.date[2], local - s.zone);
    const p = sun(jd);
    const ha = target(p.dec);
    if (!Number.isFinite(ha)) return ha;
    // Local time of hour angle ha: transit is at 12 h − equation of time − longitude/15 + zone.
    local = 12 - p.eot / 60 - s.lon / 15 + s.zone + ha;
  }
  return local;
}

/** Rise, transit, and set of the Sun or of a fixed object, with twilight for the Sun and an altitude chart. */
export function riseSet(s: Site, object: Equatorial | null): Calc<SkyKey> {
  checkSite(s);
  const items: Item<SkyKey>[] = [];
  const steps: Step<SkyKey>[] = [];
  const at = (key: SkyKey, hours: number) => {
    if (hours === Infinity || hours === -Infinity || Number.isNaN(hours)) return;
    items.push({ key, value: hours, unit: 'h', text: clock(hours) });
  };
  if (object === null) {
    const event = (h0: number, sign: number) =>
      sunEvent(s, (dec) => {
        const ha = hourAngleAt(dec, s.lat, h0);
        return Number.isFinite(ha) ? sign * ha : ha;
      });
    const rise = event(-0.833, -1);
    const set = event(-0.833, 1);
    const transit = sunEvent(s, () => 0);
    const decNoon = sun(julianDate(s.date[0], s.date[1], s.date[2], transit - s.zone)).dec;
    if (rise === Infinity) fail('neverSets');
    if (rise === -Infinity) fail('neverRises');
    at('rise', rise);
    at('transit', transit);
    at('set', set);
    items.push(fixed('dayLength', set - rise, 'h', 6));
    items.push(fixed('transitAlt', 90 - Math.abs(s.lat - decNoon), '°', 5));
    for (const [key, h0] of [
      ['civil', -6],
      ['nautical', -12],
      ['astronomical', -18],
    ] as const) {
      const a = event(h0, -1);
      const b = event(h0, 1);
      if (Number.isFinite(a) && Number.isFinite(b))
        items.push({ key, value: a, unit: 'h', text: `${clock(a)} – ${clock(b)}` });
    }
    steps.push({
      key: 'rise',
      text: `cos H₀ = (sin h₀ − sin φ sin δ)/(cos φ cos δ) with h₀ = −0.833°; rise and set at transit ∓ H₀, refined for the Sun's motion`,
      tex: `\\cos H_0 = \\frac{\\sin h_0 - \\sin\\varphi\\sin\\delta}{\\cos\\varphi\\cos\\delta}`,
    });
  } else {
    const jd0 = julianDate(s.date[0], s.date[1], s.date[2], 12 - s.zone);
    const eq = precess(object, jd0);
    const ha = hourAngleAt(eq.dec, s.lat, -0.5667);
    if (ha === Infinity) fail('neverSets');
    if (ha === -Infinity) fail('neverRises');
    // Local time of transit: when LST = α. Sidereal hours run 1.0027379 times faster than solar.
    const lstNoon = wrap(gmst(jd0) + s.lon / 15, 24);
    const transit = 12 + (wrap(eq.ra - lstNoon + 12, 24) - 12) / 1.0027379;
    at('rise', transit - ha / 1.0027379);
    at('transit', transit);
    at('set', transit + ha / 1.0027379);
    items.push(fixed('transitAlt', 90 - Math.abs(s.lat - eq.dec), '°', 5));
    steps.push({
      key: 'rise',
      text: `cos H₀ = (sin h₀ − sin φ sin δ)/(cos φ cos δ) with h₀ = −0.567° (refraction): H₀ = ${fmt(ha, 6)} h sidereal`,
      tex: `\\cos H_0 = \\frac{\\sin h_0 - \\sin\\varphi\\sin\\delta}{\\cos\\varphi\\cos\\delta}`,
    });
  }
  const curve: [number, number][] = [];
  for (let k = 0; k <= 96; k += 1) {
    const local = k / 4;
    const jd = julianDate(s.date[0], s.date[1], s.date[2], local - s.zone);
    const eq = object === null ? sun(jd) : precess(object, jd);
    curve.push([local, position(eq, s, jd).alt]);
  }
  const series: Series[] = [
    { points: curve, kind: 'line', tone: 0 },
    {
      points: [
        [0, 0],
        [24, 0],
      ],
      kind: 'dash',
      tone: 2,
      label: 'horizon',
    },
  ];
  return { items, steps, plot: { title: 'altPlot', xLabel: 'timeAxis', yLabel: 'altAxis', series, x: [0, 24] } };
}

/** The Sun's path on the solstices and equinox at a latitude, cylindrical or stereographic, with noon altitudes. */
export function sunPath(lat: number, stereographic: boolean): Calc<SkyKey> {
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) need('tooLarge', 'latitude');
  const decs: [number, string][] = [
    [23.44, 'June'],
    [0, 'equinox'],
    [-23.44, 'December'],
  ];
  const project = (alt: number, az: number): [number, number] => {
    if (!stereographic) return [az, alt];
    const r = tand((90 - alt) / 2);
    return [r * sind(az), r * cosd(az)];
  };
  const series: Series[] = decs.map(([dec, name], k) => {
    const points: [number, number][] = [];
    for (let i = 0; i <= 288; i += 1) {
      const h = horizontal(-12 + i / 12, dec, lat);
      if (h.alt >= 0) points.push(project(h.alt, h.az));
    }
    return { points, kind: k === 1 ? 'dash' : 'line', tone: k, label: name };
  });
  const hours: [number, number][] = [];
  for (let hour = -6; hour <= 6; hour += 1)
    for (const dec of [23.44, 0, -23.44]) {
      const h = horizontal(hour, dec, lat);
      if (h.alt >= 0) hours.push(project(h.alt, h.az));
    }
  series.push({ points: hours, kind: 'dots', tone: 3, label: 'hours' });
  if (stereographic) {
    for (const ring of [0, 30, 60]) {
      const r = tand((90 - ring) / 2);
      series.push({
        points: Array.from({ length: 73 }, (_, i) => [r * sind(i * 5), r * cosd(i * 5)] as [number, number]),
        kind: 'dash',
        tone: 2,
        label: `${ring}°`,
      });
    }
  }
  const noon = (dec: number) => 90 - Math.abs(lat - dec);
  return {
    items: [
      fixed('noonJune', noon(23.44), '°', 5),
      fixed('noonEquinox', noon(0), '°', 5),
      fixed('noonDecember', noon(-23.44), '°', 5),
    ],
    steps: [
      {
        key: 'noonJune',
        text:
          `noon altitude = 90° − |φ − δ|: ${fmt(noon(23.44), 5)}° (δ = 23.44°), ${fmt(noon(0), 5)}° (δ = 0), ` +
          `${fmt(noon(-23.44), 5)}° (δ = −23.44°)`,
      },
      {
        key: 'alt',
        text: 'Each path is sin h = sin φ sin δ + cos φ cos δ cos H for H from −12 h to 12 h; dots mark whole hours.',
      },
    ],
    plot: stereographic
      ? { title: 'pathPlot', xLabel: 'eastAxis', yLabel: 'northAxis', series, x: [-1.05, 1.05], y: [-1.05, 1.05] }
      : { title: 'pathPlot', xLabel: 'azAxis', yLabel: 'altAxis', series, x: [0, 360], y: [0, 90] },
  };
}

/** A pole's shadow and the overhang depth that shades a window, from the Sun's altitude and azimuth. */
export function shadow(alt: number, az: number, height: number, wallAzimuth: number, window: number): Calc<SkyKey> {
  if (!(alt > 0 && alt <= 90)) fail('sunDown');
  positive(height, 'height');
  positive(window, 'windowHeight');
  const off = wallAzimuth - az;
  const items: Item<SkyKey>[] = [
    fixed('sunAlt', alt, '°', 5),
    { key: 'shadow', value: height / tand(alt), unit: 'm', sig: 5 },
  ];
  const steps: Step<SkyKey>[] = [
    {
      key: 'shadow',
      text: `shadow = height / tan h = ${fmt(height)} m / tan ${fmt(alt, 5)}° = ${fmt(height / tand(alt), 5)} m`,
    },
  ];
  if (Math.abs(wrap(off + 180) - 180) < 90) {
    const profile = Math.atan(tand(alt) / cosd(off)) * (180 / Math.PI);
    items.push(fixed('profile', profile, '°', 5));
    items.push({ key: 'overhang', value: window / tand(profile), unit: 'm', sig: 5 });
    steps.push({
      key: 'overhang',
      text:
        `profile angle: tan p = tan h / cos(wall azimuth − sun azimuth) = ${fmt(profile, 5)}°; ` +
        `depth = window height / tan p = ${fmt(window / tand(profile), 5)} m`,
      tex: `\\tan p = \\frac{\\tan h}{\\cos(\\gamma_w - \\gamma_s)},\\quad d = \\frac{H}{\\tan p}`,
    });
  } else steps.push({ key: 'overhang', text: 'The Sun is behind the wall, so the window is already in shade.' });
  return { items, steps };
}

export { calendar };
