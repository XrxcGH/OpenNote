// The civil, environmental, and chemical engineering kit (owner: the civil lane). The window's own words are here;
// each tool's labels, results, and worked steps are in a file of their own under ./kitCivil, all in this namespace.
import { foundations } from './kitCivil/foundations';
import { hydraulics } from './kitCivil/hydraulics';
import { groundwater } from './kitCivil/groundwater';
import { processTool } from './kitCivil/process';
import { reactors } from './kitCivil/reactors';
import { soils } from './kitCivil/soils';
import { structures } from './kitCivil/structures';
import { water } from './kitCivil/water';

export const kitCivil = {
  title: 'Civil and chemical engineering',
  common: {
    tool: 'Tool',
    calculation: 'Calculation',
    loading: 'Loading the calculations…',
    unitFor: 'Unit for {name}',
    columns: 'One row per line, with the columns {columns}.',
    optional: 'Optional',
    steps: 'Worked steps',
    results: 'Results',
    quantity: 'Quantity',
    value: 'Value',
    unit: 'Unit',
    source: 'Source: {source}',
    insertAnswer: 'Insert answer',
    insertMore: 'More ways to insert',
    insertSteps: 'Answer with worked steps',
    insertTable: 'Result table',
    insertLatex: 'Equation in LaTeX',
    insertGrid: 'Data table',
    insertPicture: 'Picture of the plot',
    inserted: 'Added to the page.',
    noPage: 'Click in a page first, then insert.',
    pictureFailed: 'The plot could not be made into a picture.',
    plotDescription: '{title}: {y} against {x}. Series: {series}.',
  },
  errors: {
    failed: 'This calculation could not finish with these numbers.',
    empty: 'Enter a value for {field}.',
    notNumber: '{field} needs a number, such as 2.5 or 1e-4.',
    row: 'Row {row} of {field} needs {count} numbers.',
    rows: '{field} needs at least {count} rows.',
    noRows: 'Add at least 1 row.',
    positive: '{name} must be greater than 0.',
    nonNegative: '{name} cannot be negative.',
    fraction: '{name} must be more than 0 and at most 1.',
    noRoot: 'No solution lies in the range searched. Check the inputs.',
    noConvergence: 'The calculation did not settle on an answer. Check the inputs.',
    singular: 'These equations have no single solution. Check that the inputs are independent.',
    fewPoints: 'At least {count} data points are needed.',
    sameX: 'The points all have the same x value, so no line fits them.',
  },
  tools: {
    indeterminate: {
      title: 'Indeterminate structures and influence lines',
      open: 'Open indeterminate structures and influence lines',
      keywords:
        'structural analysis indeterminate continuous beam moment distribution hardy cross slope deflection ' +
        'fixed end moments influence line muller breslau moving loads axle train absolute maximum moment truss ' +
        'portal method cantilever method lateral loads response spectrum newmark earthquake srss cqc',
    },
    hydraulics: {
      title: 'Hydrology and open channels',
      open: 'Open hydrology and open channels',
      keywords:
        'hydrology hydraulics rainfall runoff rational method idf time of concentration kirpich curve number ' +
        'nrcs scs tr-55 unit hydrograph s-curve flood routing muskingum reservoir puls detention basin flood ' +
        'frequency gumbel log pearson return period risk usle erosion open channel manning normal depth ' +
        'critical depth specific energy froude hydraulic jump gradually varied flow weir orifice hardy cross',
    },
    process: {
      title: 'Material balances and separations',
      open: 'Open material balances and separations',
      keywords:
        'chemical engineering process material balance mass balance mixer splitter separator recycle purge ' +
        'bypass degrees of freedom energy balance heat of reaction vapor liquid equilibrium raoult antoine ' +
        'bubble point dew point margules van laar wilson flash rachford rice distillation mccabe thiele ' +
        'fenske underwood gilliland absorption stripping kremser',
    },
    reactors: {
      title: 'Chemical and biological reactors',
      open: 'Open chemical and biological reactors',
      keywords:
        'reaction engineering reactor design cstr pfr plug flow batch conversion space time levenspiel ' +
        'tanks in series recycle series parallel reactions selectivity yield adiabatic arrhenius activation ' +
        'energy steady states residence time distribution tracer dispersion segregation monod chemostat ' +
        'washout fed batch oxygen transfer kla activated sludge srt f/m',
    },
    soils: {
      title: 'Soil properties, consolidation, and strength',
      open: 'Open soil properties, consolidation, and strength',
      keywords:
        'soil mechanics geotechnical phase relations void ratio porosity water content unit weight sieve ' +
        'hydrometer grain size atterberg limits plasticity uscs aashto classification proctor compaction ' +
        'permeability falling head effective stress boussinesq newmark consolidation settlement time factor ' +
        'casagrande taylor preconsolidation mohr circle triaxial direct shear skempton',
    },
    water: {
      title: 'Water quality and treatment',
      open: 'Open water quality and treatment',
      keywords:
        'water quality treatment wastewater bod oxygen sag streeter phelps dissolved oxygen saturation carbonate ' +
        'alkalinity ph langelier ryznar hardness softening lime soda stokes settling sedimentation filter headloss ' +
        'carman kozeny ergun disinfection chick watson ct membrane osmotic pressure flux rejection',
    },
    foundations: {
      title: 'Earth pressure, foundations, and slopes',
      open: 'Open earth pressure, foundations, and slopes',
      keywords:
        'geotechnical foundation engineering lateral earth pressure rankine coulomb retaining wall cantilever ' +
        'gravity overturning sliding bearing capacity terzaghi meyerhof hansen vesic footing slope stability ' +
        'infinite slope culmann method of slices bishop fellenius pile skin friction alpha beta end bearing ' +
        'group efficiency converse labarre',
    },
    groundwater: {
      title: 'Groundwater and wells',
      open: 'Open groundwater and wells',
      keywords:
        'groundwater hydrogeology aquifer darcy seepage velocity well drawdown theis cooper jacob hantush leaky ' +
        'pumping test transmissivity storativity image well capture zone flow net dam uplift contaminant ' +
        'transport ogata banks retardation dispersion',
    },
  },
  structures,
  soils,
  foundations,
  hydraulics,
  groundwater,
  water,
  process: processTool,
  reactors,
} as const;
