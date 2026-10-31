// Medical imaging physics: MRI (Larmor frequency, signal equations, Bloch simulation, k-space), CT (attenuation,
// Hounsfield units, windows), ultrasound, X-ray, and PET. SI units inside unless a name says otherwise. Pure: no DOM.
import { dopri45 } from '../../kits/num/ode';
import { SignalError } from '../shared/errors';
import { fft2 } from '../shared/fft';
import { fmt } from '../shared/num';
import { step, type Step } from '../shared/steps';

/** The proton gyromagnetic ratio over 2π, CODATA 2018 (NIST, public domain): 42.577 478 51 MHz/T. */
export const GAMMA_PROTON_MHZ_PER_T = 42.57747851;
const SPEED_OF_LIGHT = 299_792_458;

const positive = (value: number, field: string) => {
  if (!(value > 0) || !Number.isFinite(value)) throw new SignalError('positive', { field });
  return value;
};
const nonNegative = (value: number, field: string) => {
  if (!(value >= 0) || !Number.isFinite(value)) throw new SignalError('nonNegative', { field });
  return value;
};

export function larmor(b0: number): { mhz: number; steps: Step[] } {
  positive(b0, 'B0');
  const mhz = GAMMA_PROTON_MHZ_PER_T * b0;
  return {
    mhz,
    steps: [step('mriLarmor', `f = (γ/2π)·B0 = ${GAMMA_PROTON_MHZ_PER_T}·${fmt(b0)} = ${fmt(mhz, 8)} MHz`)],
  };
}

export interface Tissue {
  t1: number;
  t2: number;
  pd: number;
}

/** Spin echo: S = PD (1 − e^(−TR/T1)) e^(−TE/T2). Times in ms. */
export function spinEcho(tissue: Tissue, tr: number, te: number): number {
  return tissue.pd * (1 - Math.exp(-tr / tissue.t1)) * Math.exp(-te / tissue.t2);
}

/** Spoiled gradient echo: S = PD sin α (1 − E1)/(1 − cos α E1) e^(−TE/T2), with E1 = e^(−TR/T1). */
export function gradientEcho(tissue: Tissue, tr: number, te: number, flipDeg: number): number {
  const a = (flipDeg * Math.PI) / 180;
  const e1 = Math.exp(-tr / tissue.t1);
  return (tissue.pd * Math.sin(a) * (1 - e1) * Math.exp(-te / tissue.t2)) / (1 - Math.cos(a) * e1);
}

/** Inversion recovery magnitude: S = PD |1 − 2e^(−TI/T1) + e^(−TR/T1)| e^(−TE/T2). */
export function inversionRecovery(tissue: Tissue, tr: number, te: number, ti: number): number {
  return (
    tissue.pd * Math.abs(1 - 2 * Math.exp(-ti / tissue.t1) + Math.exp(-tr / tissue.t1)) * Math.exp(-te / tissue.t2)
  );
}

export type Sequence = 'spinEcho' | 'gradientEcho' | 'inversionRecovery';

export function checkTissue(tissue: Tissue): Tissue {
  positive(tissue.t1, 'T1');
  positive(tissue.t2, 'T2');
  nonNegative(tissue.pd, 'PD');
  return tissue;
}

export function mriSignal(
  sequence: Sequence,
  tissue: Tissue,
  tr: number,
  te: number,
  ti: number,
  flip: number,
): { signal: number; nullTi: number; ernst: number; steps: Step[] } {
  checkTissue(tissue);
  positive(tr, 'TR');
  nonNegative(te, 'TE');
  if (sequence === 'inversionRecovery') nonNegative(ti, 'TI');
  const signal =
    sequence === 'spinEcho'
      ? spinEcho(tissue, tr, te)
      : sequence === 'gradientEcho'
        ? gradientEcho(tissue, tr, te, flip)
        : inversionRecovery(tissue, tr, te, ti);
  const nullTi = tissue.t1 * Math.LN2;
  const ernst = (Math.acos(Math.exp(-tr / tissue.t1)) * 180) / Math.PI;
  const formula: Record<Sequence, string> = {
    spinEcho: `S = PD(1 − e^(−${fmt(tr)}/${fmt(tissue.t1)}))·e^(−${fmt(te)}/${fmt(tissue.t2)})`,
    gradientEcho: `S = PD·sin α(1 − E1)/(1 − cos α·E1)·e^(−TE/T2), E1 = ${fmt(Math.exp(-tr / tissue.t1))}`,
    inversionRecovery: `S = PD|1 − 2e^(−TI/T1) + e^(−TR/T1)|·e^(−TE/T2)`,
  };
  return {
    signal,
    nullTi,
    ernst,
    steps: [
      step(`mri_${sequence}`, `${formula[sequence]} = ${fmt(signal)}`),
      step('mriNull', `TI_null = T1·ln 2 = ${fmt(tissue.t1)}·0.693147 = ${fmt(nullTi)} ms`),
      step('mriErnst', `α_E = arccos(e^(−TR/T1)) = ${fmt(ernst, 5)}°`),
    ],
  };
}

