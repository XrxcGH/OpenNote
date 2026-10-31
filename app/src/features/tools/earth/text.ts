// Each earth kit tool's text joins the kitEarth namespace here, so it loads with the tools and not at start-up.
// Every module that words a tool's result imports this file first.
import { en } from '../../../strings/en';
import { kitEarthTools } from '../../../strings/en/kitEarthTools';

Object.assign(en.kitEarth as object, kitEarthTools);
