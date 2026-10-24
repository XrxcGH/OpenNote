// The economics, finance, and accounting tools: one window with a picker for the subject and the calculator. Each
// subject's words are in a module of its own under kitEcon/.
import { money } from './kitEcon/money';
import { firms } from './kitEcon/firms';
import { markets } from './kitEcon/markets';
import { macro } from './kitEcon/macro';
import { measures } from './kitEcon/measures';
import { choice } from './kitEcon/choice';
import { accounting } from './kitEcon/accounting';
import { invest } from './kitEcon/invest';

export const kitEcon = {
  title: 'Economics and finance',
  open: 'Open economics and finance tools',
  keywords: 'economics finance accounting interest loan npv irr bond option supply demand gdp inflation budget',
  common: {
    tool: 'Subject',
    calculator: 'Calculator',
    missing: 'Enter a number for {name}.',
    notNumber: '{name} is not a number.',
  },
  money,
  firms,
  markets,
  macro,
  measures,
  choice,
  accounting,
  invest,
} as const;
