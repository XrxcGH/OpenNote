// The lazy chunk of the statistical families (DESIGN.md, bundle note). Owner: tables:fn-stats. It holds the
// functions past the basics, the distributions and their compatibility names, and the regression and forecasting
// functions. statsKit.ts loads it the first time a formula calls one of them; the budget check limits it by this path.

import { runs as distributions } from '../distributions';
import { runs as ets } from '../forecastEts';
import { runs as regression } from '../regression';
import { runs as more } from '../statsMore';
import type { Run } from '../statsKit';

export const runs: Readonly<Record<string, Run>> = { ...more, ...distributions, ...regression, ...ets };
