// The kit's words join the kitAero namespace here, so they load with the kit and not at start-up. Every module
// that words the kit imports this file first; start-up holds only strings/en/kitAeroStart.ts.
import { en } from '../../../strings/en';
import { kitAero } from '../../../strings/en/kitAero';

Object.assign(en.kitAero as object, kitAero);
