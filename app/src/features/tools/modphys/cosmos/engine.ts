// Cosmology, galaxies, and telescopes at course level. The Friedmann integrals use kit-core's adaptive Gauss-Kronrod
// quadrature; the CMB temperature today is the COBE/FIRAS value; the AB zero point is 3631 Jy by definition.
import { integrate } from '../../kits/num/quad';
import { besselI0, besselI1, besselK0, besselK1 } from '../../kits/num/special';
import { auto, fixed } from '../shared/calc';
import type { Calc, Step } from '../shared/calc';
import { ASTRO, C } from '../shared/constants';
import { fail, fraction, nonNegative, positive } from '../shared/errors';
import { fmt, tex } from '../shared/format';
import type { Series } from '../shared/plot';

export type CosmosKey =
  | 'hz'
  | 'age'
  | 'ageAtZ'
  | 'lookback'
  | 'comoving'
  | 'transverse'
  | 'luminosityDistance'
  | 'angularDistance'
  | 'volume'
  | 'angularSize'
  | 'omegaK'
  | 'tcmb'
  | 'hubbleDistance'
  | 'beta'
  | 'velocity'
  | 'cz'
  | 'lawDistance'
  | 'distancePlot'
  | 'redshift'
  | 'distanceMpc'
  | 'rotationPlot'
  | 'radiusKpc'
  | 'speedKms'
  | 'vTotal'
  | 'vPoint'
  | 'vDisk'
  | 'vIso'
  | 'vNfw'
  | 'focalRatio'
  | 'plateScale'
  | 'pixelScale'
  | 'fieldWidth'
  | 'fieldHeight'
  | 'rayleigh'
  | 'dawes'
  | 'sampling'
  | 'minPower'
  | 'maxPower'
  | 'magnification'
  | 'snr'
  | 'signal'
  | 'noise'
  | 'signalAdu'
  | 'timeForSnr'
  | 'fnu'
  | 'photonFlux'
  | 'electronRate';

export const COSMOS_SOURCES = [
  'Fixsen (2009), ApJ 707, 916: CMB temperature today, 2.7255 K.',
  'Oke and Gunn (1983), ApJ 266, 713: the AB magnitude zero point, 3631 Jy.',
  'Hogg (1999), arXiv:astro-ph/9905116: distance measures in cosmology.',
] as const;

/** The CMB temperature today in kelvin (Fixsen 2009). */
export const T_CMB = 2.7255;
/** The AB magnitude zero point in janskys. */
export const AB_JY = 3631;
const MPC = 1e6 * ASTRO.pc;
const GYR = 1e9 * ASTRO.year;
const KPC = 1e3 * ASTRO.pc;
const ARCSEC = 648000 / Math.PI;
const QUAD = { rtol: 1e-11, atol: 1e-14 };

export interface Cosmology {
  /** The Hubble constant in km/s/Mpc. */
  h0: number;
  om: number;
  or: number;
  ol: number;
}

const curvature = (cos: Cosmology) => 1 - cos.om - cos.or - cos.ol;

function check(cos: Cosmology) {
  positive(cos.h0, 'hubble');
  if (cos.h0 > 1e4) need0();
  nonNegative(cos.om, 'omegaM');
  nonNegative(cos.or, 'omegaR');
  if (!Number.isFinite(cos.ol)) fail('badCosmology');
}
const need0 = (): never => fail('badCosmology');

/** E(z)² = Ωm(1+z)³ + Ωr(1+z)⁴ + Ωk(1+z)² + ΩΛ. */
export function e2(cos: Cosmology, z: number): number {
  const x = 1 + z;
  return cos.om * x ** 3 + cos.or * x ** 4 + curvature(cos) * x ** 2 + cos.ol;
}

