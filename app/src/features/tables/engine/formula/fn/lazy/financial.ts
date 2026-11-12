// The lazy chunk of the financial family (DESIGN.md, bundle note). Owner: tables:fn-finance. finance.ts loads it the
// first time a formula calls one of the 55 functions; the budget check limits it by this path.

import { runs as bonds } from '../financeBonds';
import { runs as depreciation } from '../financeDepr';
import type { Run } from '../financeKit';
import { runs as odd } from '../financeOdd';
import { runs as tvm } from '../financeTvm';

export const runs: Readonly<Record<string, Run>> = { ...tvm, ...depreciation, ...bonds, ...odd };
