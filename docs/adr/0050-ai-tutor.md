# ADR 0050: The tutor gives graded hints from what the person shows it, on this device unless they agree to more

- Status: Proposed
- Date: 2026-10-29

## Contents

- [Context](#context)
- [Decision](#decision)
- [Consequences](#consequences)
- [Not done](#not-done)

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

  The full solution comes only when the person asks after trying, and after a confirmation. Trying is a hint, a question, or a line of their own working. A line of working comes after the first, and Check my work reads it as a step, not as the problem, a note, or words. Explain this step tells what went wrong in a flagged step and the rule involved, without the corrected line.

- **Three ways in.** Explain this step, on each flagged line of the Check my work card and in the palette. Give me a hint, on a selected problem (lassoed handwriting, selected typed lines, or, with nothing selected, the page's math lines), in the palette and the text menu. Open the tutor, in the palette. All three use the Tutor panel docked at the right of the page.
- **Context is what the person picks.** The panel shows "What the tutor sees": the lines taken from the page, which the person can edit or clear. Nothing else of the page or the notebook is read. The panel keeps the conversation while it is open, also across pages. Closing it forgets the conversation and every consent. At most 6,000 characters are read.

### Who writes the reply

- **Who writes the reply.**
  - The rules tutor always can, with no model (`features/tutor/ladder.ts`). It plans from Check my work's verdicts (a step that needs a look, with its reason code and corrected line), the worked steps of a linear equation in one letter, and the calculus engine's derivation steps (`calculusAnswer`, each step with its rule). Anything else, including questions in words, gets guided questions. Some steps Check my work leaves unchecked for a reason that is a finding in itself. Such a step drops a root, holds for some values only, is never true, or keeps a value an earlier line rules out. The tutor treats it as a slip to look at by trying a value, and never passes on the dropped root. Working is praised as finished only when every step Check my work looked at follows.
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
  - A link between a name and its value made with a sign (=, ≈, ~, →, ->, ⇒, ≡, ∈ {…}) or with words ("must equal", "ends up as", "comes to"). A bare number after any of those signs counts the same ("sin(x)/x → 1").
  - With the math kit loaded, a formula with the secret's values: "(1/3)x^3 + C" gives away x^3/3 + C, and "x^2 * 3" gives away 3x^2. A rounded decimal counts within a little over its last place ("0.333x^3 + C"), and so does the constant anywhere ("(x^3 + 3C)/3").
  - An answer given piece by piece: the right sides of a hint added up ("d/dx(x^3) = 3x^2 and d/dx(5x) = 5"), and, before the last rung, one term of an answer that is a sum ("the first piece gives 3x^2"). The last rung shows a step that may hold such a term, so it checks the whole answer only.
  - A letter's value worked out: "x = 1 + 1", "x = sqrt(4)", `x = \frac{4}{2}`, "x = [2]", "x is half of 4", "x = ten minus eight", and "ex equals two". Digits of any script count as their value ("x = ٢").
### Bare numbers

- **A bare number.** The answer may be a number: a limit of 1, a sum of 2, a derivative at a point.
  - The guard refuses it after a link ("the limit is 1", "it comes to one", "= 1") and as a sentence of its own.
  - It allows the number as a piece of the question the student wrote (the n = 1 of a sum).
  - For a next line such as 2x = 4, it refuses "2x is 4", "the right side becomes 4", "7 - 3 = 4", and a correction that swaps the student's number for it ("Replace 10 with 4", "The 10 should be a 4", "Not 10, but 4").
  - When the next step is the answer itself, the last rung says so instead of showing it.
### No known answer

- **No known answer.** For subjects whose answer the rules cannot work out (chemistry, physics, word problems, or a quadratic whose roots the rules cannot list), the guard is a heuristic. At every rung, the last one too, it refuses a reply that states a result with a number the student's text does not hold.
  - The last rung may show Check my work's corrected line, so that line's numbers are allowed there. A result beyond it still waits for the full solution and its confirmation.
  - A question typed after the last hint is held to the last rung, as the built-in reply to it is.
  - A letter's value is held to more: "x = 3", "x ∈ {2, 3}", "the solutions are 2 and 3", or "both 2 and 3 work" is refused unless the student stated that value the same way (a line such as x = 3). The numbers of a problem are often its answer, as the 3 of (x - 3) is, so a number that appears anywhere in the student's text does not excuse it. A lone number ("Three.") is refused when the student's text solves for a letter or ends in a question.
  - It catches "the answer is 36 g", "so F = 6 N", and "F = 6".
  - It catches a number after is, get, gives, giving, yields, produces, makes, forms, equals, or comes to ("you get 36 grams of water", "F is 6 N"), and "so 36 g forms".
  - It catches a number after the link words the letter check uses ("F would be 6 N", "you end up with 36 g", "works out as 36 g").
  - It catches an arrow as well as "=" ("F → 6 N"), "Answer 36 g", a colon after any clause ("Multiply 2 by 3: 6 N"), and an amount followed by total, in all, or a bracket ("36 g total", "36 g (two moles)").
  - It catches a number with a unit as a sentence of its own ("40 mph"), in digits or words ("thirty-six grams").
  - A unit must be a known one (g, mol, N, m/s, mph, %, and their names), so "n = 1 or n = 2" is not read as a result.
  - A result put any other way can get through.
### When a hint leaks

- **When a hint leaks.** The on-device model is asked once more with a stricter instruction, then the built-in hint is shown. A cloud reply that leaks is not retried with a stricter text the person never saw: the built-in hint shows instead. The rules' own hints pass the same guard. A last rung whose next step is the answer says so and leaves the step to the person.
- **Tone.** Short, kind, plain words for students, no jargon. Replies longer than 700 characters, or empty, are refused.

## Consequences

- The tutor works fully offline with no download. Its built-in hints cover slips that Check my work names, linear equations, and the calculus the engine can work. Other math and other subjects get guided questions, and the full solution there needs a model.
- A model can still word a hint badly. The guard stops the answer and the next line, not every unhelpful hint.
- A cloud request sends the context and the conversation already on screen, never anything else. The consent card shows every request in full before it goes; nothing is sent that the card did not show.

## Not done

- A hand test with students, and with a real downloaded model and a real key, which are the owner's.
- Hints for proofs, geometry figures, and handwriting that is not math.
