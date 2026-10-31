// The kit's words join the kitCivil namespace here, so they load with the kit and not at start-up. Every module
// that words the kit imports this file first; start-up holds only strings/en/kitCivilStart.ts.
import { en } from '../../../strings/en';
import { kitCivil } from '../../../strings/en/kitCivil';

Object.assign(en.kitCivil as object, kitCivil);
