// The arithmetic of cameras, film timing, animation, and lighting. Pure functions: no DOM, no text. Distances in
// millimeters unless a name says otherwise; the tool converts the student's units at its edge.

const FULL_FRAME_DIAGONAL = Math.hypot(36, 24);

/** Exposure value at ISO 100: EV = log2(N^2 / t). */
export const exposureValue = (aperture: number, seconds: number): number => Math.log2((aperture * aperture) / seconds);

/** The same scene brightness read at another ISO: EV(ISO) = EV100 + log2(ISO / 100). */
export const exposureValueAtIso = (aperture: number, seconds: number, iso: number): number =>
  exposureValue(aperture, seconds) + Math.log2(iso / 100);

/** Stops between two apertures (positive when `to` lets in less light). */
export const apertureStops = (from: number, to: number): number => 2 * Math.log2(to / from);

/** The shutter time that keeps the exposure when the aperture changes from `from` to `to`. */
export const equivalentShutter = (seconds: number, from: number, to: number): number =>
  (seconds * (to * to)) / (from * from);

/** Schwarzschild reciprocity: the corrected time t' = t^p for a metered time t in seconds (p of 1 means none). */
export const reciprocityTime = (seconds: number, exponent: number): number => seconds ** exponent;

export interface Sensor {
  width: number;
  height: number;
}

export const SENSORS: Record<string, Sensor> = {
  fullframe: { width: 36, height: 24 },
  apsc: { width: 23.6, height: 15.6 },
  super35: { width: 24.89, height: 18.66 },
  mft: { width: 17.3, height: 13 },
  oneinch: { width: 13.2, height: 8.8 },
  phone: { width: 5.6, height: 4.2 },
};

export const diagonal = (sensor: Sensor): number => Math.hypot(sensor.width, sensor.height);

/** How much smaller the sensor's diagonal is than full frame's. */
export const cropFactor = (sensor: Sensor): number => FULL_FRAME_DIAGONAL / diagonal(sensor);

/** The usual circle of confusion: the sensor's diagonal over 1442 (0.030 mm on full frame). */
export const circleOfConfusion = (sensor: Sensor): number => diagonal(sensor) / 1442;

/** The angle of view across a dimension `d` for focal length `f`, in radians. */
export const angleOfView = (d: number, f: number): number => 2 * Math.atan(d / (2 * f));

/** The focal length that gives angle `rad` across a dimension `d`. */
export const focalForAngle = (d: number, rad: number): number => d / (2 * Math.tan(rad / 2));

export interface DepthOfField {
  hyperfocal: number;
  near: number;
  /** Infinity when the subject is at or beyond the hyperfocal distance. */
  far: number;
  total: number;
}

/** Hyperfocal H = f^2 / (N c) + f; near = s (H - f) / (H + s - 2f); far = s (H - f) / (H - s). All in mm. */
export function depthOfField(f: number, aperture: number, coc: number, subject: number): DepthOfField {
  const hyperfocal = (f * f) / (aperture * coc) + f;
  const near = (subject * (hyperfocal - f)) / (hyperfocal + subject - 2 * f);
  const far = subject >= hyperfocal ? Infinity : (subject * (hyperfocal - f)) / (hyperfocal - subject);
  return { hyperfocal, near, far, total: far - near };
}

/** Exposure time for a shutter angle at a frame rate: t = angle / (360 fps). */
export const shutterTime = (angle: number, fps: number): number => angle / (360 * fps);

/** The shutter angle for an exposure time at a frame rate. */
export const shutterAngle = (seconds: number, fps: number): number => seconds * fps * 360;

export interface Rate {
  /** The frames counted per second in the timecode (24, 25, 30, 50, 60). */
  nominal: number;
  /** The true frames per second. */
  fps: number;
  /** Frame numbers dropped each minute except every tenth (0 for non-drop). */
  drop: number;
}

export const RATES: Record<string, Rate> = {
  '23.976': { nominal: 24, fps: 24000 / 1001, drop: 0 },
  '24': { nominal: 24, fps: 24, drop: 0 },
  '25': { nominal: 25, fps: 25, drop: 0 },
  '29.97df': { nominal: 30, fps: 30000 / 1001, drop: 2 },
  '29.97': { nominal: 30, fps: 30000 / 1001, drop: 0 },
  '30': { nominal: 30, fps: 30, drop: 0 },
  '50': { nominal: 50, fps: 50, drop: 0 },
  '59.94df': { nominal: 60, fps: 60000 / 1001, drop: 4 },
  '60': { nominal: 60, fps: 60, drop: 0 },
};

export interface Timecode {
  hours: number;
  minutes: number;
  seconds: number;
  frames: number;
}

const two = (n: number): string => String(n).padStart(2, '0');

export const timecodeText = (tc: Timecode, drop: boolean): string =>
  `${two(tc.hours)}:${two(tc.minutes)}:${two(tc.seconds)}${drop ? ';' : ':'}${two(tc.frames)}`;

