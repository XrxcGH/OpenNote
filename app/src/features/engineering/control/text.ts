// The kit's words join the kitControl namespace here, so they load with the kit and not at start-up. Every module
// that words the kit imports this file first; start-up holds only strings/en/kitControlStart.ts.
import { en } from '../../../strings/en';
import { kitControl } from '../../../strings/en/kitControl';

Object.assign(en.kitControl as object, kitControl);
