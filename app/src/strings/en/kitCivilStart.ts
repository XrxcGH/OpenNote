// The civil and chemical engineering kit's start-up words: its window title and its palette commands. The rest of kitCivil.ts
// joins this object when the kit's code loads (features/tools/civil/text.ts), so it stays out of start-up.
import type { kitCivil as all } from './kitCivil';

const START = {
  title: 'Civil and chemical engineering',
  openKeywords:
    'civil environmental chemical engineering structures soils hydraulics water reactors transport survey calculations',
  tools: {
    transport: {
      open: 'Open traffic, highways, surveying, and site planning',
      keywords:
        'transportation traffic flow greenshields greenberg underwood capacity shockwave queue bottleneck incident delay toll plaza m/m/1 m/m/c signal timing webster cycle green split stopping sight distance horizontal curve superelevation vertical curve crest sag travel demand gravity model logit mode share transit headway fleet surveying traverse compass rule misclosure leveling area by coordinates double meridian distance dmd trigonometric leveling zenith helmert coordinate transformation trip generation rates earthwork average end area prismoidal mass diagram site zoning floor area ratio coverage density parking setback',
    },
    indeterminate: {
      open: 'Open indeterminate structures and influence lines',
      keywords:
        'structural analysis indeterminate continuous beam moment distribution hardy cross slope deflection fixed end moments influence line muller breslau moving loads axle train absolute maximum moment truss frame sway sidesway non-sway braced portal method cantilever method lateral loads response spectrum newmark earthquake srss cqc',
    },
    hydraulics: {
      open: 'Open hydrology and open channels',
      keywords:
        'hydrology hydraulics rainfall runoff rational method idf time of concentration kirpich curve number nrcs scs tr-55 unit hydrograph s-curve flood routing muskingum reservoir puls detention basin flood frequency gumbel log pearson return period risk usle erosion open channel manning normal depth critical depth specific energy froude hydraulic jump gradually varied flow weir orifice hardy cross',
    },
    process: {
      open: 'Open material balances and separations',
      keywords:
        'chemical engineering process material balance mass balance mixer splitter separator recycle purge bypass degrees of freedom energy balance heat of reaction vapor liquid equilibrium raoult antoine bubble point dew point margules van laar wilson flash rachford rice distillation mccabe thiele fenske underwood gilliland absorption stripping kremser',
    },
    reactors: {
      open: 'Open chemical and biological reactors',
      keywords:
        'reaction engineering reactor design cstr pfr plug flow batch conversion space time levenspiel tanks in series recycle series parallel reactions selectivity yield adiabatic arrhenius activation energy steady states residence time distribution tracer dispersion segregation monod chemostat washout fed batch oxygen transfer kla activated sludge srt f/m',
    },
    soils: {
      open: 'Open soil properties, consolidation, and strength',
      keywords:
        'soil mechanics geotechnical phase relations void ratio porosity water content unit weight sieve hydrometer grain size atterberg limits plasticity uscs aashto classification proctor compaction permeability falling head effective stress boussinesq newmark consolidation settlement time factor casagrande taylor preconsolidation mohr circle triaxial direct shear skempton',
    },
    water: {
      open: 'Open water quality and treatment',
      keywords:
        'water quality treatment wastewater bod oxygen sag streeter phelps dissolved oxygen saturation carbonate alkalinity ph langelier ryznar hardness softening lime soda stokes settling sedimentation filter headloss carman kozeny ergun disinfection chick watson ct membrane osmotic pressure flux rejection',
    },
    foundations: {
      open: 'Open earth pressure, foundations, and slopes',
      keywords:
        'geotechnical foundation engineering lateral earth pressure rankine coulomb retaining wall cantilever gravity overturning sliding bearing capacity terzaghi meyerhof hansen vesic footing slope stability infinite slope culmann method of slices bishop fellenius pile skin friction alpha beta end bearing group efficiency converse labarre',
    },
    groundwater: {
      open: 'Open groundwater and wells',
      keywords:
        'groundwater hydrogeology aquifer darcy seepage velocity well drawdown theis cooper jacob hantush leaky pumping test transmissivity storativity image well capture zone flow net dam uplift contaminant transport ogata banks retardation dispersion',
    },
  },
} as const;

/** The whole namespace as t() sees it. A test checks that these words are the same as in kitCivil.ts. */
export const kitCivil = START as unknown as typeof all;
export const kitCivilStart = START;
