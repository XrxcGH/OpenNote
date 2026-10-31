// Airfoils: the tool's labels, results, plots, and worked steps (kitAero.t.airfoil).
export const airfoil = {
  title: 'Airfoils',
  short: 'Airfoil',
  keywords:
    'airfoil aerofoil naca four digit five digit 2412 0012 23012 camber line thickness thin airfoil theory ' +
    'zero lift angle quarter chord moment vortex panel method kutta condition pressure coefficient cp ' +
    'stagnation point section coordinates',
  about:
    'NACA four- and five-digit sections: their coordinates, thin airfoil theory for the zero-lift angle, lift, ' +
    'and moment, and a vortex panel method for the pressure distribution.',
  assume:
    'Two-dimensional, incompressible, inviscid flow, so there is no stall and no drag. Thin airfoil theory ' +
    'keeps only the camber line and small angles; the panel method keeps the thickness. Coefficients are per ' +
    'unit chord, angles are in degrees, and the moment is about the quarter chord, nose up positive. A closed ' +
    'trailing edge changes the last thickness coefficient from 0.1015 to 0.1036.',
  f: {
    shape: 'Section',
    code: 'NACA designation',
    m: 'Maximum camber m, fraction of chord',
    p: 'Position of maximum camber p, fraction of chord',
    t: 'Maximum thickness t, fraction of chord',
    te: 'Trailing edge',
    alpha: 'Angle of attack α',
    panels: 'Number of panels N',
  },
  h: {
    code: 'Four digits, such as 2412, or five, such as 23012. 0000 is a flat plate.',
    te: 'The panel method needs a closed trailing edge; an open one leaves a gap that disturbs the pressures there.',
    panels: 'An even number from 20 to 400, spaced closer at the nose and tail. Doubling it changes little.',
  },
  o: {
    naca: 'NACA designation',
    custom: 'Camber and thickness',
    closed: 'Closed',
    open: 'Open (as tabulated)',
  },
  r: {
    clThin: 'Lift coefficient cl, thin airfoil theory',
    alphaL0: 'Zero-lift angle αL=0',
    cmThin: 'Moment coefficient cm,c/4, thin airfoil theory',
    clPanel: 'Lift coefficient cl, panel method',
    clPressure: 'cl from integrating the pressures',
    cmPanel: 'Moment coefficient cm,c/4, panel method',
    cpMin: 'Lowest pressure coefficient Cp,min',
    cpMinAt: 'Where Cp is lowest, x/c',
    stagnation: 'Stagnation point',
    alphaIdeal: 'Ideal angle of attack αi',
    A0: 'Coefficient A₀',
    A1: 'Coefficient A₁',
    A2: 'Coefficient A₂',
    cmLE: 'Moment coefficient about the leading edge cm,LE',
    xcp: 'Center of pressure xcp/c',
    t: 'Thickness t/c',
    m: 'Maximum camber m/c',
    p: 'Position of maximum camber p/c',
    cli: 'Design lift coefficient cli',
  },
  w: {
    lower: 'x/c = {x}, on the lower surface',
    upper: 'x/c = {x}, on the upper surface',
  },
  tb: {
    coords: 'Coordinates per unit chord',
    x: 'Station x/c',
    xU: 'Upper x',
    yU: 'Upper y',
    xL: 'Lower x',
    yL: 'Lower y',
  },
  p: {
    section: 'Section',
    cp: 'Pressure coefficient',
    x: 'x/c',
    y: 'y/c',
    cpAxis: 'Cp (negative up)',
    outline: 'Surface',
    camber: 'Camber line',
    upper: 'Upper surface',
    lower: 'Lower surface',
  },
  n: {
    section: '{name}',
    noThickness: 'A section with no thickness has no surface for panels, so only thin airfoil theory is shown.',
    highAlpha: 'Beyond about 15° a real airfoil stalls; these inviscid results keep rising.',
    reflex: 'A reflexed camber line turns up near the tail so the quarter-chord moment is close to zero.',
  },
  s: {
    afSection:
      '{name}: thickness t = {t}, maximum camber m = {m} at p = {p}. The half thickness is laid off normal to ' +
      'the camber line: y_t = 5t(0.2969√x − 0.1260x − 0.3516x² + 0.2843x³ − {a4}x⁴).',
    afSlopeFlat: 'The camber line is straight, so its slope is zero everywhere.',
    afSlopeFour: 'Slope of the four-digit camber line (two parabolas meeting at x = p), with m = {m}, p = {p}.',
    afSlopeFive:
      'Slope of the five-digit camber line (a cubic to x = r, then straight), with r = {r} and k₁ scaled to the ' +
      'design lift coefficient {cli}.',
    afSlopeReflex:
      'The reflexed five-digit camber line is a cubic on each side of x = r = {r}, scaled to the design lift ' +
      'coefficient {cli}; its slope goes into the same integrals.',
    afTheta: 'Change variable so the integrals run over θ from 0 at the nose to π at the tail.',
    afThetaKink:
      'Change variable so the integrals run over θ from 0 at the nose to π at the tail. The slope’s formula ' +
      'changes at θ = {thetaK}°, so each integral is split there.',
    afAlphaL0: 'Zero-lift angle.',
    afCoefficients: 'Fourier coefficients of the vortex sheet, at α = {alpha} rad.',
    afCl: 'Lift coefficient: a lift slope of 2π per radian.',
    afCm: 'Moment about the quarter chord, which does not depend on α.',
    afPanel:
      '{N} panels with linearly varying vortex strength: flow tangency at each midpoint and the Kutta ' +
      'condition give {N1} linear equations, solved by LU decomposition.',
    afPanelCl:
      'Lift from the total circulation (Kutta–Joukowski). Integrating the pressures gives {clP}, a check on the ' +
      'panelling.',
    afCp: 'Pressure coefficient from the surface speed. Lowest Cp = {cpMin} at x/c = {at}; stagnation at x/c = {stag}.',
  },
  e: {
    nacaCode: '“{code}” is not an NACA four- or five-digit designation. Type digits such as 2412 or 23012.',
    camberAtNose:
      'A cambered four-digit section needs its maximum camber behind the nose: the second digit cannot be 0.',
    positionWithoutCamber: 'With no camber (first digit 0), the second digit must be 0 too.',
    fiveDigitLift: 'The first digit of a five-digit section sets the design lift and cannot be 0.',
    fiveDigitLine:
      'NACA defined the five-digit camber lines 210 to 250 and the reflexed 221 to 251; {code} is not one.',
    thicknessRange: 'The thickness must be between 0 and 0.4 of the chord.',
    camberRange: 'The maximum camber must be between 0 and 0.1 of the chord.',
    positionRange: 'The position of maximum camber must be between 0 and 1, not at either end.',
    panelCount: 'Use an even number of panels from 20 to 400.',
    panelDegenerate: 'Two panel corners coincide; the section is too thin at the tail for panels.',
  },
} as const;
