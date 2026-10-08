// The actions on a selection load the first time one runs; this keeps their code out of the start-up bundle.
export const loadMultiActions = () => import('./multiActions');
