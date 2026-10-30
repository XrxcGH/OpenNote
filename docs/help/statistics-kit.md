# Statistics kit

Describe data, run tests, plan studies, and work the numbers of epidemiology, resampling, and Bayesian updating, with the steps shown so you can follow them.
The kit is new in Beta, so check its answers against your own work while you learn it.

## Open the kit

- Open the command palette and type Statistics, or the name of a tool, such as ANOVA, power, or bootstrap. Each tool has its own command.
- The kit is one window with a tab for each tool. The arrow keys move between the tabs, and each tab keeps what you typed.
- Every tool ends with Insert into page: the answer line, the equation, the results table, the worked steps, the plot as a picture, or a live calculation block that reopens the tool with the same inputs. Each table also has its own Insert table button.

## The tools

### Describing data

- **Describe data**: summary statistics with skewness and kurtosis, trimmed and other means, outlier screens (including Grubbs' test), stem-and-leaf displays, frequency tables, grouped data, and category counts.

### Tests

- **ANOVA**: compare the means of groups. It runs one-way ANOVA with Welch's test, checks the assumptions, and compares pairs by Tukey or Games-Howell. It also does two-way, repeated-measures, and mixed designs, and effect sizes with exact intervals.
- **Rank tests**: Mann-Whitney, Wilcoxon signed-rank, the sign test, Kruskal-Wallis with Dunn's tests, Friedman with Conover's and Nemenyi's tests, the Hodges-Lehmann shift, and the two-sample Kolmogorov-Smirnov test, exact for small samples.
- **Tables**: chi-square and G tests with expected counts and residuals, Fisher's exact test, McNemar's test, Cochran's Q, measures of association, the trend test, and the skill scores of a 2 × 2 forecast table.
- **Correlation**: Pearson, Spearman, and Kendall correlations with tests and intervals, correlation matrices with adjusted p-values, partial correlations, and tests that compare 2 correlations.
- **Many tests**: adjusted p-values and q-values, combined p-values, fixed- and random-effects meta-analysis with forest and funnel plots, volcano and Manhattan plots, and printed tables of critical values.

### Epidemiology

- **Epidemiology**: risk and odds ratios with intervals, numbers needed to treat, Mantel-Haenszel strata, diagnostic accuracy and post-test probabilities, incidence rates, and direct and indirect standardization. The US 2000 standard population comes from the National Center for Health Statistics (public domain), and the tool names it under the results.

### Planning and simulation

- **Power**: find the sample size a study needs, or its power. It covers t tests, ANOVA, chi-square, regression, correlations, proportions, and time to event. A curve shows how power grows with the sample size.
- **Resampling**: bootstrap intervals, permutation tests, a sampling-distribution lab, and coin, dice, urn, and random-walk simulations.
- **Bayes**: conjugate updates with credible and highest-density intervals, Bayes factors, grid posteriors from a likelihood you type, a Metropolis sampler, Bayes tables, and Bayesian networks of up to 8 true-or-false nodes (type each node with its parents and P(true) for each parent combination, then the evidence).
- **Design**: random assignment lists, Latin and Williams squares, factorial layouts, samples drawn from a list, stratified estimates, design effects, and margins of error.

## Data

- Most tools take numbers typed or pasted one list to a line. A line may start with a name and a colon, such as `Control: 4, 5, 6`.
- Correlation and two-way ANOVA read a table: paste it, open a CSV or TSV file, or pick a table on the open page, then choose the columns.

## Repeatable random results

- Every random result shows its seed. The same seed gives the same list, sample, or interval on any computer. New seed draws a fresh one.
