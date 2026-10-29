# ADR 0050: The tutor gives graded hints from what the person shows it, on this device unless they agree to more

- Status: Proposed
- Date: 2026-10-29

## Context

DeriveNotes has an AI tutor. The owner asked for one in OpenNote (the dn-tutor lane), built on Check my work ([ADR 0051](0051-step-checking.md)). A tutor that hands over the answer teaches nothing, and one that reads a whole notebook, or sends it to a server, breaks the promise that notes stay on the device. The tutor also has to work with no language model at all, since most people will not download one.

## Decision

### The tutor and its ladder

- **Opt-in.** The flag `study.tutor` is on in development, nightly, and Beta builds. On each device the tutor stays off until the person turns it on: a tutor command asks once, and Settings, then Editing, has the switch. There is no telemetry.
- **The hint ladder.** Each problem has four rungs, one per press of Give me a hint:
  1. where to look,
  2. the idea or rule involved,
  3. the next step as a question,
  4. the next step shown.

  The full solution comes only when the person asks after trying (after a hint, a question, or with their own working on the page), and after a confirmation. Explain this step tells what went wrong in a flagged step and the rule involved, without the corrected line.

- **Three ways in.** Explain this step, on each flagged line of the Check my work card and in the palette. Give me a hint, on a selected problem (lassoed handwriting, selected typed lines, or, with nothing selected, the page's math lines), in the palette and the text menu. Open the tutor, in the palette. All three use the Tutor panel docked at the right of the page.
- **Context is what the person picks.** The panel shows "What the tutor sees": the lines taken from the page, which the person can edit or clear. Nothing else of the page or the notebook is read. The panel keeps the conversation while it is open, also across pages. Closing it forgets the conversation and every consent. At most 6,000 characters are read.

### Who writes the reply

- **Who writes the reply.**
  - The rules tutor always can, with no model (`features/tutor/ladder.ts`). It plans from Check my work's verdicts (a step that needs a look, with its reason code and corrected line), the worked steps of a linear equation in one letter, and the calculus engine's derivation steps (`calculusAnswer`, each step with its rule). Anything else, including questions in words, gets guided questions.
  - With a language model downloaded (`crates/llm-host`, through `intel/localModels`), the model writes the wording on this device. Its prompt carries the built-in hint as a base.
  - With the person's own key, a cloud service may write it, as below.
  - The full solution of math always comes from the rules, which work it out exactly. A model writes one only where the rules cannot.
- **The person's own key.** The tutor is its own cloud feature (`tutor`). It has its own key in Windows Credential Manager, its own choice in Settings, and its own line in Privacy.
  - Before every cloud request, the panel shows the exact text to be sent (the instructions and the prompt) and the host. It offers Send this and Keep it on this device.
  - A yes holds only for that exact text. A later hint sends the next rung's task and the last four turns, which is different text, so it shows its own card first, and the card says so.
  - A question the person types in Ask the tutor is new text of theirs. The card shows again with the question in the text to send, and that answer holds for that question only.
  - New or edited context asks again, and a no keeps that context on the device for the session.
  - The shell's `Cloud::tutor` sends only that text, capped, to the one pinned host.
- **Work offline.** While it is on, the interface never asks to send and never calls the cloud. The shell refuses `cloud.tutor` with `offline` too, as it does in safe mode. The panel says the tutor stays on this device, and the on-device model or the rules answer.

### The answer-leak guard

- **The answer-leak guard** (`features/tutor/guard.ts`). Every hint before the full solution is checked against what the person is working toward:
  - the final answer, from the linear-equation steps or the calculus engine;
  - before the last rung, the next line too: Check my work's corrected line, or the next worked step.

  Both sides are compared in one written form, with spacing, minus signs, and LaTeX wrapping evened out. The guard also catches the value said in words, such as "x is 2" or "the answer is 2". Text the person already wrote is not secret.

- **Written another way.** The guard compares the secret written several ways:
  - x^(2) and x² as x^2, 2·x as 2x, full-width signs as plain ones, and cos x as cos(x).
  - Brackets around one term dropped, terms in any order, sides swapped, and "+ C" left off.
  - A value such as 7/2 written as 3.5, 3 1/2, or 3,5, or said in words ("three and a half", "seven halves"). A value within rounding (2.000000001) counts.
  - A link between a name and its value made with a sign (=, ≈, ~, →, ∈ {…}) or with words ("must equal", "ends up as", "comes to").
  - With the math kit loaded, a formula with the secret's values: "(1/3)x^3 + C" gives away x^3/3 + C, and "x^2 * 3" gives away 3x^2.
- **A bare number.** The answer may be a number: a limit of 1, a sum of 2, a derivative at a point.
  - The guard refuses it after a link ("the limit is 1", "it comes to one", "= 1") and as a sentence of its own.
  - It allows the number as a piece of the question the student wrote (the n = 1 of a sum).
  - For a next line such as 2x = 4, it refuses "2x is 4", "the right side becomes 4", and "7 - 3 = 4".
  - When the next step is the answer itself, the last rung says so instead of showing it.
- **No known answer.** For subjects whose answer the rules cannot work out (chemistry, physics, word problems), the guard is a heuristic. Before the last rung, it refuses a reply that states a result with a number the student's text does not hold.
  - It catches "the answer is 36 g", "so F = 6 N", and "F = 6".
  - It catches a number after is, get, gives, yields, produces, makes, forms, equals, or comes to ("you get 36 grams of water", "F is 6 N"), and "so 36 g forms".
  - It catches a number with a unit as a sentence of its own ("40 mph"), in digits or words ("thirty-six grams").
  - A unit must be a known one (g, mol, N, m/s, mph, %, and their names), so "n = 1 or n = 2" is not read as a result.
  - A result put any other way can get through.
- **When a hint leaks.** The on-device model is asked once more with a stricter instruction, then the built-in hint is shown. A cloud reply that leaks is not retried with a stricter text the person never saw: the built-in hint shows instead. The rules' own hints pass the same guard. A last rung whose next step is the answer says so and leaves the step to the person.
- **Tone.** Short, kind, plain words for students, no jargon. Replies longer than 700 characters, or empty, are refused.

## Consequences

- The tutor works fully offline with no download. Its built-in hints cover slips that Check my work names, linear equations, and the calculus the engine can work. Other math and other subjects get guided questions, and the full solution there needs a model.
- A model can still word a hint badly. The guard stops the answer and the next line, not every unhelpful hint.
- A cloud request sends the context and the conversation already on screen, never anything else. The consent card shows every request in full before it goes; nothing is sent that the card did not show.

## Not done

- A hand test with students, and with a real downloaded model and a real key, which are the owner's.
- Hints for proofs, geometry figures, and handwriting that is not math.
