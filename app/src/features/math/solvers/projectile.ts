// The projectile simulator's engine: range, highest point, time of flight, and landing speed for a launch from a
// height, in closed form without air resistance and by fourth-order Runge-Kutta with quadratic drag. The landing and
// the top are found inside the last step by cubic Hermite interpolation, which is exact for the no-drag parabola,
// so the numeric run matches the closed form to rounding.
import { SolverError, numberText } from './expr';
import { step, type Step } from './steps';

export interface ProjectileInput {
  /** Launch speed, m/s. */
  readonly speed: number;
  /** Launch angle above the horizontal, degrees. */
  readonly angle: number;
  /** Launch height above the ground, m. */
  readonly height?: number;
  /** Gravity, m/s². */
  readonly gravity?: number;
  /** k in a = −g ŷ − k |v| v, in 1/m: ρ C_d A / (2m). 0 for no drag. */
  readonly drag?: number;
}

export interface FlightPoint {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

export interface Flight {
  readonly time: number;
  readonly range: number;
  readonly maxHeight: number;
  readonly maxHeightTime: number;
  readonly impactSpeed: number;
  /** Below the horizontal, degrees. */
  readonly impactAngle: number;
}

export interface ProjectileResult extends Flight {
  readonly path: readonly FlightPoint[];
  /** The closed form without drag, for comparison. */
  readonly vacuum: Flight;
  readonly steps: readonly Step[];
}

/** k = ρ C_d A / (2m) for air density ρ (kg/m³), drag coefficient, frontal area (m²), and mass (kg). */
export const dragFactor = (density: number, coefficient: number, area: number, mass: number): number =>
  (density * coefficient * area) / (2 * mass);

/** The flight without air resistance, in closed form. */
export function vacuumFlight(speed: number, angle: number, height = 0, gravity = 9.81): Flight {
  const theta = (angle * Math.PI) / 180;
  const [vx, vy] = [Math.abs(angle) === 90 ? 0 : speed * Math.cos(theta), speed * Math.sin(theta)];
  const time = (vy + Math.sqrt(vy * vy + 2 * gravity * height)) / gravity;
  const top = Math.max(0, vy / gravity);
  const vyEnd = vy - gravity * time;
  return {
    time,
    range: vx * time,
    maxHeight: height + (vy > 0 ? (vy * vy) / (2 * gravity) : 0),
    maxHeightTime: top,
    impactSpeed: Math.hypot(vx, vyEnd),
    impactAngle: (Math.atan2(-vyEnd, vx) * 180) / Math.PI,
  };
}

type State = readonly [number, number, number, number];

export function simulate(input: ProjectileInput): ProjectileResult {
  const { speed, angle } = input;
  const height = input.height ?? 0;
  const g = input.gravity ?? 9.81;
  const k = input.drag ?? 0;
  if (!(speed > 0) || !(angle >= -90 && angle <= 90) || !(height >= 0) || !(g > 0) || !(k >= 0))
    throw new SolverError('projectile-input');
  if (height === 0 && angle <= 0) throw new SolverError('projectile-input');
  const vacuum = vacuumFlight(speed, angle, height, g);
  const theta = (angle * Math.PI) / 180;
  const deriv = (s: State): State => {
    const v = Math.hypot(s[2], s[3]);
    return [s[2], s[3], -k * v * s[2], -g - k * v * s[3]];
  };
  const dt = vacuum.time / 2000;
  let t = 0;
  let s: State = [0, height, Math.abs(angle) === 90 ? 0 : speed * Math.cos(theta), speed * Math.sin(theta)];
  const path: FlightPoint[] = [{ t, x: s[0], y: s[1], vx: s[2], vy: s[3] }];
  let top = { t: 0, y: height };
  for (let i = 0; i < 2_000_000; i += 1) {
    const k1 = deriv(s);
    const k2 = deriv(s.map((v, j) => v + (dt / 2) * k1[j]) as unknown as State);
    const k3 = deriv(s.map((v, j) => v + (dt / 2) * k2[j]) as unknown as State);
    const k4 = deriv(s.map((v, j) => v + dt * k3[j]) as unknown as State);
    const next = s.map((v, j) => v + (dt / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j])) as unknown as State;
    const d0 = k1;
    const d1 = deriv(next);
    // The top of the flight: vy changes sign inside this step.
    if (s[3] > 0 && next[3] <= 0) {
      const tau = solveIn((u) => hermite(s[3], next[3], d0[3], d1[3], dt, u));
      top = { t: t + tau * dt, y: hermite(s[1], next[1], s[3], next[3], dt, tau) };
    }
    // The landing: y crosses zero inside this step.
    if (next[1] <= 0 && t > 0) {
      const tau = solveIn((u) => hermite(s[1], next[1], s[3], next[3], dt, u));
      const at = (j: number, dj: number) => hermite(s[j], next[j], d0[dj] ?? 0, d1[dj] ?? 0, dt, tau);
      const land: FlightPoint = {
        t: t + tau * dt,
        x: hermite(s[0], next[0], s[2], next[2], dt, tau),
        y: 0,
        vx: at(2, 2),
        vy: at(3, 3),
      };
      path.push(land);
      const flight: Flight = {
        time: land.t,
        range: land.x,
        maxHeight: Math.max(top.y, height),
        maxHeightTime: top.t,
        impactSpeed: Math.hypot(land.vx, land.vy),
        impactAngle: (Math.atan2(-land.vy, land.vx) * 180) / Math.PI,
      };
      return { ...flight, path: thin(path), vacuum, steps: stepsFor(input, vacuum, flight, g, k) };
    }
    s = next;
    t += dt;
    path.push({ t, x: s[0], y: s[1], vx: s[2], vy: s[3] });
  }
  throw new SolverError('projectile-input');
}

