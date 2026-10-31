# ADR 0052: Practice exams are made on the device, taken in a tool window, and saved as ordinary pages

- Status: Proposed
- Date: 2026-10-29

## Context

The owner asked for practice exams from a person's own notes, after comparing OpenNote with DeriveNotes. A paper comes from pages, a section, or a notebook. It has marks, mixed question types, a difficulty, a length, and an optional timer. It needs an answer key with a marking guide, marking, and a weak-topic summary that links back to the notes. Missed questions go to the flashcards. Flashcards, quizzes, and their schedule already exist (`app/src/features/study/deck`), the expression engine can compare values with units (`app/src/core/expr`), and a language model can run on the device (`app/src/features/intel/localModels`). Notes must not leave the device unless the person turns on a cloud feature.

## Decision

- **Questions are written on the device.** The rules (`study/exam/generate.ts`) read the same things the flashcard maker reads (`deck/generate.ts`): "Term: meaning" lines, headings with a paragraph, bold words, "Q :: A" lines, and worked problems with a Solution heading. They make five kinds of question. Short answers ask for a meaning. Multiple choice uses other meanings as the wrong options. True or false swaps in another meaning for a false statement. Fill-in hides a bold word or a term. Worked problems come from the notes' solutions. A worked problem gets new numbers when one of its steps holds the arithmetic for its answer: the numbers it shares with the problem are swapped for nearby ones, and the engine works out the new answer (`variant.ts`). Difficulty changes the mix of kinds, the number of options, and the marks. A seed gives the same paper again.
- **The language model is optional and checked.** When a language model is downloaded and the Settings switch allows it, the model gets at most 12,000 characters of the notes and returns JSON. Every question must have a known kind, a prompt and an answer of sensible length, options that hold the answer, a passage that exists, and an answer whose words are in that passage (`model.ts`). If the model fails, or fewer than half its questions pass, the rules write the paper; otherwise the rules write the rest of it. The person's own cloud key is not used for exams (deferred; see below).
- **Marking by value.** Multiple choice, true or false, and blanks are marked by the app. The expression engine marks a number or an expression, with the calculator's units (`equivalence.ts`). Quantities compare in base units, so 20 m/s equals 72 km/h. A rounded answer within the question's tolerance counts. A right number without its unit loses a mark. Expressions with letters compare at five sample points. Answers in words, handwritten answers, and the method of a worked problem whose final answer is wrong are marked by the person, with the key and the marking guide beside their answer. Nothing it reads can make it throw: unreadable text goes to the person.
- **One window.** The exam is a tool window (`exam`), so it can be popped out and moved like Flashcards. It shows the settings, then the paper, the exam (one question at a time or all, with a flag for review, typed math, and an area to write in), and the marking. The timer counts down, pauses, and announces reminders. When time is up it says so, and the person submits; it never takes the paper away (WCAG 2.2.1). The attempt in progress is kept in this device's storage a moment after each change and when the window closes (`attempt.ts`). It holds the paper, answers, flags, the question on screen, and the timer as its wall-clock values, so paused time stays paused. A restart, a reload, a pop-out, or a new exam does not lose it: the window offers to carry on with it, and submitting drops it. At most five are kept.
- **Pages, not a new store.** Before the exam, "Save the blank paper" makes a page in the notebook's "Practice exams" section (made when first needed), so it prints without the answers. The key is never saved before submission, so it cannot be opened mid-exam. "Save results" adds the answer key and a results page with the score, each question's marks and answer, and the weak topics with `opennote://page` links to their notes. They sync, search, print, and export like any page. Exams are never made from that section, and protected pages are left out (ADR 0042).
- **Flashcards reuse the decks.** Missed questions become cards of the same kind (choice, cloze, or basic) in a deck named for the exam, through the deck library; each card remembers its question, so sending twice adds nothing.

## Retakes, the kept key, and handwriting

When the results are saved, the paper, key, and results pages each keep the whole exam in the page view, as `practiceExam` version 1 (`stored.ts`). A paper saved earlier gets it then. Nothing is written before submission, so the notebook holds no key mid-exam.

"Retake this practice exam" (Ctrl+K on one of those pages) and "Take this exam again" on the results open a fresh copy. It has the same questions under a new id, with no answers. A paper saved but never handed in holds no exam, so it cannot be retaken.

The attempt in progress keeps the paper without its key. The model answers, guides, right options, tolerances, and fill-in words sit apart under their own storage name, encoded. They are joined to the paper when it is handed in. A look at the device's storage mid-exam shows no answers. This is not a lock: the key must be on the device to mark the exam there.

Handwritten answers go on the results page under "Handwritten answers". Each is an SVG picture of its strokes, in the light theme's ink on page color, the area's shape, with alt text. The results list each question's marks and answer as a list, since a text block shows a Markdown table as plain text.

Writing questions with the person's own cloud key is deferred. If it is added, it goes behind the cloud consent (`intel/cloud`), off by default, and sends only the chosen notes.

## Time up and changed marks

Time running out never locks the paper or takes it away. This is a choice, made for WCAG 2.2.1 (timing adjustable): the window says time is up, and the person submits when they are ready. A late paper is still marked in full.

The results then say how long after the time ran out the paper was handed in, on screen and on the saved results page. `lateBy` in `timer.ts` reads this from the wall clock, so time with the app closed counts. Lateness belongs to the whole paper; answers carry no times of their own.

A blank in words is matched as spelled. Case and spacing are evened out, and the key may list alternatives with `/`, `;` or `|`. A typo or a plural scores nothing, so the fill-in card says that words must match the key. Every mark the app gives can be changed on the results page, which keeps the app's mark beside the person's.

## Options considered

| Option | For | Against |
|---|---|---|
| Rules, with the on-device model when there is one (chosen) | Works on every computer; nothing leaves the device; a model makes better questions where it can | Rule questions are plainer and depend on how the notes are written |
| Only a language model | More varied questions | Most people have no model downloaded; a model can invent facts |
| An exam block on the page | The exam lives in the page | A block is the wrong size for a timed exam; the page would hold the key beside the paper |
| A separate exam store | Easy to retake an exam | Exams would not sync, export, or print; another store to keep |

## Consequences

An exam saved with its results can be retaken from any of its pages. Handwritten answers are marked by the person; the results page keeps them as pictures, not as editable ink. Reading handwriting as math uses the on-device handwriting reader when it is on.
