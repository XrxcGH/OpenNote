// checks-disable-file modifiability: the life science tools' start-up strings, kept small for the start-up bundle
// The life science tools' window name, palette commands, and shared errors (owner: the life-systems lane). Each
// tool's own words are in kitLifeSysTools.ts, which loads with the window. Every string is a full sentence or label,
// never joined from pieces (ARCHITECTURE.md section 19). Symbols such as Km or PaCO₂ stay as written.

export const kitLifeSys = {
  ui: {
    windowTitle: 'Life science tools',
    open: 'Open life science tools',
    keywords: 'life science biology physiology ecology pharmacology neuroscience lab calculator kit',
    openAt: 'Open {name}',
    calculation: 'Calculation',
    clinical: 'For coursework and study only. These results are not for clinical decisions, dosing, or diagnosis.',
    run: 'Run',
    pressRun: 'Set the values, then press Run.',
    insert: 'Insert',
    insertMenu: 'Insert into the page',
    insertAnswer: 'Answer line',
    insertSteps: 'Worked steps',
    insertLatex: 'Equation as LaTeX',
    insertTable: 'Result table',
    insertPlot: 'Picture of {title}',
    inserted: 'Inserted into the page.',
    noPage: 'Click in a page first, then insert.',
    noPicture: 'The picture could not be drawn on this device.',
    steps: 'Steps',
    dataTable: 'Data table',
    quantity: 'Quantity',
    value: 'Value',
    unit: 'Unit',
    unitFor: 'Unit for {name}',
    openFile: 'Open a CSV or text file',
    fileRead: 'Read {name}.',
    sourceLine: 'Source: {source}',
    plotSummary: 'Plot of {title}: {y} against {x}. Series: {names}.',
  },
  errors: {
    unknown: 'This could not be worked out. Check the values and try again.',
    missing: 'Enter a value for {name}.',
    notNumber: '{name} needs a number, such as 12.5 or 3e-4.',
    number: 'Enter a number for {name}.',
    positive: '{name} must be greater than 0.',
    nonNegative: '{name} must be 0 or more.',
    range: '{name} must be between {low} and {high}.',
    whole: '{name} must be a whole number of at least {min}.',
    badRows:
      '{name} has {count} rows that are not numbers. Use one row per line, with numbers between spaces or commas.',
    points: 'Enter at least {min} data points.',
    sameX: 'The x values are all the same, so no line fits them.',
    singular: 'These values give a system with no single answer. Check for repeated or zero entries.',
    converge: 'The calculation did not settle on an answer. Try other starting values.',
    start: 'The model cannot be evaluated at the starting values.',
    bracket: 'No answer was found in the range searched.',
    ode: 'The simulation could not keep its accuracy. Try a shorter time or gentler parameters.',
    span: 'The end time must be after the start time.',
    eigen: 'The matrix has no single dominant eigenvalue.',
    nonNegativeMatrix: 'Every matrix entry must be a number of 0 or more.',
    noSpecies: 'Enter at least 1 count above 0.',
  },
  tools: {
    networks: {
      title: 'Compartment, reaction, and agent models',
      open: 'Open compartment, reaction, and agent models',
      tab: 'Models',
      keywords:
        'epidemic sir seir sirs sis r0 herd immunity final size reed frost chain binomial reaction network ' +
        'gillespie stochastic ode gene expression toggle switch repressilator lotka volterra box model schelling ' +
        'segregation lattice voter model game of life cellular automaton wolfram rule granovetter threshold ' +
        'erdos renyi watts strogatz barabasi albert small world network',
    },
    physiology: {
      title: 'Physiology calculators',
      open: 'Open physiology calculators',
      tab: 'Physiology',
      keywords:
        'physiology cardiac output fick stroke volume ejection fraction mean arterial pressure resistance poiseuille ' +
        'laplace compliance alveolar gas a-a gradient oxygen content delivery dissociation severinghaus p50 ' +
        'ventilation dead space bohr clearance gfr rpf fena free water glucose tm acid base ph winter anion gap ' +
        'osmolarity starling bmr mifflin tdee macronutrient mets rer karvonen growth lms z-score water potential',
    },
    neuron: {
      title: 'Neurons and excitable cells',
      open: 'Open neurons and excitable cells',
      tab: 'Neurons',
      keywords:
        'neuron neuroscience nernst goldman ghk donnan resting potential membrane time constant rc hodgkin huxley ' +
        'action potential voltage clamp ttx tea threshold refractory integrate and fire lif f-i cable length ' +
        'constant conduction velocity myelin synapse epsp ipsp summation shunting inhibition',
    },
    curves: {
      title: 'Binding, enzyme, and dose-response fits',
      open: 'Open binding, enzyme, and dose-response fits',
      tab: 'Curves',
      keywords:
        'enzyme kinetics michaelis menten vmax km kcat lineweaver burk eadie hofstee hanes inhibition competitive ' +
        'uncompetitive noncompetitive mixed ki hill cooperativity binding bmax kd scatchard cheng prusoff ic50 ' +
        'langmuir freundlich bet isotherm 4pl 5pl elisa standard curve ec50 dose response schild pa2 probit ld50 ' +
        'fieller linear quadratic survival bed eqd2',
    },
    pharmacology: {
      title: 'Pharmacokinetics and drug response',
      open: 'Open pharmacokinetics and drug response',
      tab: 'Pharmacology',
      keywords:
        'pharmacology pharmacokinetics pk pd drug half life clearance volume of distribution bolus infusion oral ' +
        'bateman tmax cmax auc aumc mrt nca multiple dosing steady state loading dose two compartment michaelis ' +
        'menten bsa mosteller release higuchi peppas emax hill ec50 occupancy therapeutic index',
    },
    population: {
      title: 'Population dynamics',
      open: 'Open population dynamics',
      tab: 'Populations',
      keywords:
        'population ecology exponential logistic ricker beverton holt allee harvesting msy predator prey ' +
        'lotka volterra rosenzweig macarthur functional response competition metapopulation levins island ' +
        'biogeography species area logistic map cobweb bifurcation chaos lyapunov phase plane',
    },
    demography: {
      title: 'Life tables and demography',
      open: 'Open life tables and demography',
      tab: 'Demography',
      keywords:
        'demography life table life expectancy survivorship mortality fertility tfr nrr grr r0 euler lotka ' +
        'intrinsic rate leslie lefkovitch matrix elasticity projection cohort component population pyramid ' +
        'dependency doubling',
    },
    bench: {
      title: 'Bench calculations',
      open: 'Open bench calculations',
      tab: 'Bench',
      keywords:
        'lab bench molarity dilution serial master mix buffer recipe centrifuge rcf rpm hemocytometer cell ' +
        'count seeding cfu plaque titer moi growth doubling qpcr ddct pfaffl efficiency microscope resolution ' +
        'calibration lod',
    },
    diversity: {
      title: 'Biodiversity and field sampling',
      open: 'Open biodiversity and field sampling',
      tab: 'Diversity',
      keywords:
        'biodiversity ecology shannon simpson hill chao ace rarefaction accumulation jaccard sorensen bray curtis ' +
        'quadrat transect dispersion mark recapture lincoln petersen schnabel',
    },
  },
} as const;
