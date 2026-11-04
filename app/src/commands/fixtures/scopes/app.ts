// App-wide keys that every program's scope sits inside. Owner: shared:x-shared.
import type { ScopeFixture } from './types';

export const appScopes: ScopeFixture = {
  program: 'app',
  owner: 'shared:x-shared',
  commands: [
    { id: 'app.palette', keys: ['Ctrl+K'] },
    { id: 'tabs.next', keys: ['Ctrl+Tab'] },
    { id: 'tabs.previous', keys: ['Ctrl+Shift+Tab'] },
  ],
  cases: [
    { chord: 'Ctrl+K', at: 'global', expect: 'app.palette', why: 'Ctrl+K opens the palette' },
    { chord: 'Ctrl+K', at: 'page', expect: 'app.palette', why: 'Ctrl+K opens the palette on a page' },
    { chord: 'Ctrl+Tab', at: 'page', expect: 'tabs.next', why: 'Ctrl+Tab is the next page tab' },
    { chord: 'Ctrl+Shift+Tab', at: 'page', expect: 'tabs.previous', why: 'Ctrl+Shift+Tab is the previous page tab' },
  ],
};
