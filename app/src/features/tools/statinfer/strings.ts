// The statistics kit's words load with the kit, not at start-up. This module adds the shared words to the
// kitStatInfer strings when the kit loads, and each tool adds its own with installTool when its tab first loads, so
// t() and the kit foundation's parts find every key. The palette and the window's tabs use only the words in
// strings/en/kitStatInfer.ts, which start-up has.
import { en } from '../../../strings/en';
import type { kitStatInferDetail } from '../../../strings/en/kitStatInfer/detail';
import { shared } from '../../../strings/en/kitStatInfer/shared';

export type StatInferMessages = typeof kitStatInferDetail;

type Section = 'err' | 'answer' | 'note' | 'col' | 'axis' | 'step';
const SECTIONS: readonly Section[] = ['err', 'answer', 'note', 'col', 'axis', 'step'];

const words = en.kitStatInfer as unknown as Record<string, Record<string, unknown>>;
for (const [name, part] of Object.entries(shared)) words[name] = { ...words[name], ...part };

/** Adds one tool's words: its fields under its own name, and its results and steps to the shared sections. */
export function installTool(name: string, strings: { fields: object } & Partial<Record<Section, object>>): void {
  words[name] = strings.fields as Record<string, unknown>;
  for (const section of SECTIONS) words[section] = { ...words[section], ...strings[section] };
}
