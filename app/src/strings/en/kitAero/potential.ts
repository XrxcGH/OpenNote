// Potential flow: the tool's labels, results, plots, and worked steps (kitAero.t.potential).
export const potential = {
  title: 'Potential flow',
  short: 'Potential flow',
  keywords:
    'potential flow uniform source sink doublet vortex rankine half body oval cylinder circulation kutta ' +
    'joukowski lift stagnation streamlines stream function complex potential',
  about:
    'Superpose uniform flow, sources, doublets, and vortices to see the streamlines, stagnation points, ' +
    'pressure, and lift.',
  assume:
    'Two-dimensional, steady, incompressible, inviscid, and irrotational flow. A vortex’s strength Γ is ' +
    'positive clockwise, so a positive Γ in a flow from the left lifts upward. Cp uses the free-stream speed. ' +
    'The plot and the stagnation points are in meters, and the element list is read in SI units.',
  f: {
    preset: 'Flow',
    U: 'Free-stream speed U',
    a: 'Cylinder radius a',
    gamma: 'Circulation Γ (clockwise positive)',
    m: 'Source strength m',
    b: 'Half distance between source and sink b',
    elements: 'Elements',
    size: 'Plot half-height',
    px: 'Probe point x',
    py: 'Probe point y',
    rho: 'Air density ρ',
  },
  h: {
    gamma: '4πUa puts both stagnation points together at the bottom.',
    elements:
      'Separate elements with semicolons: uniform U angle; source m x y; sink m x y; doublet κ x y; vortex Γ x ' +
      'y. SI units, angles in degrees.',
  },
  o: {
    cylinder: 'Cylinder (uniform flow and doublet)',
    liftingCylinder: 'Lifting cylinder (with a vortex)',
    halfBody: 'Rankine half-body (uniform flow and source)',
    oval: 'Rankine oval (source and sink)',
    custom: 'My own list of elements',
  },
  r: {
    u: 'Velocity u at the probe',
    v: 'Velocity v at the probe',
    speed: 'Speed at the probe',
    Cp: 'Pressure coefficient Cp at the probe',
    freeStream: 'Free-stream speed',
    circulation: 'Total circulation Γ',
    lift: 'Lift per unit span L′',
    stagnation: 'Stagnation points (x, y), m',
  },
  p: {
    streamlines: 'Streamlines',
    x: 'x, m',
    y: 'y, m',
    psi: 'Streamlines (ψ constant)',
    probe: 'Probe',
  },
  s: {
    pfComplex: 'Add the complex potentials of the {count} elements (vortex strength positive clockwise).',
    pfVelocity: 'The complex velocity is the derivative of W.',
    pfBernoulli: 'Pressure coefficient from Bernoulli’s equation, which holds everywhere in an irrotational flow.',
    pfNoFreeStream: 'There is no uniform flow, so the pressure coefficient has no reference speed.',
    pfKuttaJoukowski:
      'Kutta-Joukowski theorem: the lift per unit span depends only on the total circulation. The drag is zero ' +
      '(d’Alembert’s paradox).',
    pfStagnation: 'Stagnation points, where dW/dz = 0, by complex Newton iteration: {points}.',
  },
  e: {
    noElements: 'Add at least one flow element.',
    elementText: 'Cannot read “{part}”. Write a kind and its numbers, such as source 2*pi 0 0.',
    tooManyElements: 'Use at most 20 flow elements.',
    windowRange: 'The plot window needs a positive width and height.',
    probeOnElement:
      'The probe point sits on a singularity, where the velocity is infinite. Move it off the element.',
  },
} as const;
