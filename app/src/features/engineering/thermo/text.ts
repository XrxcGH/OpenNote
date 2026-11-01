// The kit's words join the kitThermo namespace here, so they load with the kit and not at start-up. Every module
// that words the kit imports this file first; start-up holds only strings/en/kitThermoStart.ts.
import { en } from '../../../strings/en';
import { kitThermo } from '../../../strings/en/kitThermo';

Object.assign(en.kitThermo as object, kitThermo);
