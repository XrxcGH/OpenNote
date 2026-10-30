// The words of the conduction tool: fields, choices, results, notes, and worked steps.
export const conduction = {
  title: 'Conduction and thermal circuits',
  keywords:
    'conduction thermal resistance circuit composite wall cylinder sphere insulation critical ' +
    'radius contact resistance heat generation fourier law overall coefficient',
  field: {
    mode: 'Problem',
    geometry: 'Shape',
    geometryShell: 'Shape',
    area: 'Wall area, A',
    cylinderLength: 'Cylinder length, L',
    innerRadius: 'Inner radius',
    layers: 'Layers from the inside out, one per line',
    tInner: 'Inside fluid (or surface) temperature',
    tOuter: 'Outside fluid (or surface) temperature',
    hInner: 'Inside heat transfer coefficient (empty if the surface temperature is given)',
    hOuter: 'Outside heat transfer coefficient (empty if the surface temperature is given)',
    size: 'Half thickness of the wall, or radius of the cylinder or sphere',
    k: 'Thermal conductivity, k',
    h: 'Outside heat transfer coefficient, h',
    hGen: 'Heat transfer coefficient to the fluid (optional)',
    qGen: 'Heat generated per volume, q‴',
    tSurfaceGen: 'Surface temperature (optional, used in place of the coefficient and the fluid temperature)',
    tFluidGen: 'Fluid temperature (with h)',
    emissivity: 'Emissivity, ε',
    tSurface: 'Surface temperature',
    tSurroundings: 'Temperature of the surroundings',
  },
  option: {
    wall: 'Layered wall, tube, or shell (thermal circuit)',
    critical: 'Critical radius of insulation',
    generation: 'Conduction with heat generation',
    radiation: 'Linearized radiation coefficient',
    plane: 'Plane wall',
    cylinder: 'Cylinder (long)',
    sphere: 'Sphere',
  },
  hint: {
    layers:
      'Each line is the thickness (or the outer radius for a cylinder or sphere), the conductivity, ' +
      'and the contact resistance to the next layer (0 for none), such as 200 mm, 0.72 W/(m·K), 0. A ' +
      'bare number is in mm, W/(m·K), and m²·K/W for SI.',
  },
  example: {
    wall: 'A brick wall with insulation',
    pipe: 'An insulated pipe',
    critical: 'Insulation on a small pipe',
    wire: 'A wire heated by current',
    radiation: 'A 400 K surface radiating to 300 K surroundings',
  },
  row: {
    heat: 'Heat transfer rate, q',
    resistance: 'Total thermal resistance, Rtot',
    flux: 'Heat flux at the inner surface',
    radius: 'Critical radius, rcr',
    tMax: 'Largest temperature, Tmax',
    tSurface: 'Surface temperature, Ts',
    rise: 'Temperature rise from the surface to the center',
    hr: 'Radiation coefficient, hr',
  },
  table: { network: 'The thermal circuit, element by element' },
  col: { element: 'Element', resistance: 'Resistance', temperature: 'Temperature at its start' },
  note: {
    network: 'Steady one-dimensional conduction with constant conductivities, so the resistances add in series.',
    curved:
      'For a cylinder or sphere the heat flux depends on the radius, so the heat rate q is the constant quantity.',
    critical:
      'Below the critical radius, adding insulation increases the heat loss. Above it, insulation ' +
      'reduces the heat loss.',
    generation: 'Uniform heat generation with steady conduction. A plane wall is cooled on both faces.',
    radiation:
      'Radiation is linearized as hr (Ts − T∞) with absolute temperatures, which is accurate for ' +
      'small temperature differences.',
  },
  plot: { position: 'Position', temperature: 'Temperature', profile: 'Temperature profile' },
  picture: 'The temperature profile through the solid',
} as const;

export const conductionStep = {
  fhCondConv: 'The {name} convection resistance is {R} K/W.',
  fhCondContact: 'The {name} contact resistance is {R} K/W.',
  fhCondLayer: 'The conduction resistance of {name} is {R} K/W.',
  fhCondTotal: 'The resistances add in series to Rtot = {R} K/W.',
  fhCondRate: 'The heat transfer rate is the temperature difference over the total resistance: q = {q} W.',
  fhCondNode: 'The temperature at node {n} is {T}.',
  fhCondCritical: 'The critical radius of insulation is rcr = {r} m.',
  fhCondGeneration: 'The center is {dT} hotter than the surface, at Tmax = {Tmax}.',
  fhCondRadiation: 'The linearized radiation coefficient is hr = {h} W/(m²·K).',
} as const;
