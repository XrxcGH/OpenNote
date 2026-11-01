// The kit's words join the kitFluidHeat namespace here, so they load with the kit and not at start-up. Every module
// that words the kit imports this file first; start-up holds only strings/en/kitFluidHeatStart.ts.
import { en } from '../../../strings/en';
import { kitFluidHeat } from '../../../strings/en/kitFluidHeat';

Object.assign(en.kitFluidHeat as object, kitFluidHeat);
