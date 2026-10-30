// checks-disable-file length: messages are full sentences kept on one line

// The words of the design kit's micro and nano fabrication tool: its form, results, notes, and the wording of its worked
// steps. Its error messages are in errors.ts, with the other tools'.
export const microfab = {
  title: 'Micro and nano fabrication',
  keywords:
    'microfabrication nanofabrication lithography resolution depth of focus etch anisotropy selectivity stoney film stress wafer bow evaporation thin film dies per wafer yield defect density binding langmuir kinetics biosensor semiconductor',
  about:
    'Estimate what a process step can resolve or deposit, how much stress a thin film puts on a wafer, how many dies fit on a wafer and how many work, or how molecules bind to a surface. These are first estimates from standard formulas.',
  field: {
    mode: 'What to work out',
    wavelength: 'Wavelength of the light',
    na: 'Numerical aperture',
    k1: 'Resolution factor k₁',
    k2: 'Focus factor k₂',
    vertical: 'Vertical etch rate',
    lateral: 'Lateral etch rate',
    time: 'Etch time',
    mask: 'Etch rate of the mask or the layer below (optional)',
    es: 'Young’s modulus of the substrate',
    nus: 'Poisson’s ratio of the substrate',
    hs: 'Substrate thickness',
    hf: 'Film thickness',
    radius: 'Radius of curvature of the wafer (negative when bowed the other way)',
    mass: 'Mass of the evaporated material',
    density: 'Density of the film',
    height: 'Height of the substrate above the source',
    offset: 'Sideways offset of the point on the substrate',
    diameter: 'Wafer diameter',
    dieArea: 'Area of one die',
    edge: 'Edge exclusion',
    model: 'Yield model',
    dieAreaCm: 'Area of one die',
    defects: 'Defect density',
    kind: 'Find',
    kon: 'Association rate constant',
    koff: 'Dissociation rate constant',
    conc: 'Concentration of the molecule in solution',
    kd: 'Dissociation constant',
    bindTime: 'Time since the molecule was added',
  },
  option: {
    litho: 'Lithography resolution and depth of focus',
    etch: 'Etch depth, undercut, and selectivity',
    stoney: 'Film stress from wafer bow (Stoney)',
    evaporation: 'Thickness of an evaporated film',
    dies: 'Dies per wafer',
    yield: 'Die yield from defect density',
    binding: 'Binding to a surface (Langmuir)',
    poisson: 'Poisson: defects land at random',
    murphy: 'Murphy: defect density varies across the wafer',
    seeds: 'Seeds: defects cluster',
    kinetics: 'Binding over time',
    equilibrium: 'Fraction bound at equilibrium',
  },
  example: {
    litho: '193 nm immersion lithography at NA 1.35',
    etch: 'A 3 minute etch with a lateral rate of one fifth',
    stoney: 'A 1 µm film on a 500 µm silicon wafer',
    wafer: 'A 100 mm² die on a 300 mm wafer',
    yield: 'A 1 cm² die at 0.5 defects per cm², Murphy model',
    sensor: 'A sensor surface with a 0.1 µM molecule',
  },
  row: {
    resolution: 'Smallest feature, resolution',
    dof: 'Depth of focus',
    depth: 'Etch depth',
    undercut: 'Undercut under the mask',
    anisotropy: 'Anisotropy, 1 is perfectly vertical',
    selectivity: 'Selectivity over the mask',
    stress: 'Film stress',
    center: 'Thickness directly above the source',
    at: 'Thickness at the offset',
    dies: 'Dies on the wafer',
    yield: 'Yield, working dies',
    theta: 'Fraction of sites bound',
    kd: 'Dissociation constant',
    kobs: 'Observed rate constant',
    t95: 'Time to reach 95 percent of equilibrium',
  },
  note: {
    noMask: 'The mask etch rate is zero, so the selectivity is not defined and is left out.',
    litho:
      'The factors are set by the process, often about 0.25 to 0.6 for k₁ and about 1 for k₂. They are inputs here, not looked up.',
    etch: 'The rates must use the same length and time units, and the depth is the vertical rate times the time. Anisotropy is one minus the lateral over the vertical rate.',
    stoney:
      'Stoney’s equation holds for a film much thinner than the substrate. A positive radius gives tensile stress in this sign convention, a negative one compressive.',
    evaporation:
      'The film thickness follows the cosine law for a small surface source, with a flat substrate facing the source. It ignores the source’s own shape and any shadowing.',
    wafer:
      'The count is the area ratio less a loss around the edge, a common first estimate that ignores the scribe lanes and the notch.',
    yield:
      'The yield models give the fraction of dies free of killer defects. They do not include yield lost to other causes.',
    binding:
      'One kind of site and no depletion of the solution are assumed, so the fraction bound follows a single exponential toward equilibrium.',
  },
};

export const microfabSteps = {
  resolution: 'Smallest printable feature from the wavelength and the aperture.',
  dof: 'Depth of focus from the wavelength and the aperture.',
  depth: 'Etch depth from the vertical rate and the time.',
  undercut: 'Undercut from the lateral rate and the time.',
  anisotropy: 'Anisotropy from the ratio of the rates.',
  selectivity: 'Selectivity as the ratio of the etch rates.',
  center: 'Thickness directly above the source.',
  at: 'Thickness at the offset.',
  dies: 'Dies per wafer from the area ratio less the edge loss.',
  yield: 'Yield from the defect density and the die area.',
  theta: 'Fraction of sites bound.',
  kd: 'Dissociation constant from the two rate constants.',
  kobs: 'Observed rate constant at this concentration.',
};
