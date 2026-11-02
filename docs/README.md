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

The [help index](help/README.md) lists every page. Each one is short, and most have a picture of the app. The [feature list](FEATURE-LIST.md) names every tool, command, and feature by category.

- [typed-notes.md](help/typed-notes.md): text, lists, checklists, the slash menu, templates, and find and replace.
- [moving-between-blocks.md](help/moving-between-blocks.md): the keys that move between text, images, tables, and code on a page.
- [ink-and-palm-rejection.md](help/ink-and-palm-rejection.md): pens, erasers, shapes, gestures, and resting your hand on the screen.
- [paper-and-page-views.md](help/paper-and-page-views.md): flow, paginated, and canvas pages, lined paper, presets, slides, and print.
- [tables-and-charts.md](help/tables-and-charts.md): smart tables, formulas, views, and charts.
- [math-and-graphs.md](help/math-and-graphs.md): equations, quick math, the grapher, and diagrams.
- [engineering-tools.md](help/engineering-tools.md): free-body diagrams, beams, trusses, circuits, and units in tables.
- [subject-tool-kits.md](help/subject-tool-kits.md): thirteen tool windows for engineering, science, math, earth science, and reasoning problems.
- [subject-kit-data-and-figures.md](help/subject-kit-data-and-figures.md): data input, page tables, seeds, and figure blocks in the subject kits.
- [economics-and-finance.md](help/economics-and-finance.md): money over time, markets, firms, macroeconomics, accounting, and investments.
- [statistics-kit.md](help/statistics-kit.md): describe data, tests, epidemiology, power, resampling, and Bayesian updating.
- [statistical-models.md](help/statistical-models.md): regression, causal inference, survival, time series, clusters, and machine learning.
- [psychology-kit.md](help/psychology-kit.md): signal detection, psychophysics, choice models, response times, and scales.
- [biology-tools.md](help/biology-tools.md): sequences, cloning, proteins, alignment, crosses, and population genetics.
- [life-science-tools.md](help/life-science-tools.md): physiology, neurons, pharmacology, bench math, and populations.
- [civil-and-chemical-engineering.md](help/civil-and-chemical-engineering.md): structures, soils, water, transportation, and reactors.
- [modern-physics-and-astronomy.md](help/modern-physics-and-astronomy.md): quantum wells, atoms, solids, plasmas, stars, and cosmology.
- [signals-tools.md](help/signals-tools.md): spectra, filters, sampling, sound, images, and coding.
- [history-places-languages-and-texts.md](help/history-places-languages-and-texts.md): timelines, calendars, maps, scripts, and text analysis.
- [music-script-camera-and-studio-tools.md](help/music-script-camera-and-studio-tools.md): notation, music theory, ear training, scripts, and camera math.
- [search-and-links.md](help/search-and-links.md): search, page links, backlinks, tags, and daily notes.
- [study-tools.md](help/study-tools.md): flashcards, Upcoming, timers, the calculator, and citations.
- [recording.md](help/recording.md): recording with stamped notes, trimming, transcripts, and recaps.
- [import-and-export.md](help/import-and-export.md): other apps' files in, and Markdown, Word, PDF, and more out.
- [on-device-intelligence.md](help/on-device-intelligence.md): reading pictures, summaries, Ask your notes, and handwriting to text.
- [privacy-and-work-offline.md](help/privacy-and-work-offline.md): what uses the network, and how to stop it.
- [connectors.md](help/connectors.md): signing in to other services.
- [3d-graphs-vectors-and-motion.md](help/3d-graphs-vectors-and-motion.md): surfaces, curves, vectors, solids, and projectiles.
- [accessibility-checker.md](help/accessibility-checker.md): find images with no description, skipped headings, and low contrast, and fix them.
- [chemistry-and-data.md](help/chemistry-and-data.md): balancing, stoichiometry, gas laws, titration, structure drawing, and steam, gas, and materials tables.
- [code-cells.md](help/code-cells.md): run short Python and JavaScript programs on a page, offline, in a sandbox.
- [command-line.md](help/command-line.md): add to and search your notes from a terminal or script.
- [document-structure.md](help/document-structure.md): equation numbers and references, formula sheets, practice mode, problem-set templates, and figure export.
- [history-and-storage.md](help/history-and-storage.md): page history, Trash, the notes folder, edits from other apps, Check notebook, Lock entry, and password-protected sections.
- [install-macos-linux.md](help/install-macos-linux.md): the dmg and the AppImage, updates, Command shortcuts, and what works differently there.
- [language-and-spelling.md](help/language-and-spelling.md): American English by default, the other dialects and languages, and what the choice sets.
- [local-api.md](help/local-api.md): which programs on your PC may read or add notes, and the access log.
- [math-solvers.md](help/math-solvers.md): integrals, differential equations, transforms, series, roots, uncertainty, probability, matrices, and projectiles, with worked steps.
- [my-handwriting.md](help/my-handwriting.md): teach OpenNote your handwriting, then write typed text and math in your own hand.
- [notes-apps.md](help/notes-apps.md): the handwriting apps' own files, and their PDF exports.
- [phone-scan.md](help/phone-scan.md): scan a code to send photos onto the open page.
- [settings.md](help/settings.md): every Settings section, appearance, and shortcuts.
- [sync.md](help/sync.md): optional end-to-end-encrypted sync through a folder or WebDAV server you already have.
- [tutor.md](help/tutor.md): hints one step at a time, and explanations of flagged steps, without giving the answer away.
- [web-clipper.md](help/web-clipper.md): save web pages and emails into your notes.
- [workspace-and-title-bar.md](help/workspace-and-title-bar.md): the title bar, Home, page tabs, the compact layout, focus mode, keep on top, quick capture, and the command palette.

