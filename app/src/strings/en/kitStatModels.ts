// The statistical models kit: one window with a tab for each tool. Each tool's title and keywords are here, for the
// command palette at start-up. The window's shared words and error messages (kitStatModels/shared.ts), and the rest
// of a tool's words with its worked steps under step.<tool> (kitStatModels/<tool>.ts), load with the first tool the
// window opens (features/tools/statmodels/specs.ts).
import type { glm as GlmWords, glmSteps as GlmSteps } from './kitStatModels/glm';
import type { survival as SurvivalWords, survivalSteps as SurvivalSteps } from './kitStatModels/survival';
import type { regression as RegressionWords, regressionSteps as RegressionSteps } from './kitStatModels/regression';
import type { spatial as SpatialWords, spatialSteps as SpatialSteps } from './kitStatModels/spatial';
import type { causal as CausalWords, causalSteps as CausalSteps } from './kitStatModels/causal';
import type { timeseries as TimeseriesWords, timeseriesSteps as TimeseriesSteps } from './kitStatModels/timeseries';
import type {
  multivariate as MultivariateWords,
  multivariateSteps as MultivariateSteps,
} from './kitStatModels/multivariate';
import type { ml as MlWords, mlSteps as MlSteps } from './kitStatModels/ml';
import type { shared as SharedWords } from './kitStatModels/shared';

/** A tool's title and keywords, there from start-up; the rest of its words are added when it loads. */
type Eager = { title: string; keywords: string };

export const kitStatModels = {
  title: 'Statistical models',
  open: 'Open the statistical models tools',
  keywords:
    'statistics regression model econometrics survival time series multivariate machine learning spatial data analysis',
  tabs: 'Statistical model tools',
  loading: 'Loading the tool…',
  ui: {} as typeof SharedWords.ui,
  error: {} as typeof SharedWords.error,
  glm: {
    title: 'Logistic and Poisson regression',
    keywords:
      'logistic regression poisson glm generalized linear model odds ratio rate ratio binary count offset deviance ' +
      'roc auc hosmer lemeshow pseudo r2 classification',
  } as Eager & typeof GlmWords,
  survival: {
    title: 'Survival analysis',
    keywords:
      'survival analysis time to event kaplan meier log rank peto cox proportional hazards hazard ratio censoring ' +
      'life table actuarial nelson aalen median survival greenwood',
  } as Eager & typeof SurvivalWords,
  regression: {
    title: 'Linear regression',
    keywords:
      'linear regression ols least squares multiple regression anova coefficients r2 dummy categorical interaction ' +
      'diagnostics residuals cook leverage vif robust standard errors hc3 cluster prediction interval nested f test ' +
      'moderation simple slopes johnson neyman mediation sobel bootstrap mixed model random intercept icc reml',
  } as Eager & typeof RegressionWords,
  spatial: {
    title: 'Spatial statistics',
    keywords:
      'spatial statistics point pattern nearest neighbor clark evans quadrat ripley k function moran geary ' +
      'autocorrelation lisa local moran hot spot weights semivariogram variogram kriging ' +
      'contour map surface inverse distance geography',
  } as Eager & typeof SpatialWords,
  causal: {
    title: 'Econometrics and causal inference',
    keywords:
      'econometrics causal inference fixed effects panel within first differences instrumental variables two-stage ' +
      'least squares 2sls weak instrument hausman difference in differences event study ' +
      'leads lags pre-trends parallel trends regression discontinuity propensity score matching inverse probability weighting ate att dag back door confounder',
  } as Eager & typeof CausalWords,
  timeseries: {
    title: 'Time series and forecasting',
    keywords:
      'time series forecasting autocorrelation acf pacf correlogram ljung box decomposition seasonal trend moving ' +
      'average exponential smoothing holt winters arima ar yule walker forecast interval mann kendall sen slope ' +
      'dickey fuller unit root stationarity mae rmse mape mase',
  } as Eager & typeof TimeseriesWords,
  multivariate: {
    title: 'PCA, factors, and clusters',
    keywords:
      'multivariate principal components pca eigenvalue scree biplot loadings exploratory factor analysis principal ' +
      'axis varimax promax parallel analysis k means elbow silhouette hierarchical clustering dendrogram ward ' +
      'linkage multidimensional scaling mds perceptual map',
  } as Eager & typeof MultivariateWords,
  ml: {
    title: 'Machine learning lab',
    keywords:
      'machine learning classification regression k nearest neighbors decision tree cart gini naive bayes logistic ' +
      'gradient descent perceptron neural network multilayer backpropagation ridge lasso regularization cross ' +
      'validation confusion matrix precision recall f1 roc auc decision curve train test split',
  } as Eager & typeof MlWords,
  step: {
    glm: {} as typeof GlmSteps,
    survival: {} as typeof SurvivalSteps,
    regression: {} as typeof RegressionSteps,
    spatial: {} as typeof SpatialSteps,
    causal: {} as typeof CausalSteps,
    timeseries: {} as typeof TimeseriesSteps,
    multivariate: {} as typeof MultivariateSteps,
    ml: {} as typeof MlSteps,
  },
};
