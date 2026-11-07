// Review's public face (ADR 0086): the light stores the Review tab reads at start-up, and loaders for the rest, so
// comments, suggestions, and the comments pane stay out of the start-up bundle.
export { reviewPrefs, suggesting } from './state';
export type { Markup } from './state';
export type { TextSeams } from './page';
export const loadReviewCommands = () => import('./commands');
export const loadReviewPage = () => import('./page');
export const loadReviewExtension = () => import('./extension');