/** H² must stay above zero for every scale factor from the big bang to now, or that universe bounced. */
function expanding(cos: Cosmology) {
  for (let i = 1; i <= 2000; i += 1) {
    const a = i / 2000;
    if (!(e2(cos, 1 / a - 1) > 0)) fail('badCosmology');
  }
}

/** The Hubble time 1/H0 in seconds and the Hubble distance c/H0 in Mpc. */
const hubbleTime = (h0: number) => MPC / (h0 * 1e3);
const hubbleDistance = (h0: number) => C.c / 1e3 / h0;

/** (1/H0) ∫₀^a da / (a E(a)): the age at scale factor a, in Gyr. */
function ageAt(cos: Cosmology, a: number): number {
  const ok = curvature(cos);
  const f = (x: number) => (x <= 0 ? 0 : 1 / Math.sqrt(cos.om / x + cos.or / x ** 2 + ok + cos.ol * x ** 2));
  return (integrate(f, 0, a, QUAD).value * hubbleTime(cos.h0)) / GYR;
}

/** The line-of-sight comoving distance D_C = (c/H0) ∫₀^z dz / E(z), in Mpc. */
export function comovingDistance(cos: Cosmology, z: number): number {
  if (z === 0) return 0;
  return integrate((x) => 1 / Math.sqrt(e2(cos, x)), 0, z, QUAD).value * hubbleDistance(cos.h0);
}

/** The transverse comoving distance D_M, with the curvature correction. */
function transverse(cos: Cosmology, dc: number): number {
  const ok = curvature(cos);
  const dh = hubbleDistance(cos.h0);
  if (Math.abs(ok) < 1e-12) return dc;
  const s = Math.sqrt(Math.abs(ok));
  return ok > 0 ? (dh / s) * Math.sinh((s * dc) / dh) : (dh / s) * Math.sin((s * dc) / dh);
}

/** The comoving volume out to D_M (Hogg 1999, eq. 29), in Mpc³. */
export function comovingVolume(cos: Cosmology, dm: number): number {
  const ok = curvature(cos);
  const dh = hubbleDistance(cos.h0);
  if (Math.abs(ok) < 1e-8) return ((4 * Math.PI) / 3) * dm ** 3;
  const s = Math.sqrt(Math.abs(ok));
  const r = dm / dh;
  const arc = ok > 0 ? Math.asinh(s * r) : Math.asin(s * r);
  return ((4 * Math.PI * dh ** 3) / (2 * ok)) * (r * Math.sqrt(1 + ok * r * r) - arc / s);
}

