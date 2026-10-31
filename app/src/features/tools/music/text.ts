// The kit's words join the kitMusic namespace here, so they load with the kit and not at start-up. Every module
// that words the kit imports this file first; start-up holds only strings/en/kitMusicStart.ts.
import { en } from '../../../strings/en';
import { kitMusic } from '../../../strings/en/kitMusic';

Object.assign(en.kitMusic as object, kitMusic);