## Plan

- [DEVELOPMENT.md](DEVELOPMENT.md): the step-by-step plan for the Windows prototype, with phases, technology choices, tests, and release gates. Each phase has a status note for beta 8.
- [FEATURES.md](FEATURES.md): the feature spec for Office and Google integration, handwriting, transcripts, study tools, and more. Each feature is marked built, built but untested by hand, not built yet, or needing the owner.
- [RESEARCH.md](RESEARCH.md): popular and rising note apps, the features people love, and the gaps OpenNote can fill.
- [../CHANGELOG.md](../CHANGELOG.md): what changed since the last beta, and what betas 1 to 4 added, changed, and fixed.

## Design and screens

- [BRAND.md](BRAND.md): colors, type, layout, motion, voice, accessibility, and performance budgets.
- [design/platform-api-THREATS.md](design/platform-api-THREATS.md): the threat model for the local API.
- [design/SCREENS.md](design/SCREENS.md): 34 wireframes of every major screen, with sizes and keep-out zones. The drawings are in `design/images/`, and `design/generate.ts` makes them.
- [screens/README.md](screens/README.md): 264 real screenshots of 132 screens, each in light and in dark, and what each one shows.
- [FEATURE-LIST.md](FEATURE-LIST.md): every feature, command, tool window, and kit tab in 17 categories, one sentence each, with the pictures. `npm run docs:features` makes it from the app's registries and FEATURES.md.

## Quality and testing

- [CHECKS.md](CHECKS.md): the quality gate every file change must pass, with its rules and settings.
- [testing/beta-4-checklist.md](testing/beta-4-checklist.md): the hand test checklist, written for beta 4, starting with how to run it on a throwaway profile so real notes stay safe.
- [testing/flags.md](testing/flags.md): the flag check: a test that fails when a flag is defined but nothing reads it.
- [testing/palm-rejection.md](testing/palm-rejection.md): the palm rejection test with a real pen.
- [testing/palm-sweep.md](testing/palm-sweep.md): the 200,000-case palm label sweep, with each open failure and a proposed fix for review.
- [testing/keyboard-and-screen-reader.md](testing/keyboard-and-screen-reader.md): the checklist a person runs at each phase exit and before each beta, with a screen reader and no mouse.
- [testing/hardware-kit.md](testing/hardware-kit.md): one command for each exit gate that needs a device (crash on a drive, typing on four cores, pen latency, Phase 12 accuracy), and where the results go.
- [HARDENING.md](HARDENING.md): the nightly tests, opt-in crash reports, the self-check, the feedback file, and safe start.

## Decisions

- [adr/README.md](adr/README.md): every architecture decision record (ADR) with its status, which ones wait on a check, and how to write one.

## File format

- [format/README.md](format/README.md): the note file format specification, tools, and fixtures.

## Engineering guides

- [intel.md](intel.md): the `opennote-intel` crate, with the engines for text in pictures, handwriting, read aloud, summaries, and speech.
- [ATTRIBUTION.md](ATTRIBUTION.md): the author, source, and license of every picture, font, sound, model, and vendored crate.
- [tools/](tools/): the feature list generator (`featureList.ts` and its parts), the registry it reads (`registry.json`, written by `app/src/app/featureRegistry.test.ts`), and the list of pictures (`screens.json`).
- [CONNECTORS.md](CONNECTORS.md): the owner's guide to registering OpenNote with each service that connected accounts use, and where the client IDs go.

## Performance records

- [perf/hardware-gates.md](perf/hardware-gates.md): the results of the device runs for each exit gate.
- [perf/phase-4.md](perf/phase-4.md): how Phase 4's typing speed was measured, the numbers, and what is still over budget.
- [perf/phase-5-core.md](perf/phase-5-core.md): the 10,000-stroke benchmark of the ink core, with its method and numbers.
- [perf/phase-5.md](perf/phase-5.md): pen-to-screen time and frame rate on a page of 10,000 strokes.
- [perf/palm-accuracy.md](perf/palm-accuracy.md): palm rejection accuracy on 61 adversarial scenarios and labeled recordings.
- [perf/palm-competitors.md](perf/palm-competitors.md): the palm rejection baseline from other apps, so the claim of better accuracy can be checked.
- [perf/images.md](perf/images.md): what a 12 MP photo costs as the original and as a smaller copy (spike S3), and why OpenNote keeps the original.
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