/** Distances and ages to redshift z, with the angular size of a length (kpc) when one is given. */
export function cosmology(cos: Cosmology, z: number, sizeKpc?: number): Calc<CosmosKey> {
  check(cos);
  nonNegative(z, 'redshift');
  if (z > 1e4) fail('badCosmology');
  expanding(cos);
  const ok = curvature(cos);
  const ez = Math.sqrt(e2(cos, z));
  const age = ageAt(cos, 1);
  const ageZ = ageAt(cos, 1 / (1 + z));
  const dc = comovingDistance(cos, z);
  const dm = transverse(cos, dc);
  const dl = (1 + z) * dm;
  const da = dm / (1 + z);
  const dh = hubbleDistance(cos.h0);
  const items = [
    fixed<CosmosKey>('age', age, 'Gyr', 6),
    fixed<CosmosKey>('lookback', age - ageZ, 'Gyr', 6),
    fixed<CosmosKey>('ageAtZ', ageZ, 'Gyr', 6),
    fixed<CosmosKey>('comoving', dc, 'Mpc', 6),
    fixed<CosmosKey>('transverse', dm, 'Mpc', 6),
    fixed<CosmosKey>('luminosityDistance', dl, 'Mpc', 6),
    fixed<CosmosKey>('angularDistance', da, 'Mpc', 6),
    fixed<CosmosKey>('volume', comovingVolume(cos, dm) / 1e9, 'Gpc³', 5),
    fixed<CosmosKey>('hz', cos.h0 * ez, 'km/s/Mpc', 6),
    fixed<CosmosKey>('omegaK', ok, '', 4),
    fixed<CosmosKey>('tcmb', T_CMB * (1 + z), 'K', 5),
  ];
  if (sizeKpc !== undefined && z > 0) {
    positive(sizeKpc, 'size');
    items.push(fixed('angularSize', (sizeKpc / 1e3 / da) * ARCSEC, '″', 5));
  }
  const steps: Step<CosmosKey>[] = [
    {
      key: 'hz',
      text: `E(z) = √(Ωm(1+z)³ + Ωr(1+z)⁴ + Ωk(1+z)² + ΩΛ) = ${fmt(ez)}, with Ωk = 1 − Ωm − Ωr − ΩΛ = ${fmt(ok, 4)}`,
      tex: `E(z) = \\sqrt{\\Omega_m(1+z)^3 + \\Omega_r(1+z)^4 + \\Omega_k(1+z)^2 + \\Omega_\\Lambda} = ${tex(ez)}`,
    },
    {
      key: 'comoving',
      text: `D_C = (c/H₀) ∫₀^z dz/E(z) = ${fmt(dh)} Mpc × ${fmt(dc / dh)} = ${fmt(dc, 6)} Mpc`,
      tex: `D_C = \\frac{c}{H_0}\\int_0^z \\frac{dz'}{E(z')} = ${tex(dh)} \\times ${tex(dc / dh)} = ${tex(dc, 6)}\\ \\mathrm{Mpc}`,
    },
    {
      key: 'luminosityDistance',
      text: `D_L = (1 + z) D_M = ${fmt(1 + z)} × ${fmt(dm, 6)} Mpc = ${fmt(dl, 6)} Mpc; D_A = D_M/(1 + z) = ${fmt(da, 6)} Mpc`,
      tex: `D_L = (1+z) D_M = ${tex(dl, 6)}\\ \\mathrm{Mpc}`,
    },
    {
      key: 'age',
      text:
        `t(z) = (1/H₀) ∫_z^∞ dz/((1+z)E(z)) with 1/H₀ = ${fmt(hubbleTime(cos.h0) / GYR)} Gyr: ` +
        `t₀ = ${fmt(age, 6)} Gyr, t(z) = ${fmt(ageZ, 6)} Gyr, lookback = ${fmt(age - ageZ, 6)} Gyr`,
      tex: `t(z) = \\frac{1}{H_0}\\int_z^\\infty \\frac{dz'}{(1+z')E(z')},\\quad t_0 = ${tex(age, 6)}\\ \\mathrm{Gyr}`,
    },
  ];
  const top = Math.max(z, 0.1);
  const dms: [number, number][] = [];
  const dls: [number, number][] = [];
  const das: [number, number][] = [];
  for (let i = 1; i <= 60; i += 1) {
    const zi = (top * i) / 60;
    const m = transverse(cos, comovingDistance(cos, zi));
    dms.push([zi, m]);
    dls.push([zi, m * (1 + zi)]);
    das.push([zi, m / (1 + zi)]);
  }
  const series: Series[] = [
    { points: dms, kind: 'line', tone: 0, label: 'D_M' },
    { points: dls, kind: 'dash', tone: 1, label: 'D_L' },
    { points: das, kind: 'dots', tone: 2, label: 'D_A' },
  ];
  return { items, steps, plot: { title: 'distancePlot', xLabel: 'redshift', yLabel: 'distanceMpc', series } };
}

