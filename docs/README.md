# OpenNote documentation

This folder holds the plans, guides, and records behind OpenNote. Pick a group below. For the user guide, development updates, and the developer guide, see the [project wiki](https://github.com/XrxcGH/OpenNote/wiki).

## Contents

- [Help for people using the app](#help-for-people-using-the-app)
- [Plan](#plan)
- [Design and screens](#design-and-screens)
- [Quality and testing](#quality-and-testing)
- [Decisions](#decisions)
- [File format](#file-format)
- [Engineering guides](#engineering-guides)
- [Performance records](#performance-records)
- [Releasing](#releasing)
- [Elsewhere in the repository](#elsewhere-in-the-repository)

## Help for people using the app

The [help index](help/README.md) lists every page. Each one is short and has a screenshot.

- [typed-notes.md](help/typed-notes.md): text, lists, checklists, the slash menu, templates, and find and replace.
- [moving-between-blocks.md](help/moving-between-blocks.md): the keys that move between text, images, tables, and code on a page.
- [ink-and-palm-rejection.md](help/ink-and-palm-rejection.md): pens, erasers, shapes, gestures, and resting your hand on the screen.
- [paper-and-page-views.md](help/paper-and-page-views.md): flow, paginated, and canvas pages, lined paper, presets, slides, and print.
- [tables-and-charts.md](help/tables-and-charts.md): smart tables, formulas, views, and charts.
- [math-and-graphs.md](help/math-and-graphs.md): equations, quick math, the grapher, and diagrams.
- [search-and-links.md](help/search-and-links.md): search, page links, backlinks, tags, and daily notes.
- [study-tools.md](help/study-tools.md): flashcards, Upcoming, timers, the calculator, and citations.
- [recording.md](help/recording.md): recording with stamped notes, trimming, transcripts, and recaps.
- [import-and-export.md](help/import-and-export.md): other apps' files in, and Markdown, Word, PDF, and more out.
- [on-device-intelligence.md](help/on-device-intelligence.md): reading pictures, summaries, Ask your notes, and handwriting to text.
- [privacy-and-work-offline.md](help/privacy-and-work-offline.md): what uses the network, and how to stop it.
- [connectors.md](help/connectors.md): signing in to other services.

## Plan

- [DEVELOPMENT.md](DEVELOPMENT.md): the step-by-step plan for the Windows prototype, with phases, technology choices, tests, and release gates. Each phase has a beta 4 status note.
- [FEATURES.md](FEATURES.md): the feature spec for Office and Google integration, handwriting, transcripts, study tools, and more. Each feature is marked built, built but untested by hand, not built yet, or needing the owner.
- [RESEARCH.md](RESEARCH.md): popular and rising note apps, the features people love, and the gaps OpenNote can fill.
- [../CHANGELOG.md](../CHANGELOG.md): what each beta added, changed, and fixed.

## Design and screens

- [BRAND.md](BRAND.md): colors, type, layout, motion, voice, accessibility, and performance budgets.
- [design/SCREENS.md](design/SCREENS.md): 34 wireframes of every major screen, with sizes and keep-out zones. The drawings are in `design/images/`, and `design/generate.ts` makes them.
- [screens/README.md](screens/README.md): 70 real screenshots of beta 4, 35 screens in light and dark, with what each one shows.

## Quality and testing

- [CHECKS.md](CHECKS.md): the quality gate every file change must pass, with its rules and settings.
- [testing/beta-4-checklist.md](testing/beta-4-checklist.md): the hand test checklist for beta 4, starting with how to run it on a throwaway profile so real notes stay safe.
- [testing/palm-rejection.md](testing/palm-rejection.md): the palm rejection test with a real pen.
- [testing/keyboard-and-screen-reader.md](testing/keyboard-and-screen-reader.md): the checklist a person runs at each phase exit and before each beta, with a screen reader and no mouse.
- [testing/hardware-kit.md](testing/hardware-kit.md): one command for each exit gate that needs a device (crash on a drive, typing on four cores, pen latency, Phase 12 accuracy), and where the results go.
- [HARDENING.md](HARDENING.md): the nightly tests, opt-in crash reports, the self-check, the feedback file, and safe start.

## Decisions

- [adr/README.md](adr/README.md): every architecture decision record (ADR) with its status, which ones wait on a check, and how to write one.

## File format

- [format/README.md](format/README.md): the note file format specification, tools, and fixtures.

## Engineering guides

- [intel.md](intel.md): the `opennote-intel` crate, with the engines for text in pictures, handwriting, read aloud, summaries, and speech.
- [CONNECTORS.md](CONNECTORS.md): the owner's guide to registering OpenNote with each service that connected accounts use, and where the client IDs go.

## Performance records

- [perf/phase-4.md](perf/phase-4.md): how Phase 4's typing speed was measured, the numbers, and what is still over budget.
- [perf/phase-5-core.md](perf/phase-5-core.md): the 10,000-stroke benchmark of the ink core, with its method and numbers.
- [perf/phase-5.md](perf/phase-5.md): pen-to-screen time and frame rate on a page of 10,000 strokes.
- [perf/palm-accuracy.md](perf/palm-accuracy.md): palm rejection accuracy on 61 adversarial scenarios and labeled recordings.
- [perf/palm-competitors.md](perf/palm-competitors.md): the palm rejection baseline from other apps, so the claim of better accuracy can be checked.
- [perf/phase-6-core.md](perf/phase-6-core.md): the page views and the PDF export, measured.
- [perf/phase-8-core.md](perf/phase-8-core.md): how fast the Phase 8 search core runs, with the corpus, the method, the numbers, and the open questions.
- [perf/phase-9-core.md](perf/phase-9-core.md): what recording costs in processor time, how well the timestamps hold over three hours, and how much a crash loses.
- [perf/phase-11-core.md](perf/phase-11-core.md): how fast import and export run at 1,000 pages, and how much memory they use.
- [perf/expr-engine.md](perf/expr-engine.md): what the shared expression engine for the calculator, the grapher, and table formulas costs.

## Releasing

- [RELEASING.md](RELEASING.md): the maintainer guide to signing keys, version numbers, cutting a release, and rolling one back.
- [releases/README.md](releases/README.md): the sign-off file that records the release checklist items only a person can check.

## Elsewhere in the repository

- [README.md](../README.md): what OpenNote is, its status, and a map of the repository.
- [CONTRIBUTING.md](../CONTRIBUTING.md): how to set up your computer, make a change, and get it merged.
- [SECURITY.md](../SECURITY.md): how to report a security problem privately.
