// Loads every feature's register.ts (ARCHITECTURE.md section 7.1), so adding a feature never edits a shared file.
// Importing this module registers each feature's commands, menu items, and title bar items once.

const modules = import.meta.glob('./*/register.ts', { eager: true });

/** The features that registered, such as 'theme'. */
export const FEATURES: readonly string[] = Object.keys(modules).map((path) => path.split('/')[1]);