/** The relativistic Doppler velocity for redshift z and the Hubble-law distance cz/H0. */
export function hubbleLaw(z: number, h0: number): Calc<CosmosKey> {
  nonNegative(z, 'redshift');
  positive(h0, 'hubble');
  const x = (1 + z) ** 2;
  const beta = (x - 1) / (x + 1);
  const cz = (C.c / 1e3) * z;
  return {
    items: [
      fixed('beta', beta, 'c', 6),
      fixed('velocity', (beta * C.c) / 1e3, 'km/s', 6),
      fixed('cz', cz, 'km/s', 6),
      fixed('lawDistance', cz / h0, 'Mpc', 6),
      fixed('hubbleDistance', hubbleDistance(h0), 'Mpc', 6),
      fixed('tcmb', T_CMB * (1 + z), 'K', 5),
    ],
    steps: [
      {
        key: 'beta',
        text: `v/c = ((1+z)² − 1)/((1+z)² + 1) = (${fmt(x)} − 1)/(${fmt(x)} + 1) = ${fmt(beta, 6)}`,
        tex: `\\frac{v}{c} = \\frac{(1+z)^2 - 1}{(1+z)^2 + 1} = ${tex(beta, 6)}`,
      },
      {
        key: 'lawDistance',
        text: `d ≈ cz/H₀ = ${fmt(cz)} km/s / ${fmt(h0)} km/s/Mpc = ${fmt(cz / h0)} Mpc (for z ≪ 1)`,
        tex: `d \\approx \\frac{cz}{H_0} = ${tex(cz / h0)}\\ \\mathrm{Mpc}`,
      },
    ],
  };
}

export interface Galaxy {
  /** The radius to evaluate, in m. */
  r: number;
  /** A central point mass (bulge or black hole), kg. */
  point: number;
  /** The exponential disk's mass (kg) and scale length (m); a zero mass leaves it out. */
  disk: number;
  diskScale: number;
  /** A pseudo-isothermal halo: central density (kg/m³) and core radius (m). */
  isoRho: number;
  isoCore: number;
  /** An NFW halo: characteristic density (kg/m³) and scale radius (m). */
  nfwRho: number;
  nfwScale: number;
}

const vPoint = (m: number, r: number) => (m === 0 ? 0 : Math.sqrt((C.G * m) / r));

/** The thin exponential disk (Freeman 1970): v² = 4πGΣ₀R_d y²(I₀K₀ − I₁K₁), y = R/(2R_d). */
export function vDisk(m: number, rd: number, r: number): number {
  if (m === 0) return 0;
  const y = r / (2 * rd);
  if (y > 100) return vPoint(m, r);
  const sigma0 = m / (2 * Math.PI * rd * rd);
  const bracket = besselI0(y) * besselK0(y) - besselI1(y) * besselK1(y);
  return Math.sqrt(Math.max(0, 4 * Math.PI * C.G * sigma0 * rd * y * y * bracket));
}

/** The pseudo-isothermal sphere: v² = 4πGρ₀r_c²(1 − (r_c/r) atan(r/r_c)). */
export const vIso = (rho: number, rc: number, r: number): number =>
  rho === 0 ? 0 : Math.sqrt(4 * Math.PI * C.G * rho * rc * rc * (1 - (rc / r) * Math.atan(r / rc)));

/** The NFW halo: M(r) = 4πρ_s r_s³ (ln(1 + x) − x/(1 + x)), x = r/r_s. */
export function vNfw(rho: number, rs: number, r: number): number {
  if (rho === 0) return 0;
  const x = r / rs;
  return vPoint(4 * Math.PI * rho * rs ** 3 * (Math.log1p(x) - x / (1 + x)), r);
}