export interface BlochPulse {
  /** When the pulse is given, in ms. */
  at: number;
  /** Flip angle in degrees, about the x axis of the rotating frame. */
  flip: number;
}

export interface BlochRun {
  t: number[];
  mx: number[];
  my: number[];
  mz: number[];
  mxy: number[];
}

/**
 * The Bloch equations in the rotating frame, for isochromats spread over `spread` hertz off resonance:
 * dMx/dt = Δω My − Mx/T2, dMy/dt = −Δω Mx − My/T2, dMz/dt = (M0 − Mz)/T1. Pulses are instant rotations about x;
 * between them the Dormand-Prince method integrates. The result is the average over the isochromats.
 */
export function bloch(
  t1: number,
  t2: number,
  pulses: readonly BlochPulse[],
  duration: number,
  spread = 0,
  count = 1,
): BlochRun {
  positive(t1, 'T1');
  positive(t2, 'T2');
  positive(duration, 'duration');
  if (t2 > t1) throw new SignalError('t2AboveT1');
  if (pulses.some((p) => !(p.at >= 0) || !Number.isFinite(p.flip))) throw new SignalError('pulse');
  const n = spread > 0 ? Math.max(1, Math.min(64, count)) : 1;
  const grid = Array.from({ length: 401 }, (_, i) => (duration * i) / 400);
  const sorted = [...pulses].filter((p) => p.at <= duration).sort((a, b) => a.at - b.at);
  const totals = {
    mx: Array<number>(grid.length).fill(0),
    my: Array<number>(grid.length).fill(0),
    mz: Array<number>(grid.length).fill(0),
  };
  for (let k = 0; k < n; k += 1) {
    const offset = n === 1 ? 0 : spread * (k / (n - 1) - 0.5);
    const dw = (2 * Math.PI * offset) / 1000; // radians per ms
    const f = (_: number, m: readonly number[]) => [
      dw * m[1]! - m[0]! / t2,
      -dw * m[0]! - m[1]! / t2,
      (1 - m[2]!) / t1,
    ];
    let m = [0, 0, 1];
    let time = 0;
    let gi = 0;
    const segments = [...sorted.map((p) => p.at), duration];
    for (let s = 0; s < segments.length; s += 1) {
      const end = segments[s]!;
      const last = s === segments.length - 1;
      // Integrate from grid point to grid point, so each sample is the solver's own value, not an interpolation. A
      // grid point that sits on a pulse belongs to the next segment, so it records the vector just after the pulse.
      while (gi < grid.length && (last ? grid[gi]! <= end + 1e-12 : grid[gi]! < end - 1e-12)) {
        const target = grid[gi]!;
        if (target > time) {
          const run = dopri45(f, [time, target], m, { rtol: 1e-10, atol: 1e-12 });
          m = run.y[run.y.length - 1]!;
          time = target;
        }
        totals.mx[gi]! += m[0]!;
        totals.my[gi]! += m[1]!;
        totals.mz[gi]! += m[2]!;
        gi += 1;
      }
      if (end > time) {
        m = dopri45(f, [time, end], m, { rtol: 1e-10, atol: 1e-12 }).y.at(-1)!;
        time = end;
      }
      const pulse = sorted[s];
      if (pulse) {
        const a = (pulse.flip * Math.PI) / 180;
        m = [m[0]!, m[1]! * Math.cos(a) + m[2]! * Math.sin(a), -m[1]! * Math.sin(a) + m[2]! * Math.cos(a)];
      }
    }
  }
  const mx = totals.mx.map((v) => v / n);
  const my = totals.my.map((v) => v / n);
  return { t: grid, mx, my, mz: totals.mz.map((v) => v / n), mxy: mx.map((v, i) => Math.hypot(v, my[i]!)) };
}

export type KMask = 'full' | 'center' | 'edges' | 'everyOther';

/**
 * A Shepp-Logan-style phantom of ellipses (the 1974 head phantom's ellipse table, a mathematical definition), its
 * k-space by the 2D FFT, a mask on k-space, and the image back by the inverse FFT.
 */
