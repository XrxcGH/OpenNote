// The capture scenes kept in separate files, one per group, so several people can add scenes at once.
import type { Helpers, Scene } from '../more';
import { scenes as g1 } from './g1';
import { scenes as g2 } from './g2';
import { scenes as g3 } from './g3';

export const groups = { g1, g2, g3 };

export const groupScenes = (h: Helpers): Scene[] => [...g1(h), ...g2(h), ...g3(h)];
