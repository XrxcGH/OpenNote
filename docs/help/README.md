# OpenNote help

Short guides for using OpenNote, one for each area of the app. They describe beta 5 (0.1.0-beta.6). Nobody has tried most of these features by hand yet, so [tell us](../testing/beta-4-checklist.md#reporting-a-failure) if a step does not work as written.

Every picture is a real screenshot. [The screens folder](../screens/README.md) has all of them, in light and dark.

## Contents

- [Write](#write)
- [Draw and design pages](#draw-and-design-pages)
- [Organize and find](#organize-and-find)
- [Record](#record)
- [Bring notes in and out](#bring-notes-in-and-out)
- [Storage and history](#storage-and-history)
- [Smart features, privacy, and accounts](#smart-features-privacy-and-accounts)
- [Install, update, and remove](#install-update-and-remove)

## Write

- [Typed notes](typed-notes.md): text, lists, checklists, the slash menu, templates, and find and replace.
- [Moving between blocks](moving-between-blocks.md): the keys that move between text, images, tables, and code.
- [Math and graphs](math-and-graphs.md): equations, quick math, the grapher, and diagrams.
- [Math solvers](math-solvers.md): integrals, differential equations, transforms, series, roots, uncertainty, probability, matrices, and projectiles, with worked steps.
- [3D graphs, vectors, and motion](3d-graphs-vectors-and-motion.md): surfaces, curves, vectors, solids, and projectiles.
- [Tables and charts](tables-and-charts.md): smart tables, formulas, views, and charts.
- [Language and spelling](language-and-spelling.md): American English by default, the other dialects and languages, and what the choice sets.
- [Engineering tools](engineering-tools.md): free-body diagrams, beams, trusses, circuits, and units in tables.
- [Document structure](document-structure.md): equation numbers and references, formula sheets, practice mode, problem-set templates, and figure export.
- [Code cells](code-cells.md): run short Python and JavaScript programs on a page, offline, in a sandbox.

## Draw and design pages

- [Ink and palm rejection](ink-and-palm-rejection.md): pens, erasers, shapes, gestures, and resting your hand on the screen.
- [My handwriting](my-handwriting.md): teach OpenNote your handwriting, then write typed text and math in your own hand.
- [Paper and page views](paper-and-page-views.md): flow, paginated, and canvas pages, lined paper, presets, slides, and print.

## Organize and find

- [Search and links](search-and-links.md): search, page links, backlinks, tags, and daily notes.
- [Study tools](study-tools.md): flashcards, Upcoming, timers, the calculator, and citations.
- [Chemistry and property tables](chemistry-and-data.md): balancing, stoichiometry, gas laws, titration, structure drawing, and steam, gas, and materials tables.

## Record

- [Recording](recording.md): recording with stamped notes, trimming, transcripts, and recaps.

## Bring notes in and out

- [Import and export](import-and-export.md): other apps' files in, and Markdown, Word, PDF, and more out.

## Storage and history

- [History, Trash, and storage](history-and-storage.md): page history, Trash, the notes folder, edits from other apps, Check notebook, Lock entry, and password-protected sections.

## Smart features, privacy, and accounts

- [On-device intelligence](on-device-intelligence.md): reading pictures, summaries, Ask your notes, and handwriting to text.
- [Privacy and Work offline](privacy-and-work-offline.md): what uses the network, and how to stop it.
- [Connectors](connectors.md): signing in to other services.
- [The local API and app permissions](local-api.md): which programs on your PC may read or add notes, and the access log.
- [The opennote command](command-line.md): add to and search your notes from a terminal or script.
- [The web clipper and mail add-ins](web-clipper.md): save web pages and emails into your notes.
- [Photos from your phone](phone-scan.md): scan a code to send photos onto the open page.

## Install, update, and remove

OpenNote is one file, and it never needs administrator rights.

- **On a Mac or Linux.** [OpenNote on macOS and Linux](install-macos-linux.md): the dmg and the AppImage, updates, Command shortcuts, and what works differently there.

- **Install.** The first time it starts, setup offers to move OpenNote into your own Programs folder (`%LOCALAPPDATA%\Programs\OpenNote`) and add it to the Start menu. After the move, OpenNote also shows in Windows Settings, then **Apps**, then **Installed apps**, with its version.
- **Updates.** OpenNote checks for updates in the background and installs them the way you chose in Settings, then **Updates**. A download that stops partway, because the PC slept or the network dropped, carries on from where it stopped the next time. If you are on a metered network, such as a phone hotspot, automatic updates wait until you are on a network without a data limit. Every update is checked against its signature before it is installed, whether it was downloaded in one go or in parts.
- **Remove.** In **Installed apps**, choose the three dots next to OpenNote, then **Uninstall**. OpenNote asks first. It removes the app, its Start menu shortcut, the `opennote` command if you added it, and its Installed apps entry. Your notes folder is never touched, and your settings stay, so installing OpenNote again picks up where you left off. If OpenNote is open, close it first.
