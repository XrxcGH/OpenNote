// The kit's words join the kitMolBio namespace here, so they load with the kit and not at start-up. Every module
// that words the kit imports this file first; start-up holds only strings/en/kitMolBioStart.ts.
import { en } from '../../../strings/en';
import { kitMolBio } from '../../../strings/en/kitMolBio';

Object.assign(en.kitMolBio as object, kitMolBio);
