// The statistical models kit: one window with a tab for each tool. The shared words come first, then each tool's
// group: its title and keywords, field labels, choices, result rows, table, and column names, assumptions, plot
// labels, picture names, examples, and the wording of its worked steps (under step.<tool>).
export const kitStatModels = {
  title: 'Statistical models',
  open: 'Open the statistical models tools',
  keywords:
    'statistics regression model econometrics survival time series multivariate machine learning spatial data analysis',
  tabs: 'Statistical model tools',
  loading: 'Loading the tool…',
  ui: {
    openFile: 'Open a CSV or TSV file…',
    dataSummary: '{rows, plural, one {# row} other {# rows}}; columns: {columns}',
    dataHint: 'Paste from a spreadsheet, or type values with commas or tabs and the column names on the first line.',
    fileTooLarge: 'That file is larger than 5 MB, so it was not opened.',
    none: 'None',
    pickColumn: 'Choose a column…',
    example: 'Example',
    exampleNone: 'Choose an example…',
    results: 'Results',
    steps: 'Worked steps',
    assumptions: 'Assumptions',
    quantity: 'Quantity',
    value: 'Value',
    insert: 'Insert',
    insertMenu: 'Insert into the page',
    insertAnswer: 'Answer line',
    insertEquation: 'Equation',
    insertTable: 'Result table',
    insertSteps: 'Worked steps',
    insertWords: 'Result in words',
    insertPicture: 'Picture: {name}',
    inserted: 'Inserted into the page.',
    noPage: 'Click in a page first, then insert.',
    fixFields: 'Fix the marked fields to see the results.',
    caution: 'For coursework and learning. This tool gives no clinical, diagnostic, or financial advice.',
  },
  error: {
    empty: 'Type a value.',
    unreadable: 'That could not be read as a number: {detail}',
    integer: 'Type a whole number.',
    atLeast: 'Type a value of at least {detail}.',
    atMost: 'Type a value of at most {detail}.',
    pickColumn: 'Choose a column.',
    pickColumns: 'Choose at least 1 column.',
    noData: 'Paste a table of data, with the column names on the first line.',
    tooWide: 'The table has more than {detail} columns.',
    tooLong: 'The table has more than {detail} rows.',
    ragged: 'Row {detail} has a different number of cells from the first row, which has {other}.',
    noColumn: 'There is no column named {detail}.',
    notNumeric: 'The column {detail} needs numbers, but it has {other}.',
    noCompleteRows: 'No row has a value in every column the model uses.',
    logPositive: 'The log of {detail} needs values greater than 0.',
    wordsTransform: '{detail} holds words, so it cannot take a power or a log.',
    oneLevel: '{detail} has only 1 level in the rows used, so it cannot be a predictor.',
    collinear:
      'The column {detail} is explained exactly by the others, so its coefficient is not defined. Remove it or a ' +
      'column it repeats.',
    tooFewRows: 'There are {detail} rows for {other} coefficients. The model needs more rows than coefficients.',
    outcomeIsPredictor: '{detail} is the outcome, so it cannot also be a predictor.',
    countNegative: 'Counts cannot be negative.',
    countWhole: 'Counts must be whole numbers.',
    outcomeRange: 'A 0/1 outcome must be 0 or 1. With trials, successes must be between 0 and the trials.',
    trialsPositive: 'Trials must be whole numbers greater than 0.',
    exposurePositive: 'Each exposure in {detail} must be greater than 0.',
    separation:
      'The predictors split the outcomes completely or almost completely, so the coefficients have no finite ' +
      'estimate. Remove the predictor that splits them, or combine levels.',
    noConvergence: 'The model did not converge. Check for extreme values or a level with very few rows.',
    unknown: 'That could not be worked out.',
  },
  glm: {
    title: 'Logistic and Poisson regression',
    keywords:
      'logistic regression poisson glm generalized linear model odds ratio rate ratio binary count offset deviance ' +
      'roc auc hosmer lemeshow pseudo r2 classification',
    field: {
      data: 'Data',
      family: 'Model',
      outcome: 'Outcome',
      trials: 'Trials, for successes out of trials',
      exposure: 'Exposure, used as the offset ln(exposure)',
      predictors: 'Predictors',
      level: 'Confidence level',
      threshold: 'Classification threshold',
    },
    option: {
      logistic: 'Logistic, for 0/1 or successes out of trials',
      poisson: 'Poisson, for counts',
    },
    row: {
      ratio: 'Odds or rate ratio, first predictor',
      n: 'Rows used',
      deviance: 'Residual deviance',
      nullDeviance: 'Null deviance',
      lr: 'Likelihood-ratio chi-square',
      lrDf: 'Degrees of freedom',
      lrP: 'p-value',
      aic: 'AIC',
      bic: 'BIC',
      mcFadden: 'McFadden R²',
      coxSnell: 'Cox-Snell R²',
      nagelkerke: 'Nagelkerke R²',
      auc: 'Area under the ROC curve',
      hosmer: 'Hosmer-Lemeshow chi-square',
      hosmerP: 'Hosmer-Lemeshow p-value',
      accuracy: 'Accuracy at the threshold',
      sensitivity: 'Sensitivity',
      specificity: 'Specificity',
      dispersion: 'Dispersion, quasi-Poisson',
    },
    col: {
      term: 'Term',
      estimate: 'Estimate',
      se: 'Standard error',
      z: 'z',
      p: 'p',
      low: 'Lower limit',
      high: 'Upper limit',
      ratio: 'Ratio',
      profileLow: 'Profile lower',
      profileHigh: 'Profile upper',
      df: 'df',
      chi2: 'Chi-square',
      iteration: 'Iteration',
      deviance: 'Deviance',
      quasiSe: 'Quasi-Poisson standard error',
      actual: 'Actual',
      said1: 'Predicted 1',
      said0: 'Predicted 0',
    },
    table: {
      coef: 'Coefficients on the link scale',
      ratios: 'Odds or rate ratios',
      terms: 'Likelihood-ratio test of each term',
      iterations: 'IRLS iterations',
      classification: 'Classification table',
    },
    note: {
      linearLogit: 'The log odds change linearly with each numeric predictor.',
      linearLog: 'The log of the mean count changes linearly with each numeric predictor.',
      independent: 'Rows are independent of one another.',
      overdispersed:
        'The dispersion is well above 1, so the counts vary more than a Poisson model allows. Read the ' +
        'quasi-Poisson standard errors, or consider a negative binomial model.',
      profileMissing:
        'Some profile-likelihood limits could not be found, because the likelihood stays high on that side. They ' +
        'show as a dash.',
    },
    plot: {
      predictor: 'First numeric predictor, others at their means',
      probability: 'Probability',
      rate: 'Rate per unit of exposure',
      observed: 'Observed',
      fitted: 'Fitted',
      fpr: 'False positive rate (1 − specificity)',
      tpr: 'True positive rate (sensitivity)',
      roc: 'ROC curve',
      chance: 'Chance',
    },
    picture: {
      curve: 'Fitted curve against the first numeric predictor',
      roc: 'ROC curve',
    },
    example: {
      logistic: 'Pass or fail by hours studied',
      grouped: 'Deaths out of 20 by dose and group',
      poisson: 'Cases for each exposure by week',
    },
  },
  step: {
    glm: {
      modelLogistic: 'The model links the log odds of the outcome to the predictors.',
      modelPoisson: 'The model links the log of the mean count to the predictors, with the log exposure as an offset.',
      irls:
        'Iteratively reweighted least squares converged in {iterations} iterations. The deviance went from ' +
        '{first} after the first iteration to {last}.',
      coef: '{term}: estimate {b}, standard error {se}, Wald z = {z}, p = {p}.',
      ratio: '{term}: the ratio is e to the estimate, {ratio}, with a {level}% interval from {lo} to {hi}.',
      lr: 'The likelihood-ratio test compares the model with the intercept-only model: chi-square {lr} on {df} df, p = {p}.',
      pseudo: "McFadden's R² compares the log likelihood of the model with that of the intercept-only model.",
      auc: 'The area under the ROC curve is {auc}: the chance that a random 1 has a higher fitted probability than a random 0.',
      dispersion:
        'The quasi-Poisson dispersion is Pearson chi-square over its degrees of freedom. Values well above 1 mean ' +
        'overdispersion.',
      wordsLogistic:
        'Each 1-unit increase in {term} multiplies the odds of {outcome} by {ratio} ({level}% CI {lo} to {hi}; ' +
        'z = {z}, p = {p}).',
      wordsPoisson:
        'Each 1-unit increase in {term} multiplies the rate of {outcome} by {ratio} ({level}% CI {lo} to {hi}; ' +
        'z = {z}, p = {p}).',
    },
  },
};
