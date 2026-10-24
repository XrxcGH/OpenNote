// The words of the properties tool: fields, choices, results, notes, and the worked step.
export const props = {
  title: 'Water and air properties',
  keywords:
    'properties table water air density viscosity conductivity specific heat prandtl thermal diffusivity ' +
    'expansion coefficient fluid properties lookup',
  field: {
    fluid: 'Fluid',
    temperature: 'Temperature',
    pressure: 'Pressure of the air',
  },
  option: {
    water: 'Liquid water (0 to 100 °C)',
    air: 'Air (250 to 600 K)',
  },
  example: {
    water: 'Water at 20 °C',
    air: 'Air at 300 K and one atmosphere',
  },
  row: {
    density: 'Density, ρ',
    viscosity: 'Dynamic viscosity, μ',
    kinematic: 'Kinematic viscosity, ν',
    conductivity: 'Thermal conductivity, k',
    specificHeat: 'Specific heat, cp',
    diffusivity: 'Thermal diffusivity, α',
    prandtl: 'Prandtl number, Pr',
    expansion: 'Expansion coefficient, β',
  },
  note: {
    water:
      'Saturated liquid water from the standard table, with the density from the Kell formula and β from its ' +
      'slope. Values between table rows are interpolated, so they are good to about a percent.',
    air:
      'Air as an ideal gas at the pressure you give, so ρ = p / (R T) and β = 1/T. The viscosity, conductivity ' +
      'and specific heat are from the standard table at one atmosphere, interpolated between rows; they hardly ' +
      'change with pressure.',
  },
} as const;

export const propsStep = {
  fhPropsTable:
    'The properties of {fluid} at {T} are read from the table, and the kinematic viscosity and Prandtl number follow from them.',
} as const;
