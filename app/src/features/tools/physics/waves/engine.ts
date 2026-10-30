// Waves and sound in closed form: waves on a string, standing waves in pipes, the Doppler effect for sound, beats,
// and intensity levels. Everything is in SI units. Pipes ignore the end correction; the Doppler effect is for motion
// along the line between source and observer in still air.
import { fail } from '../kit/read';

/** The reference intensity for sound levels, 1 pW/m² (the threshold of hearing at 1 kHz). */
export const I_REF = 1e-12;

export interface StringWave {
  speed: number;
  harmonics: { n: number; f: number; wavelength: number }[];
}

/** A string fixed at both ends: v = sqrt(T / mu), f_n = n v / (2 L), lambda_n = 2 L / n. */
export function stringWave(tension: number, density: number, length: number, count: number): StringWave {
  const speed = Math.sqrt(tension / density);
  const harmonics = Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return { n, f: (n * speed) / (2 * length), wavelength: (2 * length) / n };
  });
  return { speed, harmonics };
}

export type PipeEnds = 'open' | 'closed';

/**
 * A pipe open at both ends has every harmonic, f_n = n v / (2 L). A pipe closed at one end has only the odd ones,
 * f_n = n v / (4 L) for n = 1, 3, 5, ...
 */
export function pipeModes(length: number, speed: number, ends: PipeEnds, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const n = ends === 'open' ? i + 1 : 2 * i + 1;
    const f = ends === 'open' ? (n * speed) / (2 * length) : (n * speed) / (4 * length);
    return { n, f, wavelength: speed / f };
  });
}

/**
 * The Doppler effect for sound: f' = f (v + v_o) / (v - v_s), with v_o positive when the observer moves toward the
 * source and v_s positive when the source moves toward the observer.
 */
export function doppler(f: number, sound: number, source: number, observer: number): number {
  if (source >= sound) fail('kitPhysics.waves.errors.supersonic');
  if (-observer >= sound) fail('kitPhysics.waves.errors.outrun');
  return (f * (sound + observer)) / (sound - source);
}

/** The beat frequency is the difference of the 2 frequencies. */
export const beatFrequency = (f1: number, f2: number): number => Math.abs(f1 - f2);

/** Sound level in decibels: beta = 10 log10(I / I0). */
export const soundLevel = (intensity: number): number => 10 * Math.log10(intensity / I_REF);

/** Intensity from a level in decibels. */
export const intensityOf = (level: number): number => I_REF * 10 ** (level / 10);

/** Intensity at a distance from a point source radiating evenly in all directions: I = P / (4 pi r²). */
export const pointIntensity = (power: number, distance: number): number => power / (4 * Math.PI * distance ** 2);

/** Samples of the sum of 2 equal cosines, cos(2 pi f1 t) + cos(2 pi f2 t), over `span` seconds. */
export function beatSamples(f1: number, f2: number, span: number, count = 600): [number, number][] {
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = (span * i) / count;
    return [t, Math.cos(2 * Math.PI * f1 * t) + Math.cos(2 * Math.PI * f2 * t)];
  });
}

export interface Superposition {
  amplitude: number;
  /** The phase of the sum against the first wave, in radians. */
  phase: number;
  kind: 'constructive' | 'destructive' | 'partial';
}

/**
 * Two waves of one frequency: A1 cos(wt) + A2 cos(wt + phi) = A cos(wt + delta), with
 * A = sqrt(A1² + A2² + 2 A1 A2 cos phi) and tan delta = A2 sin phi / (A1 + A2 cos phi).
 */
export function superpose(a1: number, a2: number, phi: number): Superposition {
  const cos = Math.cos(phi);
  const amplitude = Math.sqrt(Math.max(0, a1 * a1 + a2 * a2 + 2 * a1 * a2 * cos));
  const phase = Math.atan2(a2 * Math.sin(phi), a1 + a2 * cos);
  const kind = Math.abs(cos - 1) < 1e-12 ? 'constructive' : Math.abs(cos + 1) < 1e-12 ? 'destructive' : 'partial';
  return { amplitude, phase, kind };
}
