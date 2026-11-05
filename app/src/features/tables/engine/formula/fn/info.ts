// Information functions. Owner: tables:fn-logic-info. ISBLANK is the function tables had before the library; its
// behavior is unchanged.

import type { FnSpec2 } from './types';

export const functions: readonly FnSpec2[] = [
  {
    name: 'ISBLANK',
    family: 'info',
    params: [{ name: 'value', kind: 'value' }],
    handlesErrors: true,
    run: ([v]) => v === null,
    meta: { signature: 'ISBLANK(value)', example: '=ISBLANK("") gives FALSE' },
  },
];
