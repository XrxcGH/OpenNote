// The feature list's entry for each tool window in app/src/features/tools/ui/tools.ts (featureList.ts). An entry
// gives its category, its sentence, its picture, and where its tabs' commands and rows are.
// featureRegistry.test.ts fails when a registered tool window has no entry here.
import type { Category } from './featureMaps.ts';

export interface ToolEntry {
  category: Category;
  /** The FEATURES.md row (by its name) whose first sentence describes the window. */
  feature?: string;
  /** The sentence, when no row describes the whole window. */
  text?: string;
  /** The screens.json picture of the window. */
  screen?: string;
  /** The start of its tabs' command ids, when it is not `tools.<id>.`. */
  tabs?: string;
  /** The FEATURES.md section whose rows describe its tabs; they are listed under the window. */
  section?: string;
  /** True for a subject or engineering kit window. */
  kit?: boolean;
  /** The window's tabs, with a sentence each, when they have no commands of their own. */
  parts?: readonly (readonly [string, string])[];
}

const engineering: Category = 'Engineering kits';
const subject: Category = 'Subject and catalog kits';
const math: Category = 'Math and homework';
const study: Category = 'Study tools';

/** A window that one row of FEATURES.md describes. */
const row = (category: Category, feature: string, screen?: string, tabs?: string): ToolEntry => ({
  category,
  feature,
  ...(screen ? { screen } : {}),
  ...(tabs ? { tabs } : {}),
});
/** A kit whose tabs one section of FEATURES.md describes, with a sentence of its own. */
const kit = (category: Category, text: string, screen: string, section: string, tabs?: string): ToolEntry => ({
  category,
  text,
  screen,
  section,
  ...(tabs ? { tabs } : {}),
});

/** A subject or engineering kit window. */
const asKit = (entry: ToolEntry): ToolEntry => ({ ...entry, kit: true });