/** The cubic Hermite interpolant on a step of length h at the fraction u, from values and slopes at both ends. */
function hermite(y0: number, y1: number, m0: number, m1: number, h: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * h * m1;
}

/** The root in [0, 1] of a function that changes sign there, by bisection to rounding. */
function solveIn(f: (u: number) => number): number {
  let [a, b] = [0, 1];
  const fa = f(a);
  for (let i = 0; i < 80; i += 1) {
    const m = (a + b) / 2;
    if (Math.sign(f(m)) === Math.sign(fa)) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/** About 400 points for drawing and animation, always keeping the landing. */
function thin(path: readonly FlightPoint[]): FlightPoint[] {
  const every = Math.max(1, Math.floor(path.length / 400));
  const out = path.filter((_, i) => i % every === 0);
  if (out[out.length - 1] !== path[path.length - 1]) out.push(path[path.length - 1]);
  return out;
}

function stepsFor(input: ProjectileInput, vacuum: Flight, flight: Flight, g: number, k: number): Step[] {
  const theta = (input.angle * Math.PI) / 180;
  const [vx, vy] = [input.speed * Math.cos(theta), input.speed * Math.sin(theta)];
  const h = input.height ?? 0;
  const n = (x: number) => numberText(x, 6);
  const steps = [
    step('projectileComponents', `vₓ = v·cos θ = ${n(vx)} m/s,  v_y = v·sin θ = ${n(vy)} m/s`),
    step(
      'projectileTime',
      `t = (v_y + √(v_y² + 2gh))/g = (${n(vy)} + √(${n(vy * vy)} + 2·${n(g)}·${n(h)}))/${n(g)} = ${n(vacuum.time)} s`,
    ),
    step('projectileRange', `R = vₓ·t = ${n(vacuum.range)} m`),
    step('projectileHeight', `H = h + v_y²/(2g) = ${n(vacuum.maxHeight)} m`),
  ];
  if (k > 0)
    steps.push(
      step('projectileDrag', `R = ${n(flight.range)} m,  H = ${n(flight.maxHeight)} m,  t = ${n(flight.time)} s`, {
        k: n(k),
        percent: n((100 * (vacuum.range - flight.range)) / vacuum.range),
      }),
    );
  return steps;
}
