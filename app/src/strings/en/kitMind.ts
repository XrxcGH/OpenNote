// The psychology and behavior kit: perception, learning, decisions, response times, observation, agreement,
// questionnaires, and qualitative coding. Tool titles and keywords for the command palette, and the
// window's shared labels. Each tool's other words and the problems an input can have live in ./kitMind and load
// with the window (words.ts).

export const kitMind = {
  window: 'Psychology and behavior',
  tabs: 'Tools',
  open: 'Open the psychology and behavior tools',
  keywords: 'psychology cognition perception behavior learning decision measurement experiment research methods',
  coursework: 'For coursework and practice. These tools give no clinical, diagnostic, or treatment advice.',
  loading: 'Loading the tool',
  ui: {
    example: 'Example',
    exampleNone: 'Choose an example',
    insert: 'Insert',
    insertMenu: 'Insert into the page',
    insertAnswer: 'Answer line',
    insertEquation: 'Answer as an equation',
    insertTable: 'Result table',
    insertSteps: 'Worked steps',
    insertExtra: 'Table: {name}',
    insertPicture: 'Picture: {name}',
    insertLive: 'Live calculation block',
    inserted: 'Inserted into the page.',
    noPage: 'Click in a page first, then insert.',
    results: 'Results',
    quantity: 'Quantity',
    value: 'Value',
    steps: 'Worked steps',
    notes: 'What it means',
    notDefined: 'Not defined',
    fixFields: 'Fix the fields marked above to see results.',
    reset: 'Reset the fields',
  },
  sdt: {
    title: 'Signal detection',
    keywords:
      'signal detection d prime sensitivity bias criterion beta ROC hit false alarm forced choice rating perception',
  },
  psychophysics: {
    title: 'Psychophysics',
    keywords:
      'psychophysics psychometric function threshold slope PSE JND constant stimuli staircase ' +
      'up-down reversals method of limits adjustment Weber Fechner Stevens power law visual ' +
      'angle contrast Michelson logMAR Snellen acuity',
  },
  learning: {
    title: 'Learning and reinforcement',
    keywords:
      'learning conditioning Rescorla-Wagner blocking overshadowing extinction inhibition ' +
      'Pearce-Hall temporal difference TD prediction error reinforcement learning Q-learning ' +
      'SARSA grid world value iteration policy iteration bandit epsilon greedy softmax UCB ' +
      'Thompson regret schedules of reinforcement cumulative record learning curve power law of ' +
      'practice',
  },
  choice: {
    title: 'Decision and choice models',
    keywords:
      'decision choice drift diffusion model DDM evidence accumulation boundary response time ' +
      'speed accuracy EZ diffusion prospect theory loss aversion probability weighting certainty ' +
      'equivalent Allais framing',
  },
  rt: {
    title: 'Response times and movement',
    keywords:
      'response time reaction time RT trimming outliers MAD condition means within-subject ' +
      'confidence interval Cousineau Morey inverse efficiency ex-Gaussian vincentize quantile ' +
      'delta plot Fitts law Hick-Hyman throughput',
  },
  observe: {
    title: 'Behavior observation',
    keywords:
      'behavior observation ethogram time budget rate duration bout latency interval recording ' +
      'partial whole momentary scan sampling observer agreement single-case ABAB baseline PND ' +
      'NAP Tau',
  },
  agreement: {
    title: 'Inter-rater agreement',
    keywords:
      'inter-rater interrater agreement reliability kappa cohen fleiss krippendorff alpha intraclass correlation ICC ' +
      'bland altman coder rater content analysis',
  },
  scales: {
    title: 'Scales and psychometrics',
    keywords:
      'psychometrics questionnaire survey scale Likert reliability cronbach alpha KR-20 split half spearman brown ' +
      'item analysis difficulty discrimination test score z T stanine percentile IRT item response SUS usability',
  },
  coding: {
    title: 'Qualitative coding',
    keywords:
      'qualitative coding codebook codes themes segments interview thematic analysis ' +
      'co-occurrence Jaccard content analysis two coders kappa',
  },
} as const;
