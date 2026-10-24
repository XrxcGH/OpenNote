// Every entry that the packages list in entries/*.gallery.tsx.

import { collectEntries } from './registry';

export const entries = collectEntries(import.meta.glob('./entries/*.gallery.tsx', { eager: true }));