/** A rotation curve from its components, added in quadrature, drawn out to twice the radius. */
export function rotation(g: Galaxy): Calc<CosmosKey> {
  positive(g.r, 'radius');
  nonNegative(g.point, 'pointMass');
  nonNegative(g.disk, 'diskMass');
  nonNegative(g.isoRho, 'density');
  nonNegative(g.nfwRho, 'density');
  if (g.disk > 0) positive(g.diskScale, 'scaleLength');
  if (g.isoRho > 0) positive(g.isoCore, 'coreRadius');
  if (g.nfwRho > 0) positive(g.nfwScale, 'scaleRadius');
  if (g.point + g.disk + g.isoRho + g.nfwRho === 0) fail('noComponent');
  const km = (v: number) => v / 1e3;
  const parts = (r: number) => {
    const p = vPoint(g.point, r);
    const d = vDisk(g.disk, g.diskScale, r);
    const i = vIso(g.isoRho, g.isoCore, r);
    const n = vNfw(g.nfwRho, g.nfwScale, r);
    return [Math.hypot(p, d, i, n), p, d, i, n].map(km) as [number, number, number, number, number];
  };
  const at = parts(g.r);
  const curves: [number, number][][] = [[], [], [], [], []];
  for (let k = 1; k <= 80; k += 1) {
    const r = (2 * g.r * k) / 80;
    parts(r).forEach((v, j) => curves[j]!.push([r / KPC, v]));
  }
  const series: Series[] = [{ points: curves[0]!, kind: 'line', tone: 0, label: 'total' }];
  if (g.point > 0) series.push({ points: curves[1]!, kind: 'dash', tone: 1, label: 'point' });
  if (g.disk > 0) series.push({ points: curves[2]!, kind: 'dash', tone: 2, label: 'disk' });
  if (g.isoRho > 0) series.push({ points: curves[3]!, kind: 'dots', tone: 3, label: 'isothermal' });
  if (g.nfwRho > 0) series.push({ points: curves[4]!, kind: 'dots', tone: 3, label: 'NFW' });
  const [total, p, d, i, n] = at;
  return {
    items: [
      fixed('vTotal', total, 'km/s', 5),
      fixed('vPoint', p, 'km/s', 5),
      fixed('vDisk', d, 'km/s', 5),
      fixed('vIso', i, 'km/s', 5),
      fixed('vNfw', n, 'km/s', 5),
    ],
    steps: [
      {
        key: 'vTotal',
        text:
          `v² = v_point² + v_disk² + v_iso² + v_NFW² = ${fmt(p)}² + ${fmt(d)}² + ${fmt(i)}² + ${fmt(n)}² (km/s)², ` +
          `so v = ${fmt(total)} km/s at R = ${fmt(g.r / KPC)} kpc`,
        tex: `v = \\sqrt{v_\\mathrm{pt}^2 + v_\\mathrm{disk}^2 + v_\\mathrm{iso}^2 + v_\\mathrm{NFW}^2} = ${tex(total)}\\ \\mathrm{km/s}`,
      },
      {
        key: 'vDisk',
        text: `thin disk: v² = 4πGΣ₀R_d y²(I₀K₀ − I₁K₁), y = R/(2R_d) = ${fmt(g.disk > 0 ? g.r / (2 * g.diskScale) : 0)}`,
        tex: `v_\\mathrm{disk}^2 = 4\\pi G\\Sigma_0 R_d\\,y^2\\,[I_0K_0 - I_1K_1]_{y = R/2R_d}`,
      },
    ],
    plot: { title: 'rotationPlot', xLabel: 'radiusKpc', yLabel: 'speedKms', series },
  };
}

export interface Telescope {
  /** Aperture and focal length, m. */
  d: number;
  f: number;
  /** Pixel size, m, and the sensor's width and height in pixels. */
  pixel: number;
  nx: number;
  ny: number;
  /** Wavelength, m. */
  lambda: number;
  /** Seeing FWHM, rad. */
  seeing: number;
  /** An eyepiece's focal length, m; 0 leaves it out. */
  eyepiece: number;
}

