// The voice-leading checker: four-part chorale writing and two-voice species counterpoint.
import type { ToolSpec } from '../spec';
import { FIELDS, mode } from './fields';
import { choraleMode, speciesMode } from './modes';

export const spec: ToolSpec = {
  id: 'partwriting',
  fields: FIELDS,
  run: (values) => (mode(values) === 'species' ? speciesMode(values) : choraleMode(values)),
};
