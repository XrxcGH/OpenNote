// The kit's words join the kitHumanities namespace here, so they load with the kit and not at start-up. Every module
// that words the kit imports this file first; start-up holds only strings/en/kitHumanitiesStart.ts.
import { en } from '../../../strings/en';
import { kitHumanities } from '../../../strings/en/kitHumanities';

Object.assign(en.kitHumanities as object, kitHumanities);