/** Focal ratio, plate and pixel scale, field of view, diffraction limits, sampling, and useful magnifications. */
export function telescope(s: Telescope): Calc<CosmosKey> {
  positive(s.d, 'aperture');
  positive(s.f, 'focalLength');
  positive(s.pixel, 'pixel');
  positive(s.nx, 'pixels');
  positive(s.ny, 'pixels');
  positive(s.lambda, 'wavelength');
  positive(s.seeing, 'seeing');
  nonNegative(s.eyepiece, 'eyepiece');
  const scale = ARCSEC / (s.f * 1e3);
  const pix = scale * s.pixel * 1e3;
  const rayleigh = 1.22 * (s.lambda / s.d) * ARCSEC;
  const dawes = 0.116 / s.d;
  const sampling = (s.seeing * ARCSEC) / pix;
  const items = [
    fixed<CosmosKey>('plateScale', scale, '″/mm', 6),
    fixed<CosmosKey>('focalRatio', s.f / s.d, '', 4),
    fixed<CosmosKey>('pixelScale', pix, '″/pixel', 5),
    fixed<CosmosKey>('fieldWidth', (pix * s.nx) / 60, '′', 5),
    fixed<CosmosKey>('fieldHeight', (pix * s.ny) / 60, '′', 5),
    fixed<CosmosKey>('rayleigh', rayleigh, '″', 5),
    fixed<CosmosKey>('dawes', dawes, '″', 5),
    fixed<CosmosKey>('sampling', sampling, 'pixels', 4),
    fixed<CosmosKey>('minPower', (s.d * 1e3) / 7, '×', 3),
    fixed<CosmosKey>('maxPower', 2 * s.d * 1e3, '×', 3),
  ];
  if (s.eyepiece > 0) items.push(fixed('magnification', s.f / s.eyepiece, '×', 4));
  return {
    items,
    steps: [
      {
        key: 'plateScale',
        text: `plate scale = 206265″ / f = 206265″ / ${fmt(s.f * 1e3)} mm = ${fmt(scale, 6)}″/mm`,
        tex: `s = \\frac{206265''}{f} = ${tex(scale, 6)}\\ ''/\\mathrm{mm}`,
      },
      {
        key: 'pixelScale',
        text: `pixel scale = ${fmt(scale, 6)}″/mm × ${fmt(s.pixel * 1e3)} mm = ${fmt(pix)}″/pixel`,
      },
      {
        key: 'rayleigh',
        text:
          `θ = 1.22 λ/D = 1.22 × ${fmt(s.lambda * 1e9)} nm / ${fmt(s.d)} m = ${fmt(rayleigh)}″; ` +
          `Dawes 116″/D(mm) = ${fmt(dawes)}″`,
        tex: `\\theta = 1.22\\frac{\\lambda}{D} = ${tex(rayleigh)}''`,
      },
      {
        key: 'sampling',
        text: `seeing / pixel scale = ${fmt(s.seeing * ARCSEC)}″ / ${fmt(pix)}″ = ${fmt(sampling, 4)} pixels across a star`,
      },
    ],
  };
}

export interface Ccd {
  /** Source, sky (per pixel), and dark (per pixel) rates in electrons per second. */
  source: number;
  sky: number;
  dark: number;
  /** Read noise in electrons, exposure in seconds, pixels in the aperture. */
  read: number;
  time: number;
  npix: number;
  /** Electrons per ADU. */
  gain: number;
  /** The signal-to-noise to reach. */
  target: number;
}

