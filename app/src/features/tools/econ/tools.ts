// The economics and finance tools the window offers, in the order of its picker.
import { FIRMS } from './firmsForms';
import { MONEY } from './moneyForms';
import { MARKETS } from './marketsForms';
import { MACRO } from './macroForms';
import { MEASURES } from './measuresForms';
import type { EconToolDef } from './forms';

export const ECON_TOOLS: readonly EconToolDef[] = [MONEY, FIRMS, MARKETS, MACRO, MEASURES];
