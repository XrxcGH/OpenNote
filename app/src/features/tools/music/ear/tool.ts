// Ear training: seeded drills with answers checked, and sessions whose weak items are scheduled for review.
import type { ToolSpec } from '../spec';
import { FIELDS } from './fields';
import { runDrill } from './modes';

export const spec: ToolSpec = {
  id: 'ear',
  fields: FIELDS,
  run: runDrill,
};
