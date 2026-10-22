// Projectile motion over flat ground, with optional linear air resistance (a drag force of k·m·v, so the drag
// acceleration is −k v). Both cases have a closed form, so a point at any time is exact and the trajectory can go
// into a graph block as a parametric curve. The landing time is found by Newton's method, kept safe by bisection.

export interface Launch {
  /** Speed at launch, m/s. */
  readonly speed: number;
  /** Angle above the horizontal, degrees. */
  readonly angle: number;
  /** Height above the ground at launch, m. */
  readonly height: number;
  /** Gravity, m/s². */
  readonly gravity: number;
  /** The drag constant k, 1/s. 0 for none. */
  readonly drag: number;
}

export interface Flight {
  readonly time: number;
  readonly range: number;
  readonly peakHeight: number;
  readonly peakTime: number;
  readonly impactSpeed: number;
}

export const EARTH_GRAVITY = 9.81;

/** True when the numbers make a flight: speed and drag not negative, gravity positive, angle within ±90°. */
export function validLaunch(launch: Launch): boolean {
  const { speed, angle, height, gravity, drag } = launch;
  return (
    [speed, angle, height, gravity, drag].every(Number.isFinite) &&
    speed >= 0 &&
    gravity > 0 &&
    drag >= 0 &&
    height >= 0 &&
    Math.abs(angle) <= 90
  );
}

function parts(launch: Launch) {
  const theta = (launch.angle * Math.PI) / 180;
  return { vx: launch.speed * Math.cos(theta), vy: launch.speed * Math.sin(theta), g: launch.gravity, k: launch.drag };
}

/** 1 − e^(−kt), divided by k: t when k is 0, and accurate when k t is tiny. */
function grow(k: number, t: number): number {
  return k === 0 ? t : -Math.expm1(-k * t) / k;
}

/** The position at time t, in m. */
export function positionAt(launch: Launch, t: number): { x: number; y: number } {
  const { vx, vy, g, k } = parts(launch);
  if (k === 0) return { x: vx * t, y: launch.height + vy * t - (g * t * t) / 2 };
  return { x: vx * grow(k, t), y: launch.height + (vy + g / k) * grow(k, t) - (g / k) * t };
}

/** The velocity at time t, in m/s. */
export function velocityAt(launch: Launch, t: number): { x: number; y: number } {
  const { vx, vy, g, k } = parts(launch);
  if (k === 0) return { x: vx, y: vy - g * t };
  const decay = Math.exp(-k * t);
  return { x: vx * decay, y: (vy + g / k) * decay - g / k };
}

/** The time the projectile is highest: when the vertical velocity is 0, or at launch when it starts downward. */
function peakTime(launch: Launch): number {
  const { vy, g, k } = parts(launch);
  if (vy <= 0) return 0;
  return k === 0 ? vy / g : Math.log1p((k * vy) / g) / k;
}

/** When it lands (y = 0), by Newton's method from the drag-free answer, kept inside a bracket by bisection. */
export function landingTime(launch: Launch): number {
  const { vy, g } = parts(launch);
  const free = (vy + Math.sqrt(vy * vy + 2 * g * launch.height)) / g;
  if (launch.drag === 0) return free;
  let lo = peakTime(launch);
  let hi = Math.max(free, lo + 1e-9);
  while (positionAt(launch, hi).y > 0) hi *= 2;
  let t = hi;
  for (let i = 0; i < 100; i++) {
    const y = positionAt(launch, t).y;
    if (Math.abs(y) < 1e-12) break;
    if (y > 0) lo = t;
    else hi = t;
    const slope = velocityAt(launch, t).y;
    const next = slope === 0 ? NaN : t - y / slope;
    t = next > lo && next < hi ? next : (lo + hi) / 2;
    if (hi - lo < 1e-13 * Math.max(1, hi)) break;
  }
  return t;
}

export function flight(launch: Launch): Flight {
  const time = landingTime(launch);
  const top = peakTime(launch);
  const v = velocityAt(launch, time);
  return {
    time,
    range: positionAt(launch, time).x,
    peakHeight: positionAt(launch, top).y,
    peakTime: top,
    impactSpeed: Math.hypot(v.x, v.y),
  };
}

const num = (value: number) => String(Number(value.toPrecision(6)));

/** A sum such as "5 + 3 t - 4.9 t^2" from coefficients and what each multiplies; zero terms are left out. */
function sum(terms: readonly (readonly [number, string])[]): string {
  let text = '';
  for (const [value, rest] of terms) {
    const v = Number(value.toPrecision(6));
    if (v === 0) continue;
    const size = rest !== '' && Math.abs(v) === 1 ? '' : num(Math.abs(v));
    const body = `${size}${size && rest ? ' ' : ''}${rest}`;
    text += text === '' ? `${v < 0 ? '-' : ''}${body}` : ` ${v < 0 ? '-' : '+'} ${body}`;
  }
  return text || '0';
}

/** The trajectory as a parametric graph block: (x(t), y(t)) for t from 0 to landing, and a view that fits it. */
export function trajectoryGraph(launch: Launch): string {
  const { vx, vy, g, k } = parts(launch);
  const result = flight(launch);
  const decay = `(1 - e^(-${num(k)} t))`;
  const curve =
    k === 0
      ? `(${sum([[vx, 't']])}, ${sum([
          [launch.height, ''],
          [vy, 't'],
          [-g / 2, 't^2'],
        ])})`
      : `(${sum([[vx / k, decay]])}, ${sum([
          [launch.height, ''],
          [(vy + g / k) / k, decay],
          [-g / k, 't'],
        ])})`;
  const width = Math.max(result.range, 1);
  const top = Math.max(result.peakHeight, launch.height, 1);
  // The plot is 16 by 9; the view keeps a margin around the flight.
  const view = [-0.05 * width, 1.05 * width, -0.08 * top, 1.15 * top];
  return [curve, `@view ${view.map(num).join(' ')}`, `@t 0 ${num(result.time)}`].join('\n');
}