export const TOOL_ENTRIES: Readonly<Record<string, ToolEntry>> = {
  timers: row(study, 'Timers', 'tool-timer'),
  calculator: row(math, 'Calculator', 'tool-calculator'),
  upcoming: row(study, 'Upcoming list', 'tool-upcoming'),
  flashcards: {
    category: study,
    text: 'Reviews the cards of your decks on a spaced-repetition schedule, and imports and exports decks',
    screen: 'flashcard-review',
  },
  exam: row(study, 'Practice exams', 'practice-exam'),
  converter: row(math, 'Unit converter', 'unit-converter'),
  reference: row(study, 'Reference tables', 'reference-tables'),
  dictionary: row(study, 'Dictionary and thesaurus', 'dictionary'),
  symbols: row(math, 'Symbol palette and \\alpha autocompletion'),
  citations: row(study, 'Citation helper', 'citations'),
  constants: row(math, 'Scientific constants'),
  sigfigs: row(math, 'Significant-figures helper'),
  latex: row(math, 'Insert LaTeX'),
  solvers: kit(
    math,
    'One window with a tab for each solver, and each solver shows its worked steps',
    'solvers-integrals',
    'Math solvers',
  ),
  vectors: row(math, 'Vector tools'),
  solids: row(math, 'Solids of revolution'),
  projectile: row(math, 'Projectile simulator'),
  chemcalc: row(subject, 'Chemistry calculators', 'kit-chemistry'),
  structure: row(subject, 'Chemical structures', 'kit-chemistry-structure'),
  properties: row(subject, 'Property tables'),
  formulasheet: row(math, 'Formula sheet builder'),
  practice: row(math, 'Practice mode'),
  figure: row(math, 'Figure exporter'),
  econ: asKit({
    ...row(subject, 'Economics and finance calculators', 'kit-economics'),
    // The eight subjects of app/src/strings/en/kitEcon/*.ts, in the window's order.
    parts: [
      [
        'Time value, projects, and loans',
        'Works single sums, annuities, interest rates, loans, savings goals, NPV and IRR, depreciation, real estate ' +
          'returns, and cost-effectiveness.',
      ],
      [
        'Markets and welfare',
        'Works supply, demand, and surplus, elasticity, taxes and price controls, trade and tariffs, externalities, ' +
          'and labor markets.',
      ],
      [
        'Firms and market power',
        'Works monopoly, price discrimination, Cournot, Bertrand, and Stackelberg competition, collusion, and ' +
          'market concentration.',
      ],
      [
        'Consumer and producer choice',
        'Works utility maximization, substitution and income effects, cost minimization, short-run supply, and ' +
          'two-period consumption.',
      ],
      [
        'Macroeconomic models',
        'Works the Keynesian cross, IS-LM, Solow growth, the Taylor rule, the Phillips curve, money, interest and ' +
          'price parity, and cobweb models.',
      ],
      [
        'Prices, inequality, regions, and taxes',
        'Works price indexes, inflation adjustment, inequality, poverty, segregation, regional economics, the Human ' +
          'Development Index, and tax schedules.',
      ],
      [
        'Accounting and managerial analysis',
        'Works statements, inventory costing, ratios, break-even, variances, process and activity-based costing, ' +
          'bonds payable, audit sampling, and unit economics.',
      ],
      [
        'Bonds, portfolios, options, and valuation',
        'Works bonds and yield curves, returns, CAPM, portfolios, options, the cost of capital, valuation, and ' +
          'startup funding rounds.',
      ],
    ],
  }),
  'kit-statinfer': asKit(
    kit(
      subject,
      'Describes data and runs tests, epidemiology, power, resampling, Bayesian updating, and sampling',
      'kit-statistics',
      'Statistics kit',
    ),
  ),
  'kit-statmodels': asKit(
    kit(
      subject,
      'Fits regression, causal, survival, time-series, multivariate, machine learning, and spatial models',
      'kit-stat-models',
      'Statistical models kit',
      'tools.kitStatModels.',
    ),
  ),
  'kit-mind': asKit(
    kit(
      subject,
      'Works signal detection, psychophysics, learning, choice, response times, observation, agreement, and scales',
      'kit-psychology',
      'Psychology and behavior kit',
      'tools.kitMind.',
    ),
  ),
  kitmolbio: asKit(
    kit(
      subject,
      'Works with sequences, cloning, proteins, alignments, trees, crosses, population genetics, and pedigrees',
      'kit-biology',
      'Molecular biology, genetics, and evolution',
      'kits.molbio.',
    ),
  ),
  lifesys: asKit(
    kit(
      subject,
      'Works physiology, neurons, drugs, curve fits, bench math, populations, models, and field sampling',
      'kit-life-science',
      'Life science tools',
      'lifesys.',
    ),
  ),
  'kit-civil': asKit(
    kit(
      engineering,
      'Works structures, soils, foundations, water, transportation, material balances, and reactors',
      'kit-civil',
      'Civil, environmental, and chemical engineering tools',
      'kitCivil.',
    ),
  ),
  'kit-modphys': asKit(
    kit(
      subject,
      'Works quantum wells, spin, atoms, molecules, solids, plasmas, stars, the sky, and cosmology',
      'kit-modern-physics',
      'Modern physics and astronomy tools',
      'tools.modphys.',
    ),
  ),
  'kit-signals': asKit(
    kit(
      engineering,
      'Works spectra, filters, sampling, body signals, sound, images, medical imaging, coding, and RF lines',
      'kit-signals',
      'Signals, images, sound, and communications',
      'tools.signals.',
    ),
  ),
  'kit-earth': asKit(row(subject, 'Earth sciences', 'kit-earth', 'kits.earth.')),
  'kit-humanities': asKit(
    kit(
      subject,
      'Builds note frames, maps, timelines, calendars, scripts, linguistic structures, text analyses, and keys',
      'kit-humanities',
      'History, places, languages, and texts kit',
      'kits.humanities.',
    ),
  ),
  'kit-reasoning': asKit(row(subject, 'Reasoning kit', 'kit-reasoning')),
  kitmusic: asKit(
    kit(
      subject,
      'Writes scores and works music theory, ear training, tuning, scripts, camera math, and studio math',
      'kit-music',
      'Music, script, camera, and studio tools',
      'kits.music.',
    ),
  ),
  kitelectrical: asKit(row(engineering, 'Circuits and energy', 'kit-circuits', 'kits.electrical.')),
  'kit-solids': asKit(row(engineering, 'Solid mechanics', 'kit-solids-fem', 'tools.kitSolids.')),
  kitaero: asKit(row(engineering, 'Aerospace', 'kit-aerospace', 'kits.aero.')),
  'kit-chemmat': asKit(row(subject, 'Chemistry and materials', 'kit-chemmat', 'tools.kitChemMat.')),
  'kit-thermo': asKit(row(engineering, 'Thermodynamics', 'kit-thermo', 'tools.kitThermo.')),
  'kit-fluidheat': asKit(row(engineering, 'Fluids and heat transfer', 'kit-fluid-heat', 'tools.kitFluidHeat.')),
  'kit-control': asKit(row(engineering, 'Dynamics and control', 'kit-control', 'tools.kitControl.')),
  'kit-design': asKit(row(engineering, 'Design tools', 'kit-design', 'tools.kitDesign.')),
  'kit-math': asKit(row(engineering, 'Engineering mathematics', 'kit-engineering-math', 'tools.kitMath.')),
  'kit-mechdyn': asKit(row(engineering, 'Mechanisms and dynamics', 'kit-mechanisms', 'tools.kitMechDyn.')),
  'kit-physics': asKit(row(subject, 'Physics tools', 'kit-physics', 'tools.physics.')),
  code: {
    category: 'Writing and typing',
    text: 'The code studio window, which Beta 12 fills with the editor, console, and problems panel',
  },
};
