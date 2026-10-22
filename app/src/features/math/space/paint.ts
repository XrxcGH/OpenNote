// The two Paints for 3D graphs: theme variables on screen, so a theme switch recolors with no redraw, and the light
// theme's fixed colors for SVG and PNG export and print. Surfaces run from the brand's indigo (low) through fern to
// amber (high), shaded by how they face the light. A tangent plane is brick, planes fern, and a solid amber.
import { tokens } from '../../../theme/tokens';
import type { Paint } from './project';
import type { Role } from './world';

const PEN_VARS = ['--ink-indigo', '--ink-amber', '--ink-fern', '--ink-brick', '--ink-plum', '--ink-walnut'];
const PEN_NAMES = ['Indigo', 'Amber', 'Fern', 'Brick', 'Plum', 'Walnut'];

/** The low, middle, and high colors of each role, by pen name. */
const RAMPS: Record<string, readonly [string, string, string]> = {
  surface: ['Indigo', 'Fern', 'Amber'],
  surface2: ['Plum', 'Brick', 'Amber'],
  tangent: ['Brick', 'Brick', 'Brick'],
  plane: ['Fern', 'Fern', 'Fern'],
  solid: ['Amber', 'Amber', 'Amber'],
  inner: ['Fern', 'Fern', 'Fern'],
};

/** The two stops a tone falls between, and how far along it is. */
function stops(ramp: readonly [string, string, string], tone: number): [string, string, number] {
  return tone < 0.5 ? [ramp[0], ramp[1], tone * 2] : [ramp[1], ramp[2], tone * 2 - 1];
}

const ramp = (role: Role, series: number) =>
  RAMPS[role === 'surface' && series % 2 === 1 ? 'surface2' : role] ?? RAMPS.surface;

const OPACITY: Partial<Record<Role, number>> = { tangent: 0.72, plane: 0.5, inner: 0.85 };
const pct = (value: number) => `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
const toVar = (name: string) => `var(--ink-${name.toLowerCase()})`;

export const screenPaint: Paint = {
  face(role, series, tone, light) {
    const [low, high, k] = stops(ramp(role, series), tone);
    const base = low === high ? toVar(low) : `color-mix(in oklab, ${toVar(high)} ${pct(k)}, ${toVar(low)})`;
    return `color-mix(in oklab, ${base} ${pct(light)}, black)`;
  },
  faceOpacity: (role) => OPACITY[role] ?? 1,
  stroke(role, series, tone) {
    if (role === 'box') return 'var(--color-border-control)';
    if (role === 'axis') return 'var(--color-text-secondary)';
    if (role === 'contour') {
      const [low, high, k] = stops(RAMPS.surface, tone ?? 0.5);
      return `color-mix(in oklab, ${toVar(high)} ${pct(k)}, ${toVar(low)})`;
    }
    return `var(${PEN_VARS[Math.abs(series) % PEN_VARS.length]})`;
  },
  dot: (role, series) =>
    role === 'tangent' ? 'var(--ink-brick)' : `var(${PEN_VARS[Math.abs(series) % PEN_VARS.length]})`,
  text: 'var(--color-text-secondary)',
  paper: 'var(--color-surface-page)',
  fontFamily: 'var(--font-ui)',
};

function hex(name: string): string {
  return tokens.ink.pens.find((pen) => pen.name === name)?.light ?? '#2F4F9A';
}

function mix(a: string, b: string, k: number): string {
  const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [pa, pb] = [parse(a), parse(b)];
  return `#${pa
    .map((v, i) =>
      Math.round(v + (pb[i] - v) * k)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Fixed colors from the light theme, for files and print. */
export function exportPaint(): Paint {
  const c = tokens.color.light;
  return {
    face(role, series, tone, light) {
      const [low, high, k] = stops(ramp(role, series), tone);
      return mix('#000000', mix(hex(low), hex(high), k), light);
    },
    faceOpacity: (role) => OPACITY[role] ?? 1,
    stroke(role, series, tone) {
      if (role === 'box') return c.border.control;
      if (role === 'axis') return c.text.secondary;
      if (role === 'contour') {
        const [low, high, k] = stops(RAMPS.surface, tone ?? 0.5);
        return mix(hex(low), hex(high), k);
      }
      return hex(PEN_NAMES[Math.abs(series) % PEN_NAMES.length]);
    },
    dot: (role, series) => (role === 'tangent' ? hex('Brick') : hex(PEN_NAMES[Math.abs(series) % PEN_NAMES.length])),
    text: c.text.secondary,
    paper: c.surface.page,
    fontFamily: tokens.font.ui,
  };
}
