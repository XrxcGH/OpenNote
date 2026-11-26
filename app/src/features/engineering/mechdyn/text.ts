// The kit's words join the kitMechDyn namespace here, so they load with the kit and not at start-up. Every module
// that words the kit imports this file first; start-up holds only strings/en/kitMechDynStart.ts.
import { en } from '../../../strings/en';
import { kitMechDyn } from '../../../strings/en/kitMechDyn';

Object.assign(en.kitMechDyn as object, kitMechDyn);