const ELLIPSES: readonly [number, number, number, number, number, number][] = [
  [1, 0.69, 0.92, 0, 0, 0],
  [-0.8, 0.6624, 0.874, 0, -0.0184, 0],
  [-0.2, 0.11, 0.31, 0.22, 0, -18],
  [-0.2, 0.16, 0.41, -0.22, 0, 18],
  [0.1, 0.21, 0.25, 0, 0.35, 0],
  [0.1, 0.046, 0.046, 0, 0.1, 0],
  [0.1, 0.046, 0.046, 0, -0.1, 0],
  [0.1, 0.046, 0.023, -0.08, -0.605, 0],
  [0.1, 0.023, 0.023, 0, -0.606, 0],
  [0.1, 0.023, 0.046, 0.06, -0.605, 0],
];

export function phantom(size: number): Float64Array {
  const image = new Float64Array(size * size);
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      const x = (2 * c) / (size - 1) - 1;
      const y = 1 - (2 * r) / (size - 1);
      let v = 0;
      for (const [a, ax, ay, x0, y0, deg] of ELLIPSES) {
        const th = (deg * Math.PI) / 180;
        const u = (x - x0) * Math.cos(th) + (y - y0) * Math.sin(th);
        const w = -(x - x0) * Math.sin(th) + (y - y0) * Math.cos(th);
        if ((u / ax) ** 2 + (w / ay) ** 2 <= 1) v += a;
      }
      image[r * size + c] = v;
    }
  }
  return image;
}

export function kSpace(
  size: number,
  mask: KMask,
  keep: number,
): {
  image: Float64Array;
  logMagnitude: Float64Array;
  rebuilt: Float64Array;
  kept: number;
} {
  if (![32, 64, 128].includes(size)) throw new SignalError('kSize');
  if (!(keep > 0 && keep <= 1)) throw new SignalError('keepShare');
  const image = phantom(size);
  const k = fft2(image, new Float64Array(size * size), size, size);
  const half = size / 2;
  const radius = (keep * size) / 2;
  let kept = 0;
  const re = new Float64Array(k.re);
  const im = new Float64Array(k.im);
  const logMagnitude = new Float64Array(size * size);
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      // Distance from the center of k-space, with the FFT's zero frequency at index 0.
      const kr = ((r + half) % size) - half;
      const kc = ((c + half) % size) - half;
      const d = Math.max(Math.abs(kr), Math.abs(kc));
      const pass =
        mask === 'full' ||
        (mask === 'center' && d <= radius) ||
        (mask === 'edges' && d > radius) ||
        (mask === 'everyOther' && kr % 2 === 0);
      const i = r * size + c;
      if (pass) kept += 1;
      else {
        re[i] = 0;
        im[i] = 0;
      }
      // Shifted so the center of k-space sits in the middle of the picture.
      const shifted = ((r + half) % size) * size + ((c + half) % size);
      logMagnitude[shifted] = Math.log10(1 + Math.hypot(re[i]!, im[i]!));
    }
  }
  const back = fft2(re, im, size, size, true);
  const rebuilt = new Float64Array(size * size);
  for (let i = 0; i < rebuilt.length; i += 1) rebuilt[i] = Math.hypot(back.re[i]!, back.im[i]!);
  return { image, logMagnitude, rebuilt, kept: kept / (size * size) };
}

/** CT numbers: HU = 1000 (μ − μ_water)/(μ_water − μ_air), and Beer-Lambert transmission e^(−μx). */
export function hounsfield(mu: number, muWater: number, muAir = 0): { hu: number; steps: Step[] } {
  nonNegative(mu, 'μ');
  positive(muWater, 'μ_water');
  if (!(muAir >= 0 && muAir < muWater)) throw new SignalError('muAir');
  const hu = (1000 * (mu - muWater)) / (muWater - muAir);
  return {
    hu,
    steps: [step('ctHu', `HU = 1000·(${fmt(mu)} − ${fmt(muWater)})/(${fmt(muWater)} − ${fmt(muAir)}) = ${fmt(hu)}`)],
  };
}

/** The gray level from 0 (black) to 1 (white) of an HU value under a window of width W centered at level L. */
export function windowLevel(hu: number, width: number, level: number): number {
  positive(width, 'W');
  return Math.min(1, Math.max(0, (hu - (level - width / 2)) / width));
}

export function beerLambert(mu: number, thickness: number): { transmitted: number; hvl: number; steps: Step[] } {
  positive(mu, 'μ');
  nonNegative(thickness, 'x');
  const transmitted = Math.exp(-mu * thickness);
  const hvl = Math.LN2 / mu;
  return {
    transmitted,
    hvl,
    steps: [
      step('xrayBeer', `I/I₀ = e^(−${fmt(mu)}·${fmt(thickness)}) = ${fmt(transmitted)}`),
      step('xrayHvl', `HVL = ln 2/μ = ${fmt(hvl)} cm`),
    ],
  };
}

