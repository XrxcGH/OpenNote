// The words of the solid mechanics kit's thin-walled structures tool: its form, results, notes, and plot, then
// the wording of its worked steps.
export const thinwalled = {
  title: 'Thin-walled structures',
  keywords:
    'thin-walled shear flow open section closed section multi-cell torsion rate of twist boom idealization ' +
    'stiffened panel wing box shear center Bredt aircraft structures unsymmetric bending',
  field: {
    booms: 'Booms, one to a line',
    walls: 'Walls, one to a line',
    Sx: 'Shear force along x, Sx (optional)',
    Sy: 'Shear force along y, Sy (optional)',
    at: 'Shear forces act',
    xp: 'Line of action, x',
    yp: 'Line of action, y',
    T: 'Torque, T (optional)',
    Mx: 'Moment about x, Mx (optional)',
    My: 'Moment about y, My (optional)',
    G: 'Shear modulus, G (optional)',
  },
  hint: {
    booms: 'Type x y B for each boom: x and y in {length}, and the boom area B in {area}. Booms are numbered from 1.',
    walls:
      'Type i j t for each wall: the two boom numbers it joins, and its thickness in {length}. Add tD, the ' +
      'thickness that carries direct stress, to idealize the skin into the booms.',
  },
  option: { shear: 'Through the shear center', point: 'At a point' },
  example: {
    box: 'Four-boom box, shear through the shear center',
    bredt: 'Single-cell box under a torque',
    twoCell: 'Two-cell box under a torque',
    channel: 'Open channel: shear center',
    skin: 'Stiffened box, skin idealized into the booms, under a moment',
    offset: 'Box with an offset shear and a moment',
  },
  row: {
    xc: 'Centroid, x̄',
    yc: 'Centroid, ȳ',
    Ixx: 'Second moment of the booms, Ixx',
    Iyy: 'Second moment of the booms, Iyy',
    Ixy: 'Product of inertia of the booms, Ixy',
    xSC: 'Shear center, xSC',
    ySC: 'Shear center, ySC',
    qMax: 'Largest shear flow, q',
    tauMax: 'Largest shear stress, q/t',
    Gtheta: 'G times the rate of twist, Gθ′',
    rate: 'Rate of twist, θ′',
    J: 'Torsion constant of the open section, J',
    Tsc: 'Torque about the shear center',
    tauTorsion: 'Largest St Venant shear stress',
  },
  table: { walls: 'Shear flow in each wall', booms: 'Direct stress in each boom', cells: 'Cells' },
  col: {
    wall: 'Wall',
    L: 'Length',
    t: 'Thickness',
    qb: 'Open flow, qb',
    q: 'Shear flow, q',
    tau: 'Shear stress',
    boom: 'Boom',
    x: 'x',
    y: 'y',
    B: 'Area, B',
    sigma: 'Direct stress',
    cell: 'Cell',
    A: 'Enclosed area',
    q0: 'Closing flow, q0',
  },
  note: {
    idealized:
      'The booms carry all the direct stress and the walls carry only shear, constant along each straight wall.',
    signs:
      'x is to the right and y is up. A wall’s flow is positive from its first boom to its second. Mx pulls on ' +
      'the booms at positive y. Torques turn counterclockwise.',
    openSection:
      'The section is open, so its shear flow comes from the booms alone. A torque about the shear center twists ' +
      'it by St Venant torsion, with J = Σ L t³/3.',
    multiCell: 'Every cell twists at the same rate, which with the moments fixes each cell’s closing flow.',
  },
  plot: { centroid: 'Centroid', shear: 'Shear center' },
  picture: 'The section with the shear flow in each wall, the booms, the centroid, and the shear center',
} as const;

export const thinwalledSteps = {
  idealize: 'Idealize the effective skin into the booms, with the stress ratio from the bending moment.',
  idealizeShear: 'Idealize the effective skin into the booms, with the stress ratio from the moment the shear sets up.',
  idealized: 'These are the boom areas, worked out again until they settle, used from here on.',
  centroid: 'Find the centroid of the boom areas.',
  inertia: 'Find the second moments of the boom areas about the centroid.',
  direct: 'The bending moments give each boom its direct stress.',
  cut: 'Cut each closed cell at one wall to make the section open. The cut walls are {walls}.',
  open: 'Walk round the open section: at each boom, the flow out less the flow in balances the boom’s load.',
  twist: 'Each cell twists at the same rate, which gives one equation per cell.',
  moment: 'The shear flows’ moment about the origin equals the loads’ moment about it.',
  solve: 'Solve these equations for the closing flow of each cell and the rate of twist.',
  openTwist: 'An open section carries a torque about its shear center by St Venant torsion.',
  center: 'The shear center is where a shear force makes the section bend without twisting.',
} as const;
