// First-run setup's public face (owner after WP0: WP3).

export { installSetup } from './runtime';
export { SetupView } from './SetupView';

// For the steps that other features register in setup.
export { StepHeader } from './StepHeader';
export { default as setupStyles } from './SetupView.module.css';
