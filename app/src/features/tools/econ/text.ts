// The kit's words join the kitEcon namespace here, so they load with the kit and not at start-up. Every module
// that words the kit imports this file first; start-up holds only strings/en/kitEconStart.ts.
import { en } from '../../../strings/en';
import { kitEcon } from '../../../strings/en/kitEcon';

Object.assign(en.kitEcon as object, kitEcon);
