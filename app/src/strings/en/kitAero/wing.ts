// Finite wings: the tool's labels, results, plots, and worked steps (kitAero.t.wing).
export const wing = {
  title: 'Finite wings',
  short: 'Finite wing',
  keywords:
    'finite wing lifting line prandtl glauert induced drag downwash span efficiency oswald elliptic lift ' +
    'distribution taper twist washout aspect ratio',
  about:
    'Lift, induced drag, and span efficiency of a straight wing by Prandtl’s lifting-line theory, with the ' +
    'spanwise load.',
  assume:
    'Incompressible, inviscid flow past an unswept wing of moderate to high aspect ratio. The section lift ' +
    'slope and zero-lift angle are the same across the span, and the twist grows linearly from root to tip. ' +
    'Induced drag only: add the section profile drag for the total. Angles are measured at the root.',
  f: {
    planform: 'Planform',
    span: 'Span b',
    area: 'Wing area S',
    taper: 'Taper ratio λ = c_tip/c_root',
    twist: 'Tip twist (washout is negative)',
    a0: 'Section lift slope a₀, per radian',
    alphaL0: 'Section zero-lift angle αL0',
    alpha: 'Angle of attack α',
    terms: 'Number of sine terms N',
    V: 'Airspeed V (optional, for forces)',
    rho: 'Air density ρ (for forces)',
  },
  h: {
    a0: 'Thin airfoil theory gives 2π, typed as 2*pi.',
    terms: '40 is plenty; more terms change the answer very little.',
  },
  o: {
    tapered: 'Straight-tapered (1 is rectangular)',
    elliptic: 'Elliptic',
  },
  r: {
    AR: 'Aspect ratio AR = b²/S',
    CL: 'Lift coefficient CL',
    CDi: 'Induced drag coefficient CDi',
    e: 'Span efficiency e',
    delta: 'Induced drag factor δ',
    a: 'Wing lift slope a',
    aDeg: 'Wing lift slope a',
    alphaL0Wing: 'Wing zero-lift angle',
    A1: 'First coefficient A₁',
    lift: 'Lift L',
    drag: 'Induced drag Di',
  },
  p: {
    load: 'Spanwise load',
    cl: 'Section lift coefficient',
    y: 'Span station 2y/b',
    loadAxis: 'Load c·cl/(c_mean·CL)',
    clAxis: 'Section cl',
    elliptic: 'Elliptic load',
  },
  s: {
    wgMonoplane:
      'Glauert’s monoplane equation, written at {N} stations across the half span (the wing is symmetric, so ' +
      'only odd terms appear). Aspect ratio AR = b²/S = {AR}.',
    wgA1: 'Solve the linear equations by LU decomposition for the coefficients. The first few are shown.',
    wgCL: 'Wing lift coefficient from the first coefficient.',
    wgDelta: 'Induced drag factor δ from the higher terms, and the span efficiency e.',
    wgCDi: 'Induced drag coefficient.',
    wgSlope: 'Lift slope of the finite wing, compared with the elliptic-wing formula.',
    wgForces: 'Lift and induced drag at dynamic pressure q = {q} Pa.',
  },
  e: {
    taperRange: 'The taper ratio must be between 0 and 1.',
    termsRange: 'Use between 2 and 200 terms.',
    aspectRange: 'The aspect ratio must be at most 100.',
  },
} as const;
