# ADR 0050: The tutor gives graded hints from what the person shows it, on this device unless they agree to more

- Status: Proposed
- Date: 2026-10-29

## Context

DeriveNotes has an AI tutor. The owner asked for one in OpenNote (the dn-tutor lane), built on Check my work ([ADR 0051](0051-step-checking.md)). A tutor that hands over the answer teaches nothing, and one that reads a whole notebook, or sends it to a server, breaks the promise that notes stay on the device. The tutor also has to work with no language model at all, since most people will not download one.

## Decision

- **Opt-in.** The flag `study.tutor` is on in development, nightly, and Beta builds. On each device the tutor stays off until the person turns it on: a tutor command asks once, and Settings, then Editing, has the switch. There is no telemetry.
- **The hint ladder.** Each problem has four rungs, one per press of Give me a hint:
  1. where to look,
  2. the idea or rule involved,
  3. the next step as a question,
  4. the next step shown.

  The full solution comes only when the person asks after trying (after a hint, a question, or with their own working on the page), and after a confirmation. Explain this step tells what went wrong in a flagged step and the rule involved, without the corrected line.

- **Three ways in.** Explain this step, on each flagged line of the Check my work card and in the palette. Give me a hint, on a selected problem (lassoed handwriting, selected typed lines, or, with nothing selected, the page's math lines), in the palette and the text menu. Open the tutor, in the palette. All three use the Tutor panel docked at the right of the page.
- **Context is what the person picks.** The panel shows "What the tutor sees": the lines taken from the page, which the person can edit or clear. Nothing else of the page or the notebook is read. The panel keeps the conversation while it is open, also across pages. Closing it forgets the conversation and every consent. At most 6,000 characters are read.
- **Who writes the reply.**
  - The rules tutor always can, with no model (`features/tutor/ladder.ts`). It plans from Check my work's verdicts (a step that needs a look, with its reason code and corrected line), the worked steps of a linear equation in one letter, and the calculus engine's derivation steps (`calculusAnswer`, each step with its rule). Anything else, including questions in words, gets guided questions.
  - With a language model downloaded (`crates/llm-host`, through `intel/localModels`), the model writes the wording on this device. Its prompt carries the built-in hint as a base.
  - With the person's own key, a cloud service may write it, as below.
  - The full solution of math always comes from the rules, which work it out exactly. A model writes one only where the rules cannot.
- **The person's own key.** The tutor is its own cloud feature (`tutor`), with its own key in Windows Credential Manager, its own choice in Settings, and its own line in Privacy. Before the first request of a session, the panel shows the exact text to be sent (the instructions and the prompt) and the host, with Send for this session and Keep it on this device. A yes covers the rest of the session for that same context; new or edited context asks again, and a no keeps that context on the device for the session. The shell's `Cloud::tutor` sends only that text, capped, to the one pinned host.
- **Work offline.** While it is on, the interface never asks to send and never calls the cloud. The shell refuses `cloud.tutor` with `offline` too, as it does in safe mode. The panel says the tutor stays on this device, and the on-device model or the rules answer.
- **The answer-leak guard** (`features/tutor/guard.ts`). Every hint before the full solution is checked against what the person is working toward:
  - the final answer, from the linear-equation steps or the calculus engine;
  - before the last rung, the next line too: Check my work's corrected line, or the next worked step.

  Both sides are compared in one written form, with spacing, minus signs, and LaTeX wrapping evened out. The guard also catches the value said in words, such as "x is 2" or "the answer is 2". Text the person already wrote is not secret.

- **When a hint leaks.** The on-device model is asked once more with a stricter instruction, then the built-in hint is shown. A cloud reply that leaks is not retried, because the person agreed to one exact text: the built-in hint shows instead. The rules' own hints pass the same guard. A last rung whose next step is the answer says so and leaves the step to the person.
- **Tone.** Short, kind, plain words for students, no jargon. Replies longer than 700 characters, or empty, are refused.

## Consequences

- The tutor works fully offline with no download. Its built-in hints cover slips that Check my work names, linear equations, and the calculus the engine can work. Other math and other subjects get guided questions, and the full solution there needs a model.
- A model can still word a hint badly. The guard stops the answer and the next line, not every unhelpful hint.
- A cloud request sends the context and the conversation already on screen, never anything else. The consent card shows the first request in full; later requests in the same session send the same context with the next hint request.

## Not done

- A hand test with students, and with a real downloaded model and a real key, which are the owner's.
- Hints for proofs, geometry figures, and handwriting that is not math.
