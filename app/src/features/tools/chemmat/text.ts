// The kit's words join the kitChemMat namespace here, so they load with the kit and not at start-up. Every module
// that words the kit imports this file first; start-up holds only strings/en/kitChemMatStart.ts.
import { en } from '../../../strings/en';
import { kitChemMat } from '../../../strings/en/kitChemMat';

Object.assign(en.kitChemMat as object, kitChemMat);
