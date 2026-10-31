// Joins the window's words to the kitModPhys strings namespace. Only the window's name and tool list load at
// start-up (strings/en/kitModPhys.ts); every module here that looks up the rest imports this file first.
import { kitModPhys } from '../../../../strings/en/kitModPhys';
import { kitModPhysBody } from '../../../../strings/en/kitModPhys/body';

Object.assign(kitModPhys, kitModPhysBody);
