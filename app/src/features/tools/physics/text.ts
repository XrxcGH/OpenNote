// The kit's words join the kitPhysics namespace here, so they load with the kit and not at start-up. Every module
// that words the kit imports this file first; start-up holds only strings/en/kitPhysicsStart.ts.
import { en } from '../../../strings/en';
import { kitPhysics } from '../../../strings/en/kitPhysics';

Object.assign(en.kitPhysics as object, kitPhysics);
