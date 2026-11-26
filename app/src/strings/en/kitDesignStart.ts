// The Design kit's start-up words: what its palette commands, window title, and registration read before the kit
// loads. The rest of kitDesign.ts joins this object when the kit's code loads (features/tools/design/text.ts).
import type { kitDesign as all } from './kitDesign';

export const kitDesignStart = {
  open: 'Open the design tools',
  keywords:
    'design drafting tolerance manufacturing machining forming casting ' +
    'fabrication number representation memory pointer',
  title: 'Design tools',
  tabs: 'Design tools',
  loading: 'Loading the tool…',
  paper: {
    title: 'Title',
    keywords: 'engineering paper drafting computation grid three view projection title block sheet',
    computation: 'Computation paper',
    threeView: 'Three-view drawing paper',
    titleBlock: 'Title block',
    applied: '{name} applied.',
    noPage: 'Open a page first, then choose the paper.',
    drawnBy: 'Drawn by',
    date: 'Date',
    scale: 'Scale',
    sheet: 'Sheet',
    material: 'Material',
    tolerance: 'Tolerances unless otherwise specified',
    front: 'Front',
    top: 'Top',
    right: 'Right',
  },
  tolerances: {
    title: 'Tolerances and fits',
    keywords:
      'tolerance stack-up worst case root sum square rss monte carlo fit ' +
      'clearance interference position gd&t drafting',
  },
  machining: {
    title: 'Machining speeds, feeds, and tool life',
    keywords:
      'machining turning drilling milling spindle speed feed rate material ' +
      'removal rate cutting time taylor tool life economics merchant shear ' +
      'angle cutting force chip manufacturing lathe mill',
  },
  forming: {
    title: 'Forming, casting, and joining',
    keywords:
      'forming rolling forging extrusion wire drawing sheet metal bending ' +
      'bend allowance blanking punching casting chvorinov solidification ' +
      'riser pattern shrinkage welding heat input additive layers 3d printing ' +
      'manufacturing',
  },
  microfab: {
    title: 'Micro and nano fabrication',
    keywords:
      'microfabrication nanofabrication lithography resolution depth of focus ' +
      'etch anisotropy selectivity stoney film stress wafer bow evaporation ' +
      'thin film dies per wafer yield defect density binding langmuir ' +
      'kinetics biosensor semiconductor',
  },
  numrep: {
    title: 'Number representation',
    keywords:
      'number representation binary hexadecimal base conversion twos ' +
      'complement ones complement sign magnitude overflow floating point ieee ' +
      '754 half single double float rounding error unicode utf-8 utf-16 ' +
      'character c++ integer types computer programming',
  },
  references: {
    title: 'Programming references',
    keywords:
      'programming reference c++ types escape sequences operator precedence ' +
      'common errors compile error runtime matlab cheat sheet trace table ' +
      'coding',
  },
  views: {
    title: 'Orthographic views',
    keywords:
      'orthographic views projection front top right side view hidden lines ' +
      'isometric third angle first angle engineering drawing graphics cubes ' +
      'multiview',
  },
  memtrace: {
    title: 'Memory and pointer tracer',
    keywords:
      'memory pointer tracer c++ stack heap pointers references arrays new ' +
      'delete memory leak dangling pointer undefined behavior out of bounds ' +
      'step through debugger visualizer programming',
  },
  drafting: {
    title: 'Drafting sheet',
    keywords:
      'drafting engineering graphics drawing sheet line types dimensions ' +
      'scale title block hidden center phantom hatch section orthographic cad ' +
      'sketch',
  },
} as const;

/** The whole namespace as t() sees it. A test checks that these words are the same as in kitDesign.ts. */
export const kitDesign = kitDesignStart as unknown as typeof all;
