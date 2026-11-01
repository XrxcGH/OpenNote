// The ChemMat kit's start-up words: what its palette commands, window title, and registration read before the kit
// loads. The rest of kitChemMat.ts joins this object when the kit's code loads (features/tools/chemmat/text.ts).
import type { kitChemMat as all } from './kitChemMat';

export const kitChemMatStart = {
  thermo: {
    title: 'Thermochemistry',
    open: 'Open the thermochemistry tool',
    keywords:
      'enthalpy entropy gibbs free energy hess law spontaneity equilibrium constant van t hoff heat of reaction',
  },
  eq: {
    title: 'Chemical equilibrium',
    open: 'Open the chemical equilibrium tool',
    keywords: 'equilibrium ice table kc kp ksp solubility common ion reaction quotient le chatelier',
  },
  ab: {
    title: 'Acids and bases',
    open: 'Open the acids, bases, and buffers tool',
    keywords: 'acid base ph pka ka kb buffer henderson hasselbalch polyprotic titration hydrolysis alpha fraction',
  },
  ec: {
    title: 'Electrochemistry',
    open: 'Open the electrochemistry tool',
    keywords:
      'electrochemistry cell potential nernst galvanic electrolysis faraday half reaction anode cathode battery',
  },
  kin: {
    title: 'Chemical kinetics',
    open: 'Open the chemical kinetics tool',
    keywords: 'kinetics rate law order half-life integrated arrhenius activation energy initial rates combustion',
  },
  sol: {
    title: 'Solutions and lab calculations',
    open: 'Open the solutions and lab calculations tool',
    keywords:
      'colligative freezing point depression boiling elevation osmotic ' +
      'pressure calorimetry calibration beer lambert molar mass yield',
  },
  cx: {
    title: 'Crystal structures and diffraction',
    open: 'Open the crystal structures and diffraction tool',
    keywords:
      'crystal unit cell fcc bcc hcp packing factor density miller indices ' +
      'plane spacing bragg xrd powder scherrer diffraction',
  },
  df: {
    title: 'Defects, diffusion, and oxidation',
    open: 'Open the defects, diffusion, and oxidation tool',
    keywords:
      'vacancy diffusion coefficient arrhenius fick carburizing erf dopant ' +
      'predeposition drive-in junction depth oxidation deal grove oxide',
  },
  ph: {
    title: 'Phase diagrams and mechanical behavior',
    open: 'Open the phase diagrams and mechanical behavior tool',
    keywords:
      'phase diagram lever rule tie line eutectic tensile stress strain yield ' +
      'modulus toughness fracture fatigue basquin creep larson miller',
  },
  at: {
    title: 'Atoms, light, and bonding',
    open: 'Open the atoms, light, and bonding tool',
    keywords:
      'photon wavelength hydrogen spectrum balmer rydberg de broglie particle ' +
      'box quantum numbers vsepr formal charge molecular orbital',
  },
  open: 'Open Chemistry and materials',
  keywords:
    'chemistry materials thermochemistry equilibrium acids bases ' + 'electrochemistry kinetics crystals diffusion',
  title: 'Chemistry and materials',
} as const;

/** The whole namespace as t() sees it. A test checks that these words are the same as in kitChemMat.ts. */
export const kitChemMat = kitChemMatStart as unknown as typeof all;
