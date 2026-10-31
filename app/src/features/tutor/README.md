# Tutor

Graded hints and explanations of flagged steps ([ADR 0050](../../../../docs/adr/0050-ai-tutor.md)). The pure parts live here; the page side (the panel's mounting and reading the selected lines) is in `features/page/tutor/`, and the commands in `features/page/registrations/tutor.ts`.

| File               | What it holds                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `ladder.ts`        | The plan for the chosen lines and the four rungs, the explanation, and the full solution, with no model |
| `equation.ts`      | The worked steps of a linear equation in one letter                                                     |
| `guard.ts`         | The answer-leak guard                                                                                   |
| `engine.ts`        | Who writes a reply (rules, the on-device model, or the person's own key), the prompt, and the fallbacks |
| `session.ts`       | One session: the context, the conversation, the rung, and the consent for the person's own key          |
| `choice.ts`        | The opt-in switch                                                                                       |
| `index.ts`         | The small door: the opt-in choice, the switch, and `loadTutorPanel`, which loads `panel.ts`             |
| `panel.ts`         | The heavier half the door loads once the tutor is on: the panel, the session, and the math kit loader   |
| `TutorPanel.tsx`   | The panel docked at the right                                                                           |
| `TutorSetting.tsx` | The switch in Settings, then Editing, and the choice of where the tutor writes                          |

Strings are in `strings/en/tutor.ts`. Tests: `tutor.test.ts` (unit) and `tests/ui/behavior/tutor.spec.ts` (the main flow).
