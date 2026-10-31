// The economics kit's start-up words: its window title and its palette commands. The rest of
// kitEcon.ts joins this object when the kit's code loads (features/tools/econ/text.ts).
import type { kitEcon as all } from './kitEcon';

export const kitEconStart = {
  title: 'Economics and finance',
  open: 'Open economics and finance tools',
  keywords: 'economics finance accounting interest loan npv irr bond option supply demand gdp inflation ' + 'budget',
} as const;

/** The whole namespace as t() sees it. A test checks that these words are the same as in kitEcon.ts. */
export const kitEcon = kitEconStart as unknown as typeof all;
