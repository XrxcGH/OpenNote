// The lazy chunk of the statistical families (DESIGN.md, bundle note): the distributions, their compatibility names,
// and the regression and forecasting functions. Owner: tables:fn-stats. statsKit.ts loads it the first time a formula
// calls one of them, and the budget check limits it under this path.

import { runs as distributions } from '../distributions';
import { runs as ets } from '../forecastEts';
import { runs as regression } from '../regression';
import type { Run } from '../statsKit';

export const runs: Readonly<Record<string, Run>> = { ...distributions, ...regression, ...ets };
