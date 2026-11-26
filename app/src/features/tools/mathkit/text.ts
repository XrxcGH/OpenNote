// The kit's words join the kitMath namespace here, so they load with the kit and not at start-up. Every module
// that words the kit imports this file first; start-up holds only strings/en/kitMathStart.ts.
import { en } from '../../../strings/en';
import { kitMath } from '../../../strings/en/kitMath';

Object.assign(en.kitMath as object, kitMath);
