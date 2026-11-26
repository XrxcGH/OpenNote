// The kit's words join the kitSolids namespace here, so they load with the kit and not at start-up. Every module
// that words the kit imports this file first; start-up holds only strings/en/kitSolidsStart.ts.
import { en } from '../../../strings/en';
import { kitSolids } from '../../../strings/en/kitSolids';

Object.assign(en.kitSolids as object, kitSolids);
