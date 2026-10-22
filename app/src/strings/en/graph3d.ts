// 3D graphs, vector tools, parametric and polar traces, solids of revolution, the projectile simulator, and 3D
// geometry (owner: the mt3-graph-3d lane). Each namespace file has one owner, so parallel work never edits the same
// file.

export const graph3d = {
  trace: {
    play: 'Play trace',
    pause: 'Pause trace',
    slider: 'Trace position, t',
    variable: 't',
    point: 'At t = {t}: x = {x}, y = {y}',
    undefined: 'The curve is not defined at t = {t}.',
  },
} as const;
