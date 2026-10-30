// The reasoning kit's tools, in the order the window lists them. Each has a tab in the kit window and a command of
// its own in the palette (features/page/registrations/kitReasoning.ts).

export const REASONING_TOOLS = ['automata', 'discrete', 'digital', 'algorithms', 'optimize', 'games'] as const;

export type ReasoningToolId = (typeof REASONING_TOOLS)[number];

export const isReasoningTool = (value: unknown): value is ReasoningToolId =>
  (REASONING_TOOLS as readonly unknown[]).includes(value);
