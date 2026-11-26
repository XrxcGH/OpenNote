// The FluidHeat kit's start-up words: what its palette commands, window title, and registration read before the kit
// loads. The rest of kitFluidHeat.ts joins this object when the kit's code loads (features/engineering/fluidheat/text.ts).
import type { kitFluidHeat as all } from './kitFluidHeat';

export const kitFluidHeatStart = {
  statics: {
    title: 'Fluid statics, Bernoulli, and flow measurement',
    keywords:
      'fluid statics hydrostatic pressure manometer gate force center of ' +
      'pressure buoyancy metacentric height stability bernoulli pitot venturi',
  },
  pipes: {
    title: 'Pipe flow and pumps',
    keywords:
      'pipe flow head loss friction factor moody colebrook darcy reynolds ' +
      'pump curve operating point series parallel network hardy cross minor ' +
      'loss',
  },
  dimensional: {
    title: 'Dimensional analysis and similitude',
    keywords:
      'dimensional analysis buckingham pi groups repeating variables ' +
      'dimensionless reynolds froude mach weber similitude similarity model ' +
      'prototype scaling',
  },
  external: {
    title: 'External flow, drag, and boundary layers',
    keywords:
      'external flow boundary layer flat plate blasius skin friction drag ' +
      'coefficient sphere terminal velocity stokes drag power',
  },
  viscous: {
    title: 'Viscous and biological flows',
    keywords:
      'viscous flow couette poiseuille annulus non-newtonian power law ' +
      'bingham casson yield stress blood womersley pulsatile artery murray ' +
      'law branching',
  },
  conduction: {
    title: 'Conduction and thermal circuits',
    keywords:
      'conduction thermal resistance circuit composite wall cylinder sphere ' +
      'insulation critical radius contact resistance heat generation fourier ' +
      'law overall coefficient',
  },
  fins: {
    title: 'Extended surfaces (fins)',
    keywords:
      'fin extended surface pin fin straight fin annular fin efficiency ' +
      'effectiveness tip condition fin array heat sink',
  },
  transient: {
    title: 'Transient conduction and diffusion',
    keywords:
      'transient conduction lumped capacitance biot fourier heisler chart ' +
      'cooling heating semi-infinite solid time constant diffusion',
  },
  convection: {
    title: 'Convection correlations (heat and mass transfer)',
    keywords:
      'convection heat transfer coefficient nusselt sherwood reynolds prandtl ' +
      'rayleigh correlation flat plate cylinder sphere tube natural ' +
      'convection mass transfer gnielinski dittus boelter churchill',
  },
  hx: {
    title: 'Heat exchangers',
    keywords:
      'heat exchanger effectiveness ntu lmtd log mean temperature difference ' +
      'counterflow parallel flow shell and tube cross flow condenser overall ' +
      'coefficient area sizing rating',
  },
  radiation: {
    title: 'Radiation heat transfer',
    keywords:
      'radiation heat transfer blackbody planck wien stefan boltzmann band ' +
      'fraction emissivity view factor shape factor radiosity enclosure ' +
      'radiation shield gray surface',
  },
  props: {
    title: 'Water and air properties',
    keywords:
      'properties table water air density viscosity conductivity specific ' +
      'heat prandtl thermal diffusivity expansion coefficient fluid ' +
      'properties lookup',
  },
  open: 'Open the fluid mechanics and heat transfer tools',
  keywords:
    'fluid mechanics heat transfer mass transfer pipe flow pump bernoulli ' +
    'drag convection conduction radiation exchanger fin',
  title: 'Fluids and heat transfer',
  tabs: 'Fluid and heat transfer tools',
  loading: 'Loading the tool…',
} as const;

/** The whole namespace as t() sees it. A test checks that these words are the same as in kitFluidHeat.ts. */
export const kitFluidHeat = kitFluidHeatStart as unknown as typeof all;
