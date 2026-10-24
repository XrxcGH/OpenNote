// The words of the solid mechanics kit's composite laminates tool: its form, results, notes, and
// plot, then the wording of its worked steps.
export const composites = {
  title: 'Composite laminates',
  keywords:
    'composite laminate classical lamination theory CLT orthotropic lamina ply reduced stiffness Q transformed ' +
    'Q-bar ABD matrix layup symmetric balanced cross-ply angle-ply Tsai-Wu Tsai-Hill maximum stress first ply failure',
  field: {
    E1: 'Modulus along the fibers, E1',
    E2: 'Modulus across the fibers, E2',
    nu12: "Major Poisson's ratio, ν12",
    G12: 'In-plane shear modulus, G12',
    t: 'Ply thickness, t',
    layup: 'Layup, from ply 1',
    Nx: 'Force per width, Nx (optional)',
    Ny: 'Force per width, Ny (optional)',
    Nxy: 'Shear force per width, Nxy (optional)',
    Mx: 'Moment per width, Mx (optional)',
    My: 'Moment per width, My (optional)',
    Mxy: 'Twisting moment per width, Mxy (optional)',
    Xt: 'Tensile strength along the fibers, Xt (optional)',
    Xc: 'Compressive strength along the fibers, Xc (optional)',
    Yt: 'Tensile strength across the fibers, Yt (optional)',
    Yc: 'Compressive strength across the fibers, Yc (optional)',
    S: 'In-plane shear strength, S (optional)',
  },
  hint: {
    layup:
      'Type the ply angles in degrees, such as 0 90 90 0, [0/90]s, [±45/0]2s, or [0/45/-45/90]s. s mirrors ' +
      'the plies, and a number before it repeats them.',
  },
  example: {
    crossPly: 'Cross-ply [0/90]s under Nx',
    angle: 'Angle-ply [±30]s under Nx',
    quasi: 'Quasi-isotropic, with strengths: first-ply failure',
    bent: 'Unsymmetric [0/90] under a moment',
  },
  row: {
    Q11: 'Reduced stiffness, Q11',
    Q12: 'Reduced stiffness, Q12',
    Q22: 'Reduced stiffness, Q22',
    Q66: 'Reduced stiffness, Q66',
    h: 'Laminate thickness, h',
    Ex: 'Laminate modulus, Ex',
    Ey: 'Laminate modulus, Ey',
    Gxy: 'Laminate shear modulus, Gxy',
    nuxy: "Laminate Poisson's ratio, νxy",
    ex: 'Mid-plane strain, εx⁰',
    ey: 'Mid-plane strain, εy⁰',
    gxy: 'Mid-plane shear strain, γxy⁰',
    kx: 'Curvature, κx',
    ky: 'Curvature, κy',
    kxy: 'Twist curvature, κxy',
    ratio: 'Strength ratio by Tsai–Wu, R',
    firstPly: 'Ply that fails first',
    ratioMax: 'Strength ratio by maximum stress',
    ratioHill: 'Strength ratio by Tsai–Hill',
  },
  table: {
    qbar: 'Transformed stiffness of each ply, Q̄',
    A: 'Extensional stiffness, A',
    B: 'Coupling stiffness, B',
    D: 'Bending stiffness, D',
    faces: 'Stresses at the faces of each ply',
  },
  col: {
    ply: 'Ply',
    theta: 'Angle',
    Q11: 'Q̄11',
    Q12: 'Q̄12',
    Q16: 'Q̄16',
    Q22: 'Q̄22',
    Q26: 'Q̄26',
    Q66: 'Q̄66',
    ij: 'Row',
    c1: '1',
    c2: '2',
    c6: '6',
    z: 'z',
    sx: 'σx',
    sy: 'σy',
    txy: 'τxy',
    s1: 'σ1',
    s2: 'σ2',
    t12: 'τ12',
    maxStress: 'Maximum stress index',
    tsaiHill: 'Tsai–Hill index',
    tsaiWu: 'Tsai–Wu index',
  },
  note: {
    axes:
      'Ply angles turn counterclockwise from x to the fibers. 1 is along the fibers and 2 across them. Each ply ' +
      'is in plane stress.',
    plies: 'z runs from −h/2 at the face of ply 1 to +h/2 at the face of the last ply.',
    moments: 'Loads are per unit width, so a moment per width is in force units.',
    failure:
      'R is the factor on every load that brings the first ply to failure. Tsai–Wu uses F12 = −½√(F11 F22), ' +
      'and an index of 1 means failure.',
  },
  plot: { stress: 'Stress in laminate axes', z: 'Through the thickness, z', sx: 'σx', sy: 'σy' },
  picture: 'The stresses in the laminate axes through the thickness',
} as const;

export const compositesSteps = {
  Q: 'Find the reduced stiffness of the ply in its material axes.',
  Qbar: 'Turn each ply’s stiffness into the laminate axes by its angle.',
  ABD: 'Sum each ply’s Q̄ through the thickness for A, B, and D.',
  sums: 'For this layup, the first terms of A, B, and D are these.',
  invert: 'Invert the ABD matrix against the loads for the mid-plane strains.',
  curvature: 'The same inversion gives the curvatures.',
  plyStress: 'Each ply’s stresses come from its Q̄ and the strains at its faces, then turn into its own axes.',
} as const;
