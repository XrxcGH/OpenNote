// The spring a dropped row settles with (ARCHITECTURE.md section 13.6): from where the pointer left it to its
// place, with the motion tokens' spring, never longer than the deliberate duration (400 ms). With reduced motion
// the row appears in place at once.

import { tokens } from '../../theme/tokens';

export interface Offset {
  readonly x: number;
  readonly y: number;
}

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** One step of a spring that pulls `position` to zero. Returns the new position and velocity. */
export function springStep(position: number, velocity: number, dt: number) {
  const { stiffness, damping, mass } = tokens.motion.spring;
  const nextVelocity = velocity + ((-stiffness * position - damping * velocity) / mass) * dt;
  return { position: position + nextVelocity * dt, velocity: nextVelocity };
}

/** Moves the element from `from` to its own place, then clears the transform. */
export function settle(element: HTMLElement, from: Offset, done: () => void = () => {}): void {
  if (reducedMotion() || Math.hypot(from.x, from.y) < 1) {
    element.style.transform = '';
    done();
    return;
  }
  let x = { position: from.x, velocity: 0 };
  let y = { position: from.y, velocity: 0 };
  const start = performance.now();
  let last = start;
  const frame = (now: number) => {
    const dt = Math.min(0.032, (now - last) / 1000);
    last = now;
    x = springStep(x.position, x.velocity, dt);
    y = springStep(y.position, y.velocity, dt);
    const rest = Math.hypot(x.position, y.position) < 0.5 && Math.hypot(x.velocity, y.velocity) < 5;
    if (rest || now - start >= tokens.motion.duration.deliberate) {
      element.style.transform = '';
      done();
      return;
    }
    element.style.transform = `translate(${x.position}px, ${y.position}px)`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
