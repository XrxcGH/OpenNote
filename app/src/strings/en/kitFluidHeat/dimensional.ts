// The words of the dimensional tool: fields, choices, results, notes, and worked steps.
export const dimensional = {
  title: 'Dimensional analysis and similitude',
  keywords:
    'dimensional analysis buckingham pi groups repeating variables dimensionless reynolds froude ' +
    'mach weber similitude similarity model prototype scaling',
  field: {
    mode: 'Problem',
    variables: 'Variables, one per line',
    repeating: 'Repeating variables (optional, separated by commas)',
    criterion: 'Match the model and prototype by',
    lengthRatio: 'Model length divided by prototype length, Lm/Lp',
    prototypeSpeed: 'Prototype speed, Vp',
    nuPrototype: 'Prototype kinematic viscosity, νp',
    nuModel: 'Model kinematic viscosity, νm',
    aPrototype: 'Prototype speed of sound, ap',
    aModel: 'Model speed of sound, am',
    rhoPrototype: 'Prototype fluid density (optional, for the force ratio)',
    rhoModel: 'Model fluid density (optional, for the force ratio)',
    modelForce: 'Force measured on the model (optional)',
  },
  option: {
    groups: 'Dimensionless groups (Buckingham pi)',
    scale: 'Model and prototype scaling',
    reynolds: 'Reynolds number',
    froude: 'Froude number',
    mach: 'Mach number',
  },
  hint: {
    variables:
      'Each line is a symbol, a comma, and its unit, such as V, m/s. The first line is the dependent ' +
      'variable (the answer the others determine). A symbol such as rho, mu, D, V, or g lets the tool ' +
      'name well-known groups.',
    repeating:
      'Leave this empty to let the tool choose. To choose, list as many variables as the rank, such as D, V, rho.',
  },
  example: {
    sphere: 'Drag on a sphere',
    pipe: 'Pressure drop in a pipe',
    pendulum: 'Period of a pendulum',
    car: 'A car model tested in water at matched Reynolds number',
    ship: 'A ship model at matched Froude number',
  },
  row: {
    groups: 'Dimensionless groups',
    rank: 'Rank of the dimension matrix',
    count: 'Number of groups, n − rank',
    repeating: 'Repeating variables',
    modelSpeed: 'Model speed, Vm',
    speedRatio: 'Speed ratio, Vm/Vp',
    forceRatio: 'Force ratio, Fm/Fp',
    timeRatio: 'Time ratio, tm/tp',
    prototypeForce: 'Prototype force, Fp',
  },
  table: { groups: 'Dimensionless groups' },
  col: { group: 'Group', expression: 'Expression', name: 'Name' },
  named: {
    reynolds: 'Reynolds number',
    reynoldsKin: 'Reynolds number',
    froude: 'Froude number',
    mach: 'Mach number',
    weber: 'Weber number',
    euler: 'Euler number (pressure coefficient)',
    strouhal: 'Strouhal number',
  },
  note: {
    buckingham:
      'The number of groups is the number of variables minus the rank of the dimension matrix. Each ' +
      'group contains one variable that is not repeating.',
    choice:
      'Another choice of repeating variables gives another, equally correct, set of groups. They are ' +
      'products and quotients of each other.',
    similarity: 'The model is dynamically similar to the prototype when the chosen group matches.',
    reynolds:
      'Matching Reynolds number in a different fluid can need a high model speed. Check that the ' +
      'model speed is practical and the flow stays incompressible.',
  },
} as const;

export const dimensionalStep = {
  fhDimMatrix:
    'Write the dimensions of the {n} variables in terms of {k} base dimensions (L length, M mass, T ' +
    'time, Θ temperature).',
  fhDimRank: 'The dimension matrix has rank {r}, so there are {n} − {r} = {p} dimensionless groups.',
  fhDimRepeating: 'Use {list} as the repeating variables.',
  fhDimGroup:
    'Group {i}: multiply one remaining variable by powers of the repeating variables until the dimensions cancel.',
  fhDimScaleRe: 'Matching the Reynolds number gives a model speed of {v} m/s.',
  fhDimScaleFr: 'Matching the Froude number gives a model speed of {v} m/s.',
  fhDimScaleMa: 'Matching the Mach number gives a model speed of {v} m/s.',
  fhDimScaleForce: 'Force scales as density × speed² × length²: Fm/Fp = {f}, and times scale by {t}.',
  fhDimScaleProto: 'The prototype force is the model force divided by the force ratio: Fp = {f} N.',
} as const;
