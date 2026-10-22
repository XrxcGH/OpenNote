// The tool windows there are (Phases 7 and 10). Each has a name, a first size, and a title.
import type { MessageKey } from '../../../strings/t';

export type ToolId =
  | 'timers'
  | 'calculator'
  | 'upcoming'
  | 'flashcards'
  | 'converter'
  | 'reference'
  | 'dictionary'
  | 'citations'
  | 'formulasheet'
  | 'practice'
  | 'figure';

export interface ToolDef {
  id: ToolId;
  title: MessageKey;
  width: number;
}

export const TOOLS: readonly ToolDef[] = [
  { id: 'timers', title: 'smart.tools.timers.title', width: 340 },
  { id: 'calculator', title: 'smart.tools.calculator.title', width: 400 },
  { id: 'upcoming', title: 'smart.tools.upcoming.title', width: 380 },
  { id: 'flashcards', title: 'study.deck.tool', width: 420 },
  { id: 'converter', title: 'study.converter.title', width: 380 },
  { id: 'reference', title: 'study.reference.title', width: 480 },
  { id: 'dictionary', title: 'study.dictionary.title', width: 400 },
  { id: 'citations', title: 'study.citations.title', width: 440 },
  { id: 'formulasheet', title: 'docStructure.sheet.title', width: 400 },
  { id: 'practice', title: 'docStructure.practice.title', width: 440 },
  { id: 'figure', title: 'docStructure.figure.title', width: 420 },
];

export const isToolId = (value: unknown): value is ToolId => TOOLS.some((tool) => tool.id === value);
