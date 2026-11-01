// The Solids kit's start-up words: what its palette commands, window title, and registration read before the kit
// loads. The rest of kitSolids.ts joins this object when the kit's code loads (features/engineering/solids/text.ts).
import type { kitSolids as all } from './kitSolids';

export const kitSolidsStart = {
  columns: {
    title: 'Columns and buckling',
    keywords:
      'column buckling euler critical load effective length slenderness ' +
      'johnson parabola secant eccentric plate buckling local buckling',
  },
  stress: {
    title: 'Stress and strain at a point',
    keywords:
      'stress transformation principal stresses mohr circle maximum shear ' +
      'strain rosette von mises tresca coulomb mohr failure safety factor ' +
      'tensor',
  },
  sections: {
    title: 'Section properties',
    keywords:
      'section properties centroid second moment of area inertia parallel ' +
      'axis product of inertia principal axes radius of gyration section ' +
      'modulus first moment Q shear center thin-walled channel angle tee',
  },
  members: {
    title: 'Axial, torsion, and bending',
    keywords:
      'axial stress deformation thermal stress indeterminate torsion shaft ' +
      'angle of twist power transmission flexure formula unsymmetric bending ' +
      'neutral axis transverse shear VQ/It combined loading Bredt',
  },
  deflection: {
    title: 'Beam deflection',
    keywords:
      'beam deflection elastic curve slope double integration superposition ' +
      'singularity functions cantilever simply supported propped cantilever ' +
      'continuous beam indeterminate hinge EI maximum deflection',
  },
  vessels: {
    title: 'Pressure vessels, fits, and curved beams',
    keywords:
      'pressure vessel thin-walled hoop stress axial stress sphere ' +
      'thick-walled cylinder Lamé press fit shrink fit interference contact ' +
      'pressure hub shaft curved beam Winkler neutral axis crane hook',
  },
  thinwalled: {
    title: 'Thin-walled structures',
    keywords:
      'thin-walled shear flow open section closed section multi-cell torsion ' +
      'rate of twist boom idealization stiffened panel wing box shear center ' +
      'Bredt aircraft structures unsymmetric bending',
  },
  composites: {
    title: 'Composite laminates',
    keywords:
      'composite laminate classical lamination theory CLT orthotropic lamina ' +
      'ply reduced stiffness Q transformed Q-bar ABD matrix layup symmetric ' +
      'balanced cross-ply angle-ply Tsai-Wu Tsai-Hill maximum stress first ' +
      'ply failure',
  },
  biomech: {
    title: 'Tissues and joints',
    keywords:
      'biomechanics viscoelastic tissue Maxwell Kelvin-Voigt standard linear ' +
      'solid creep stress relaxation ramp Boltzmann complex modulus storage ' +
      'loss modulus hysteresis joint reaction muscle force elbow body segment ' +
      'parameters Dempster bone rule of mixtures',
  },
  machine: {
    title: 'Fatigue and machine elements',
    keywords:
      'fatigue endurance limit Marin factors surface size reliability Goodman ' +
      'Gerber ASME elliptic Soderberg Langer S-N curve Miner rule shaft ' +
      'design DE-Goodman bolt preload joint bearing life L10 helical spring ' +
      'Lewis gear',
  },
  fem: {
    title: 'Finite element workbench',
    keywords:
      'finite element method FEM direct stiffness bar spring truss frame beam ' +
      'element plane stress CST Q4 quadrilateral mesh heat conduction modal ' +
      'analysis natural frequency consistent mass convergence assembly',
  },
  open: 'Open the solid mechanics tools',
  keywords:
    'solid mechanics materials strength stress strain beam column section ' +
    'structures composites finite element fatigue',
  ui: {
    inserted: 'Inserted into the page.',
    noPage: 'Click in a page first, then insert.',
  },
  title: 'Solid mechanics',
  tabs: 'Solid mechanics tools',
  loading: 'Loading the tool…',
} as const;

/** The whole namespace as t() sees it. A test checks that these words are the same as in kitSolids.ts. */
export const kitSolids = kitSolidsStart as unknown as typeof all;
