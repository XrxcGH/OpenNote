// The words of the solid mechanics kit's beam deflection tool: its form, results, notes, and plot, then
// the wording of its worked steps.
export const deflection = {
  title: 'Beam deflection',
  keywords:
    'beam deflection elastic curve slope double integration superposition singularity functions cantilever ' +
    'simply supported propped cantilever continuous beam indeterminate hinge EI maximum deflection',
  field: {
    E: "Young's modulus, E",
    I: 'Second moment of area, I',
    L: 'Length, L',
    supports: 'Supports, one to a line',
    loads: 'Loads, one to a line',
    segments: 'Changes of EI, one to a line (optional)',
    points: 'Points to report, x (optional)',
  },
  hint: {
    supports: 'Type pin, roller, fixed, or hinge, then x in {span}. A hinge joins two parts of the beam.',
    loads:
      'Type point x P in {force}, moment x M in {moment}, or udl x1 x2 w (or w1 w2) in {load}. Loads point ' +
      'down and moments turn counterclockwise when positive. x is in {span}.',
    segments: 'Type x1 x2 factor, in {span}, where EI is that many times E·I.',
    points: 'Type the places, in {span}, where you want v, the slope, and M.',
  },
  example: {
    simple: 'Simply supported, uniform load',
    cantilever: 'Cantilever, load at the tip',
    propped: 'Propped cantilever, uniform load',
    continuous: 'Two equal spans, uniform load',
    gerber: 'Fixed end with a hinge and a roller',
    stepped: 'Cantilever twice as stiff near the wall',
  },
  row: {
    vMax: 'Largest deflection, vmax',
    xMax: 'Where it is, x',
    thetaA: 'Slope at the left end, θA',
    thetaB: 'Slope at the right end, θB',
    thetaMax: 'Largest slope, θmax',
    xTheta: 'Where the largest slope is',
  },
  table: { reactions: 'Reactions', points: 'Values at your points' },
  col: {
    support: 'Support',
    x: 'x',
    R: 'Force, up',
    M: 'Moment, counterclockwise',
    v: 'Deflection, v',
    theta: 'Slope, θ',
  },
  note: {
    signs: 'v is up, so a beam that sags has negative v. The slope θ is dv/dx, in radians, positive counterclockwise.',
    theory: 'Euler–Bernoulli beams: small deflections, linear elastic material, and no shear deformation.',
    indeterminate:
      'The beam is statically indeterminate. The reactions come from the stiffness method, which is exact here.',
    superpose: 'The answers are linear in the loads, so you can check them by superposing table cases.',
  },
  plot: { x: 'Position, x', v: 'Deflection, v', curve: 'Elastic curve', max: 'Largest deflection' },
  picture: 'The elastic curve along the beam, with the largest deflection marked',
} as const;

export const deflectionSteps = {
  reactions: 'Find the reactions from statics.',
  indeterminate: 'Find the reactions. The beam is indeterminate, so they come from the stiffness method.',
  moment: 'Write the bending moment from {a} to {b}, with x in {xu} and M in {mu}.',
  momentStiff: 'Write the bending moment from {a} to {b}, with x in {xu} and M in {mu}. Here EI is {factor} E·I.',
  curvature: 'The curvature of the beam is the moment over EI.',
  integrate: 'Integrate once for the slope and again for the deflection.',
  conditions: 'The supports give the boundary conditions.',
  constants: 'Solve the boundary conditions for the constants of integration.',
  hinge: 'At a hinge the slope may jump, so each hinge adds one more constant.',
  maximum: 'The largest deflection is where the slope is zero, or at an end or a load.',
} as const;
