// The command palette's public face. Other features open it through its commands, app.palette and
// app.quickSwitcher, and add results through the paletteProviders registry. The scorer is shared, so their
// results rank the same way.

export { normalize, score } from './score';
export { addSwitcherProvider } from './switcher';

// Every notebook, section, and page, for the Home page.
export { locationOf, nodeIndex } from './nodes';
export type { NodeEntry } from './nodes';
