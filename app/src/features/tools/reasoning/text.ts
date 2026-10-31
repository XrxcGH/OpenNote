// The kit's words join the kitReasoning namespace here, so they load with the kit and not at start-up. Every module
// that words the kit imports this file first; start-up holds only strings/en/kitReasoningStart.ts.
import { en } from '../../../strings/en';
import { kitReasoning } from '../../../strings/en/kitReasoning';

Object.assign(en.kitReasoning as object, kitReasoning);
