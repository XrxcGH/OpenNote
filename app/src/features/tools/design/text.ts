// The kit's words join the kitDesign namespace here, so they load with the kit and not at start-up. Every module
// that words the kit imports this file first; start-up holds only strings/en/kitDesignStart.ts.
import { en } from '../../../strings/en';
import { kitDesign } from '../../../strings/en/kitDesign';

Object.assign(en.kitDesign as object, kitDesign);
