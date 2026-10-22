// The flags of 3D graphs, vector tools, curve traces, solids of revolution, the projectile simulator, and 3D geometry
// (mt3-graph-3d lane). app/flags.ts joins these to its list. Each is on in development, nightly, and Beta builds,
// and off in Stable until it meets the definition of done.
import type { FlagDef } from '../../app/flags';

export type Graph3dFlagId =
  /** z = f(x, y) as a turnable surface and a contour plot, with a tangent plane. */
  | 'math.graph3d'
  /** Parametric and polar curves in graph blocks, with an animated trace; vector and slope fields. */
  | 'math.curves'
  /** The Vectors tool: dot, cross, projections, and 3D vector plots. */
  | 'math.vectors'
  /** The Lines and planes tab of the Vectors tool: distances and intersections in 3D. */
  | 'math.geometry3d'
  /** The Solids of revolution tool. */
  | 'math.solids'
  /** The Projectile simulator tool. */
  | 'math.projectile';

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const building = { dev: true, nightly: true, beta: true, stable: false };

const flag = (id: Graph3dFlagId, description: string): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled: building,
});

export const GRAPH3D_FLAGS: readonly FlagDef[] = [
  flag('math.graph3d', '3D graphs: z = f(x, y) as a surface you can turn, contour plots, and tangent planes.'),
  flag('math.curves', 'Parametric and polar curves with an animated trace, and vector and slope fields.'),
  flag('math.vectors', 'The Vectors tool: dot and cross products, projections, and 3D vector plots.'),
  flag('math.geometry3d', 'Lines and planes in 3D: distances, intersections, and angles, with a plot.'),
  flag('math.solids', 'Solids of revolution: disk, washer, and shell volumes with steps and a 3D view.'),
  flag('math.projectile', 'The projectile simulator: speed, angle, height, gravity, and drag, with a trajectory.'),
];