/** Reads hh:mm:ss:ff (a semicolon before the frames means drop-frame); null when it is not a timecode. */
export function parseTimecode(text: string): Timecode | null {
  const match = /^\s*(\d{1,3}):(\d{1,2}):(\d{1,2})[:;.](\d{1,3})\s*$/.exec(text);
  if (!match) return null;
  return { hours: Number(match[1]), minutes: Number(match[2]), seconds: Number(match[3]), frames: Number(match[4]) };
}

/** The timecode names a frame that exists: drop-frame skips numbers 0..drop-1 at the start of most minutes. */
export function validTimecode(tc: Timecode, rate: Rate): boolean {
  if (tc.minutes > 59 || tc.seconds > 59 || tc.frames >= rate.nominal) return false;
  return !(rate.drop > 0 && tc.seconds === 0 && tc.frames < rate.drop && tc.minutes % 10 !== 0);
}

/** The frame count at a timecode (frame 0 is 00:00:00:00). */
export function timecodeToFrames(tc: Timecode, rate: Rate): number {
  const minutes = tc.hours * 60 + tc.minutes;
  const total = (minutes * 60 + tc.seconds) * rate.nominal + tc.frames;
  return total - rate.drop * (minutes - Math.floor(minutes / 10));
}

/** The timecode of a frame count; for drop-frame, numbers are skipped so the clock keeps real time. */
export function framesToTimecode(frames: number, rate: Rate): Timecode {
  let counted = frames;
  if (rate.drop > 0) {
    const perMinute = rate.nominal * 60 - rate.drop;
    const perTenMinutes = perMinute * 10 + rate.drop;
    const tens = Math.floor(frames / perTenMinutes);
    const rest = frames % perTenMinutes;
    counted = frames + rate.drop * 9 * tens;
    if (rest >= rate.drop) counted += rate.drop * Math.floor((rest - rate.drop) / perMinute);
  }
  const f = counted % rate.nominal;
  const totalSeconds = Math.floor(counted / rate.nominal);
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor(totalSeconds / 60) % 60,
    seconds: totalSeconds % 60,
    frames: f,
  };
}

/** Feet and frames for a frame count: 35 mm has 16 frames per foot, 16 mm has 40. */
export function feetAndFrames(frames: number, perFoot: number): { feet: number; frames: number } {
  return { feet: Math.floor(frames / perFoot), frames: frames % perFoot };
}

export interface Animation {
  frames: number;
  drawings: number;
  /** For each drawing, the frames it covers (1-based). */
  sheet: { drawing: number; from: number; to: number }[];
}

/** Drawings for a running time shot on ones, twos, or threes (each drawing held `hold` frames). */
export function animation(seconds: number, fps: number, hold: number): Animation {
  const frames = Math.round(seconds * fps);
  const drawings = Math.ceil(frames / hold);
  const sheet = Array.from({ length: drawings }, (_, i) => ({
    drawing: i + 1,
    from: i * hold + 1,
    to: Math.min(frames, (i + 1) * hold),
  }));
  return { frames, drawings, sheet };
}

export type Easing = 'in' | 'out' | 'inout';

/** Where the drawing is (0 to 1) after each of `count` equal steps of time: the spacing chart. */
export function spacing(count: number, easing: Easing): number[] {
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = i / count;
    if (easing === 'in') return t * t;
    if (easing === 'out') return 1 - (1 - t) * (1 - t);
    return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
  });
}

/** Illuminance from a point source: E = I / d^2, so moving it from d1 to d2 scales E by (d1/d2)^2. */
export const inverseSquare = (illuminance: number, from: number, to: number): number => illuminance * (from / to) ** 2;

export const LUX_PER_FOOTCANDLE = 10.763910416709722;

/** The width of a light's beam at a throw distance: 2 d tan(spread / 2). */
export const beamDiameter = (throwDistance: number, spreadDegrees: number): number =>
  2 * throwDistance * Math.tan((spreadDegrees * Math.PI) / 360);

/** Stops between a key and a fill: log2(key / fill). */
export const ratioStops = (key: number, fill: number): number => Math.log2(key / fill);

export const mired = (kelvin: number): number => 1e6 / kelvin;

/** The mired shift of a gel that takes a source from one color temperature to another. */
export const miredShift = (fromKelvin: number, toKelvin: number): number => mired(toKelvin) - mired(fromKelvin);

/** Storage in bytes for a bit rate (bits per second) over a duration. */
export const storageBytes = (bitsPerSecond: number, seconds: number): number => (bitsPerSecond * seconds) / 8;

/** Uncompressed video data rate in bits per second. */
export const videoBitRate = (width: number, height: number, bitsPerPixel: number, fps: number): number =>
  width * height * bitsPerPixel * fps;

/** Uncompressed audio data rate in bits per second. */
export const audioBitRate = (sampleRate: number, bitDepth: number, channels: number): number =>
  sampleRate * bitDepth * channels;
