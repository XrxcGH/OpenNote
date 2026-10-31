# Statistical models

Fit models to data and see each answer worked out, step by step. These tools are new in Beta, so check the answers against your own work while you learn them.

## Open the tools

- Open the command palette (Ctrl+K) and type the tool's name, such as "Time series and forecasting", or type "Statistical models" to open the window on its first tab.
- The window has a tab for each tool. Use the arrow keys to move between tabs.
- Paste a table into Data, with the column names on the first line, or open a CSV or TSV file. Then pick the columns each role uses. Every tool has ready-made examples under Example.
- Results, worked steps, assumptions, and pictures update as you type. Insert adds the answer line, the equation, a result table, the steps, the result in words, or a picture to the page you last clicked in.
- Tools that use random numbers have a seed, so the same inputs always give the same answer.

## Regression

- **Linear regression** fits a formula such as `y ~ x1 * group + log(z)`, with categorical predictors, interactions, robust or clustered standard errors, diagnostics, intervals for new cases, nested-model F tests, moderation with Johnson-Neyman values, bootstrapped mediation, and a random intercept.
- **Logistic and Poisson regression** fit 0/1, grouped, and count outcomes with odds or rate ratios, likelihood-ratio tests, the ROC curve, and each IRLS step.

## Econometrics and causal inference

- **Panel fixed effects** remove each entity's mean (or each entity's and each period's, or take first differences) and give the within slope with classical or clustered errors.
- **Instrumental variables** run two-stage least squares with the first-stage F, the weak-instrument rule of thumb, and the Durbin-Wu-Hausman test.
- **Difference-in-differences** shows the 2 × 2 table of means and the same effect as a regression interaction, with clustered errors.
- **Event study** gives a coefficient for every period relative to the one before treatment began, with entity and period effects, the group gaps they come from, and a plot with the confidence band to check pre-trends.
- **Regression discontinuity** fits a weighted line on each side of the cutoff, with a triangular or uniform kernel, a binned scatter, and the estimate at other bandwidths.
- **Propensity scores** come from a logistic model and give weighted ATE and ATT, caliper matching, and a balance table of standardized mean differences.
- **Causal diagrams** take arrows such as `Z -> X`, list every minimal back-door adjustment set, flag mediators and descendants that must not be adjusted for, and check a set you type.

## Survival analysis

- **Survival analysis** draws Kaplan-Meier curves with the log-rank or Peto-Peto test, fits Cox proportional hazards models, and builds actuarial life tables.

## Time series

- **Explore** a series with log, difference, seasonal-difference, or moving-average transformations, the ACF and PACF with 95% bands, the Ljung-Box test, and a raw periodogram with its peak cycle length.
- **Decompose** it into trend, season, and remainder, additively or multiplicatively.
- **Exponential smoothing** forecasts by simple, Holt, or Holt-Winters smoothing. Leave a parameter blank to choose it by least squares, and hold out the last values to score the forecasts by MAE, RMSE, MAPE, and MASE.
- **AR and ARIMA** models are fitted by conditional sum of squares, Yule-Walker, or least squares, with forecast intervals from the model's ψ weights.
- **Trend tests** give Mann-Kendall with Sen's slope, and the augmented Dickey-Fuller statistic compared with quantiles simulated from seeded random walks.

## PCA, factors, and clusters

- **Principal components** of the covariance or correlation matrix, with a scree plot, loadings, scores, and a biplot.
- **Exploratory factor analysis** by principal axis factoring with varimax or promax rotation, and parallel analysis to choose how many factors to keep.
- **K-means** clustering from seeded k-means++ starts, with an elbow plot and silhouette widths.
- **Gaussian mixture** fits soft clusters by expectation-maximization from seeded k-means starts, with each row's chance of its cluster, the log-likelihood by round, and BIC to compare numbers of components.
- **Hierarchical clustering** with Ward, average, complete, or single linkage on Euclidean, Manhattan, or correlation distance, drawn as a dendrogram.
- **Clustered heat map** draws the data as shaded cells with the rows and the columns each in their tree's order, so alike rows and alike columns sit together; each cell shows its value too.
- **Multidimensional scaling** draws a map from a table of distances.

## Machine learning lab

- Learn from seeded toy sets (moons, blobs, circles, spirals, or separable groups) or from your own columns, with a seeded train-test split and k-fold cross-validation.
- Models: nearest neighbors, decision trees, naive Bayes, logistic regression, the perceptron, and a small neural network for classes; least squares, ridge, and the lasso for numbers.
- See the confusion matrix, precision, recall, F1, the ROC and precision-recall areas, decision-curve net benefit, decision regions for 2 features, the training loss, tree importances, and coefficient paths.

## Spatial statistics

- **Point patterns** give the mean center, the standard distance, the Clark-Evans ratio with its test, quadrat counts, and Ripley's L with an envelope from random patterns.
- **Spatial autocorrelation** gives Moran's I and Geary's C with normal and permutation tests, and local Moran clusters, using rook, queen, distance-band, nearest-neighbor, inverse-distance, or typed neighbor weights.
- **Interpolation** fits a spherical, exponential, or Gaussian semivariogram and predicts new places by ordinary kriging, with the kriging variance, and by inverse-distance weighting.
- **Contour maps** show the kriged values, their spread, and the inverse-distance values over a grid around the points.
