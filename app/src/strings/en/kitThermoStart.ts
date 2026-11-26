// The Thermo kit's start-up words: what its palette commands, window title, and registration read before the kit
// loads. The rest of kitThermo.ts joins this object when the kit's code loads (features/engineering/thermo/text.ts).
import type { kitThermo as all } from './kitThermo';

export const kitThermoStart = {
  open: {
    window: 'Open the thermodynamics kit',
    statthermo: 'Find partition functions, heat capacities, and molecular speeds',
    idealgas: 'Work an ideal-gas process or state with variable specific heats',
    steam: 'Find a state of water or steam from two properties',
    psychro: 'Work moist-air states and air-conditioning processes',
    r134a: 'Find a state of refrigerant R-134a from two properties',
    devices: 'Balance a turbine, compressor, nozzle, or other steady-flow device with the second law',
    cycles: 'Analyze a Rankine, Brayton, Otto, Diesel, refrigeration, or Carnot cycle',
    realgas: 'Find Z and departures from a cubic equation of state, or the properties of a gas mixture',
    combustion: 'Balance a combustion reaction and find heating values and the adiabatic flame temperature',
  },
  keywords: {
    window: 'thermodynamics thermal physics combustion heat engines properties tables cycles kit',
    statthermo:
      'statistical thermodynamics partition function boltzmann sackur tetrode ' +
      'entropy einstein debye solid heat capacity maxwell speed mean free ' +
      'path knudsen kinetic theory fermi dirac bose einstein occupancy',
    idealgas:
      'ideal gas law process isentropic polytropic isothermal isobaric ' +
      'isochoric boundary work variable specific heats cold air standard gas ' +
      'tables relative pressure air nitrogen oxygen carbon dioxide',
    steam:
      'steam tables water properties compressed liquid saturated mixture ' +
      'superheated vapor quality supercritical enthalpy entropy iapws if97 ' +
      'mollier dome',
    psychro:
      'psychrometrics psychrometric chart moist air humidity ratio relative ' +
      'humidity dew point wet bulb air conditioning dehumidification ' +
      'evaporative cooling adiabatic mixing hvac',
    r134a:
      'refrigerant r134a r-134a tetrafluoroethane refrigeration heat pump ' +
      'tables saturated superheated compressed liquid evaporator condenser',
    devices:
      'steady flow devices turbine compressor pump nozzle diffuser throttle ' +
      'valve heat exchanger mixing chamber isentropic efficiency entropy ' +
      'generation exergy destruction availability second law efficiency',
    cycles:
      'power cycle refrigeration cycle rankine reheat regenerative feedwater ' +
      'heater brayton gas turbine regeneration intercooling otto diesel dual ' +
      'carnot vapor compression heat pump cop thermal efficiency back work ' +
      'ratio mean effective pressure state table',
    realgas:
      'real gas compressibility factor z van der waals redlich kwong soave ' +
      'peng robinson cubic equation of state departure function enthalpy ' +
      'entropy fugacity reduced pressure temperature gas mixture mole ' +
      'fraction mass fraction dalton amagat partial pressure kay rule pseudo ' +
      'critical',
    combustion:
      'combustion stoichiometric air fuel ratio equivalence ratio excess air ' +
      'balanced reaction products mole fraction dew point heating value lhv ' +
      'hhv adiabatic flame temperature dissociation chemical equilibrium ' +
      'gibbs rocket chamber characteristic velocity methane propane octane ' +
      'hydrogen kerosene',
  },
  title: 'Thermodynamics kit',
} as const;

/** The whole namespace as t() sees it. A test checks that these words are the same as in kitThermo.ts. */
export const kitThermo = kitThermoStart as unknown as typeof all;
