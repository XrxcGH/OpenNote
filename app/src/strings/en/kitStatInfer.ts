// The statistics kit (inference, epidemiology, and study design): the words the palette and the window's tabs need
// at start-up. The rest, in ./kitStatInfer/detail.ts, loads with the kit.
export const kitStatInfer = {
  window: {
    title: 'Statistics: inference and design',
    open: 'Open the statistics kit',
    keywords: 'statistics stats inference hypothesis test p-value study design epidemiology',
  },
  tools: {
    describe: 'Describe',
    groups: 'ANOVA',
    ranks: 'Rank tests',
    tables: 'Tables',
    epi: 'Epidemiology',
    correlation: 'Correlation',
    power: 'Power',
    multiple: 'Many tests',
    resample: 'Resampling',
    bayes: 'Bayes',
    design: 'Design',
  },
  open: {
    describe: 'Describe data',
    groups: 'Compare groups (ANOVA)',
    ranks: 'Rank-based tests',
    tables: 'Contingency tables',
    epi: 'Epidemiology and diagnostic tests',
    correlation: 'Correlation',
    power: 'Power and sample size',
    multiple: 'Multiple testing and meta-analysis',
    resample: 'Simulation and resampling',
    bayes: 'Bayesian updating',
    design: 'Sampling and randomization',
  },
  keywords: {
    describe:
      'descriptive statistics mean median mode standard deviation skewness kurtosis outlier stem leaf frequency z-score',
    groups:
      'anova analysis of variance one-way two-way factorial welch repeated measures sphericity greenhouse-geisser ' +
      'mixed design tukey games-howell bonferroni contrast eta squared omega squared cohen d hedges g levene shapiro',
    ranks:
      'nonparametric rank mann-whitney wilcoxon signed-rank sign test kruskal-wallis dunn ' +
      'friedman conover nemenyi hodges-lehmann kolmogorov-smirnov',
    tables:
      'contingency table chi-square crosstab independence fisher exact mcnemar cochran cramer phi odds forecast skill score',
    epi:
      'epidemiology risk ratio relative risk odds ratio attributable fraction number needed to treat mantel haenszel ' +
      'sensitivity specificity predictive value likelihood ratio incidence rate standardization smr prevalence',
    correlation:
      'correlation pearson spearman kendall tau rho partial semipartial point-biserial correlation matrix fisher z steiger',
    power:
      'power analysis sample size noncentral t test anova chi-square correlation proportions equivalence tost ' +
      'regression survival schoenfeld effect size cohen d f w design effect',
    multiple:
      'multiple comparisons bonferroni holm hochberg hommel false discovery rate q-value fisher stouffer meta-analysis ' +
      'forest funnel egger heterogeneity volcano manhattan critical value table',
    resample:
      'bootstrap permutation test randomization resampling bca interval sampling distribution central limit theorem ' +
      'simulation coin dice urn random walk brownian law of large numbers seed',
    bayes:
      'bayes bayesian prior posterior conjugate beta binomial gamma poisson dirichlet credible interval hdi ' +
      'bayes factor savage-dickey jzs grid metropolis mcmc bayes table',
    design:
      'random assignment randomization permuted blocks stratified latin square williams counterbalancing factorial ' +
      'sampling systematic cluster pps neyman allocation survey design effect margin of error sample size',
  },
};
