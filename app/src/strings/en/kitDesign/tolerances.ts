// checks-disable-file length: messages are full sentences kept on one line

// The words of the design kit's tolerances tool: its form, results, notes, and plot, the wording of its worked steps,
// and its error messages.
export const tolerances = {
  title: 'Tolerances and fits',
  keywords:
    'tolerance stack-up worst case root sum square rss monte carlo fit clearance interference position gd&t drafting',
  about:
    'Stack up a chain of dimensions, check a hole and shaft fit, or test a feature’s true position. Type lengths in one unit and read the answers in the same unit.',
  field: {
    mode: 'What to work out',
    items: 'Dimensions in the chain',
    unit: 'Length unit of the chain',
    dist: 'Distribution for the Monte Carlo run',
    runs: 'Monte Carlo runs',
    seed: 'Random seed',
    lo: 'Lower limit on the gap (optional)',
    hi: 'Upper limit on the gap (optional)',
    holeMin: 'Hole, smallest size',
    holeMax: 'Hole, largest size',
    shaftMin: 'Shaft, smallest size',
    shaftMax: 'Shaft, largest size',
    dx: 'Offset in x from the true position',
    dy: 'Offset in y from the true position',
    tolerance: 'Position tolerance (zone diameter)',
    modifier: 'Material condition modifier',
    departure: 'How far the feature size is from the modified condition',
  },
  option: {
    stack: 'Stack-up of a chain of dimensions',
    fit: 'Fit of a hole and a shaft',
    position: 'True position of a feature',
    mm: 'Millimeters',
    in: 'Inches',
    uniform: 'Uniform: any size in the band is equally likely',
    normal: 'Normal: the band is plus and minus three standard deviations',
    RFS: 'RFS: regardless of feature size, no bonus',
    MMC: 'MMC: at maximum material condition',
    LMC: 'LMC: at least material condition',
  },
  hint: {
    items:
      'One dimension per line: a sign (+ adds to the gap, − takes from it), the nominal size, the tolerance, and a name. Write the tolerance as ±0.1, as +0.2/−0.05, or as a bare 0.1 for ±0.1.',
  },
  example: {
    gap: 'Gap between a housing and a shaft',
    slide: 'Sliding fit, 25 mm (H7 hole, g6 shaft)',
    press: 'Press fit, 25 mm (H7 hole, s6 shaft)',
    hole: 'Hole position at maximum material',
  },
  row: {
    nominal: 'Nominal gap',
    worstMax: 'Largest gap, worst case',
    worstMin: 'Smallest gap, worst case',
    rssMean: 'Mean gap, root sum square',
    rss: 'Root sum square tolerance, ±',
    rssMax: 'Largest gap, root sum square',
    rssMin: 'Smallest gap, root sum square',
    mcMean: 'Mean gap, Monte Carlo',
    mcSd: 'Standard deviation, Monte Carlo',
    mcMin: 'Smallest gap in the run',
    mcMax: 'Largest gap in the run',
    inside: 'Assemblies inside the limits, Monte Carlo',
    worstFits: 'Worst case stays inside the limits',
    fitKind: 'Kind of fit',
    maxClearance: 'Largest clearance',
    minClearance: 'Smallest clearance (negative is interference)',
    position: 'Position error, zone diameter used',
    bonus: 'Bonus tolerance',
    allowed: 'Tolerance allowed',
    verdict: 'Result',
  },
  word: {
    clearance: 'Clearance fit',
    transition: 'Transition fit',
    interference: 'Interference fit',
    pass: 'Pass',
    fail: 'Fail',
    yes: 'Yes',
    no: 'No',
  },
  table: { share: 'Share of each dimension in the variation' },
  col: { name: 'Dimension', worst: 'Worst case share', rss: 'Root sum square share' },
  note: {
    stack:
      'The sign of each dimension says whether it adds to the gap or takes from it. Worst case adds every tolerance in the direction that opens or closes the gap.',
    rssNormal:
      'Root sum square treats each tolerance as a spread of independent, centered errors, so it is tighter than worst case and is a statistical estimate, not a guarantee.',
    mc: 'The Monte Carlo run draws every dimension at random and repeats with a fixed seed, so the same inputs give the same answer.',
    fit: 'Limits are the sizes you type; no standard table of fits is built in. Clearance is hole minus shaft: a negative value is interference.',
    noTables: 'Check a standard such as ISO 286 for the limits of a named fit like H7/g6.',
    position:
      'The zone diameter used is twice the distance from the true position. At MMC or LMC the allowed zone grows by the bonus, which you enter as how far the feature size is from that condition.',
  },
  plot: {
    histogram: {
      x: 'Gap',
      y: 'Assemblies',
      alt: 'Histogram of the gap over all the Monte Carlo runs, with the limits marked.',
    },
  },
};

export const tolerancesSteps = {
  nominal: 'Add each dimension with its sign to get the nominal gap.',
  worst: 'Worst case: add every tolerance in the direction that moves the gap furthest.',
  rss: 'Root sum square: the square root of the sum of the squared half-bands.',
  maxClearance: 'The largest clearance is the largest hole minus the smallest shaft.',
  minClearance: 'The smallest clearance is the smallest hole minus the largest shaft.',
  position: 'The position error is the diameter of the zone around the true position that the feature uses.',
  allowed: 'The tolerance allowed is the stated tolerance plus the bonus.',
};

export const tolerancesErrors = {
  stackEmpty: 'Add at least one dimension to the chain.',
  negativeTolerance: 'A tolerance cannot be negative. Write the plus and minus parts as positive numbers.',
  chainLine:
    'Line {detail} of the chain could not be read. Write a sign, the nominal size, the tolerance, and a name, such as + 25.4 ±0.1 housing.',
  runsRange: 'The number of runs must be a whole number from 10 to 1,000,000.',
  sizePositive: 'Sizes must be greater than zero.',
  limitsOrder: 'A smallest size or lower limit cannot be larger than the largest size or upper limit.',
  tolerancePositive: 'The position tolerance must be greater than zero.',
  departureNegative: 'The departure from the modified condition cannot be negative.',
};
