// The kit's words join the kitElectrical namespace here, so they load with the kit and not at start-up. Every module
// that words the kit imports this file first; start-up holds only strings/en/kitElectricalStart.ts.
import { en } from '../../../strings/en';
import { kitElectrical } from '../../../strings/en/kitElectrical';

Object.assign(en.kitElectrical as object, kitElectrical);