export const inverseSquare = (intensity: number, d1: number, d2: number): number => {
  positive(d1, 'd₁');
  positive(d2, 'd₂');
  return intensity * (d1 / d2) ** 2;
};

/** Ultrasound: echo depth c t/2, intensity reflection ((Z2 − Z1)/(Z2 + Z1))², and round-trip attenuation. */
export function ultrasound(z1: number, z2: number, echoUs: number, speed: number, attenuation: number, mhz: number) {
  positive(z1, 'Z₁');
  positive(z2, 'Z₂');
  nonNegative(echoUs, 't');
  positive(speed, 'c');
  nonNegative(attenuation, 'α');
  nonNegative(mhz, 'f');
  const reflection = ((z2 - z1) / (z2 + z1)) ** 2;
  const depthCm = (speed * echoUs * 1e-6 * 100) / 2;
  const lossDb = 2 * attenuation * mhz * depthCm;
  return {
    reflection,
    transmission: 1 - reflection,
    depthCm,
    lossDb,
    steps: [
      step('usReflection', `R = ((${fmt(z2)} − ${fmt(z1)})/(${fmt(z2)} + ${fmt(z1)}))² = ${fmt(reflection)}`),
      step('usDepth', `d = c·t/2 = ${fmt(speed)}·${fmt(echoUs)} µs/2 = ${fmt(depthCm)} cm`),
      step('usAttenuation', `loss = 2·${fmt(attenuation)}·${fmt(mhz)}·${fmt(depthCm)} = ${fmt(lossDb)} dB`),
    ],
  };
}

/** Doppler shift f_D = 2 f0 v cos θ / c, and the velocity back from a shift. */
export function doppler(
  f0Mhz: number,
  velocity: number,
  angleDeg: number,
  speed: number,
): { shift: number; steps: Step[] } {
  positive(f0Mhz, 'f₀');
  positive(speed, 'c');
  if (!Number.isFinite(velocity) || !Number.isFinite(angleDeg)) throw new SignalError('notFinite');
  const shift = (2 * f0Mhz * 1e6 * velocity * Math.cos((angleDeg * Math.PI) / 180)) / speed;
  return {
    shift,
    steps: [
      step(
        'usDoppler',
        `f_D = 2·${fmt(f0Mhz)} MHz·${fmt(velocity)}·cos ${fmt(angleDeg)}°/${fmt(speed)} = ${fmt(shift)} Hz`,
      ),
    ],
  };
}

export const velocityFromShift = (shift: number, f0Mhz: number, angleDeg: number, speed: number): number => {
  const c = Math.cos((angleDeg * Math.PI) / 180);
  if (Math.abs(c) < 1e-9) throw new SignalError('dopplerAngle');
  return (shift * speed) / (2 * f0Mhz * 1e6 * c);
};

/** PET: SUV = C/(A/m) with 1 g/mL, decay correction A0 e^(−ln2·t/T½), and time-of-flight position c Δt/2. */
export function suv(
  concentrationKbqPerMl: number,
  doseMbq: number,
  massKg: number,
  minutes: number,
  halfLifeMin: number,
) {
  nonNegative(concentrationKbqPerMl, 'C');
  positive(doseMbq, 'A');
  positive(massKg, 'm');
  nonNegative(minutes, 't');
  positive(halfLifeMin, 'T½');
  const decayed = doseMbq * Math.exp((-Math.LN2 * minutes) / halfLifeMin);
  const value = (concentrationKbqPerMl * 1e3) / ((doseMbq * 1e6) / (massKg * 1e3));
  const corrected = (concentrationKbqPerMl * 1e3) / ((decayed * 1e6) / (massKg * 1e3));
  return {
    value,
    corrected,
    decayed,
    steps: [
      step(
        'petSuv',
        `SUV = ${fmt(concentrationKbqPerMl)} kBq/mL ÷ (${fmt(doseMbq)} MBq/${fmt(massKg)} kg) = ${fmt(value)}`,
      ),
      step('petDecay', `A(t) = ${fmt(doseMbq)}·e^(−ln 2·${fmt(minutes)}/${fmt(halfLifeMin)}) = ${fmt(decayed)} MBq`),
    ],
  };
}

export const tofPosition = (deltaPs: number): number => (SPEED_OF_LIGHT * deltaPs * 1e-12) / 2;