/** The CCD equation, SNR = S t / √(S t + n_pix (B t + D t + R²)), and the time to reach a target SNR. */
export function ccd(c: Ccd): Calc<CosmosKey> {
  positive(c.source, 'sourceRate');
  nonNegative(c.sky, 'skyRate');
  nonNegative(c.dark, 'darkRate');
  nonNegative(c.read, 'readNoise');
  positive(c.time, 'exposure');
  positive(c.npix, 'pixels');
  positive(c.gain, 'gain');
  positive(c.target, 'snr');
  const signal = c.source * c.time;
  const noise = Math.sqrt(signal + c.npix * ((c.sky + c.dark) * c.time + c.read ** 2));
  const snr = signal / noise;
  // S² t² − SNR² (S + n(B + D)) t − SNR² n R² = 0, the positive root.
  const a = c.source ** 2;
  const b = -(c.target ** 2) * (c.source + c.npix * (c.sky + c.dark));
  const k = -(c.target ** 2) * c.npix * c.read ** 2;
  const t = (-b + Math.sqrt(b * b - 4 * a * k)) / (2 * a);
  return {
    items: [
      fixed('snr', snr, '', 6),
      fixed('signal', signal, 'e⁻', 6),
      fixed('noise', noise, 'e⁻', 6),
      fixed('signalAdu', signal / c.gain, 'ADU', 6),
      auto('timeForSnr', t, 's', 5),
    ],
    steps: [
      {
        key: 'snr',
        text:
          `SNR = S t / √(S t + n(B t + D t + R²)) = ${fmt(signal)} / √(${fmt(signal)} + ${fmt(c.npix)} × ` +
          `(${fmt(c.sky * c.time)} + ${fmt(c.dark * c.time)} + ${fmt(c.read ** 2)})) = ${fmt(snr, 6)}`,
        tex: `\\mathrm{SNR} = \\frac{S t}{\\sqrt{S t + n_\\mathrm{pix}(B t + D t + R^2)}} = ${tex(snr, 6)}`,
      },
      {
        key: 'timeForSnr',
        text: `S² t² − SNR²(S + n(B + D)) t − SNR² n R² = 0 with SNR = ${fmt(c.target)} gives t = ${fmt(t)} s`,
      },
    ],
  };
}

/**
 * Photons from a magnitude: f_ν = F₀ 10^(−0.4 m) (F₀ = 3631 Jy for AB), N = f_ν Δλ / (h λ) per m² per second, and
 * electrons per second through an aperture with a central obstruction and a throughput.
 */
export function photons(
  m: number,
  zeroJy: number,
  lambda: number,
  band: number,
  d: number,
  obstruction: number,
  throughput: number,
): Calc<CosmosKey> {
  if (!Number.isFinite(m) || Math.abs(m) > 100) fail('badMagnitude');
  positive(zeroJy, 'zeroPoint');
  positive(lambda, 'wavelength');
  positive(band, 'bandwidth');
  positive(d, 'aperture');
  fraction(obstruction, 'obstruction');
  fraction(throughput, 'throughput');
  const fnu = zeroJy * 1e-26 * 10 ** (-0.4 * m);
  const n = (fnu * band) / (C.h * lambda);
  const area = Math.PI * (d / 2) ** 2 * (1 - obstruction ** 2);
  const rate = n * area * throughput;
  return {
    items: [
      fixed('electronRate', rate, 'e⁻/s', 5),
      fixed('fnu', fnu / 1e-26, 'Jy', 5),
      fixed('photonFlux', n, 'photons/(s m²)', 5),
    ],
    steps: [
      {
        key: 'fnu',
        text: `f_ν = ${fmt(zeroJy)} Jy × 10^(−0.4 × ${fmt(m)}) = ${fmt(fnu / 1e-26)} Jy`,
        tex: `f_\\nu = F_0\\,10^{-0.4m} = ${tex(fnu / 1e-26)}\\ \\mathrm{Jy}`,
      },
      {
        key: 'photonFlux',
        text: `N = f_ν Δλ / (h λ) = ${fmt(fnu)} × ${fmt(band)} / (${fmt(C.h)} × ${fmt(lambda)}) = ${fmt(n)} photons/(s m²)`,
        tex: `N = \\frac{f_\\nu\\,\\Delta\\lambda}{h\\lambda} = ${tex(n)}`,
      },
      {
        key: 'electronRate',
        text: `rate = N × π(D/2)²(1 − ε²) × η = ${fmt(n)} × ${fmt(area)} m² × ${fmt(throughput)} = ${fmt(rate)} e⁻/s`,
      },
    ],
  };
}
