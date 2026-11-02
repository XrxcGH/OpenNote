# Screens

Real pictures of OpenNote, in the light and the dark theme, taken on the beta 8 build. Use them in the README, the wiki, and the release notes. The wireframes that planned these screens are in [the design folder](../design/SCREENS.md). [The feature list](../FEATURE-LIST.md) shows each picture next to the features it shows.

## Contents

- [How they were taken](#how-they-were-taken)
- [First-time setup](#first-time-setup)
- [The workspace](#the-workspace)
- [Writing and page blocks](#writing-and-page-blocks)
- [Drawing and ink](#drawing-and-ink)
- [Find, link, and organize](#find-link-and-organize)
- [Audio and transcripts](#audio-and-transcripts)
- [Import and export](#import-and-export)
- [Study and homework](#study-and-homework)
- [Math, graphs, and calculators](#math-graphs-and-calculators)
- [Engineering kits](#engineering-kits)
- [Science kits](#science-kits)
- [Data and society kits](#data-and-society-kits)
- [Humanities and arts kits](#humanities-and-arts-kits)
- [Connectors and sync](#connectors-and-sync)
- [Settings](#settings)
- [Trash, the palette, and tool windows](#trash-the-palette-and-tool-windows)
- [Real window pictures](#real-window-pictures)

## How they were taken

The list of pictures, with their categories and captions, is `docs/tools/screens.json`. `tests/ui/docscap/capture.spec.ts` takes them, with more scenes in `more.ts` and `scenes/` beside it (see the spec for the command). `npm run docs:features` puts them in [the feature list](../FEATURE-LIST.md).

Each picture is a screenshot of the web build that the interface tests use, with the clock set to September 30, 2026. The web build runs the same interface on a fake host. A few details differ from a Windows install. The About page says the channel is Development, and the recording options list one default microphone.

Most pictures are 1280 by 800 pixels. A few use another size, such as the Draw tab and some ink pictures (1600 by 900), the compact layout (400 by 800), and the Quick note window (520 by 420).

No picture was made while recording, and no microphone was used.

Every name below has two files, one ending in `-light.png` and one in `-dark.png`. The dark theme is a neutral charcoal gray.

## First-time setup

- [setup-welcome](setup-welcome-light.png) ([dark](setup-welcome-dark.png)): Step 1 of 7: the welcome desk by the window.
- [setup-look](setup-look-light.png) ([dark](setup-look-dark.png)): Step 2: the Light, Dark, and Match Windows preview cards.
- [setup-language](setup-language-light.png) ([dark](setup-language-dark.png)): Step 3: the language and spelling choice, with American English as the default.
- [setup-intelligence](setup-intelligence-light.png) ([dark](setup-intelligence-dark.png)): Step 4: on-device intelligence, with Not now selected.
- [setup-keys-and-pen](setup-keys-and-pen-light.png) ([dark](setup-keys-and-pen-dark.png)): Step 5: the shortcut set and the pen top button.
- [setup-storage](setup-storage-light.png) ([dark](setup-storage-dark.png)): Step 6: the notes folder and the first notebook.
- [setup-import](setup-import-light.png) ([dark](setup-import-dark.png)): Step 7: bringing in notes from another app.

## The workspace

- [workspace](workspace-light.png) ([dark](workspace-dark.png)): Notebooks, pages, and a page of typed notes with a heading, a list, and a page link.
- [workspace-empty](workspace-empty-light.png) ([dark](workspace-empty-dark.png)): The empty state: no notebooks yet, and an open book and candle on the page card.
- [home-screen](home-screen-light.png) ([dark](home-screen-dark.png)): The Home screen with recent pages, pinned pages, and what is coming up.
- [title-bar-states](title-bar-states-light.png) ([dark](title-bar-states-dark.png)): The title bar with back and forward, the page path, the save status, and a running timer chip.
- [page-tabs](page-tabs-light.png) ([dark](page-tabs-dark.png)): Three pages open as tabs in the strip above the page.
- [compact-layout](compact-layout-light.png) ([dark](compact-layout-dark.png)): The compact layout of a narrow window, with the app bar and one pane at a time.
- [focus-mode](focus-mode-light.png) ([dark](focus-mode-dark.png)): Focus mode, with the panes and the command bar hidden around the page.
- [quick-capture](quick-capture-light.png) ([dark](quick-capture-dark.png)): The Quick note window, which saves a note in Quick notes.
- [tab-home](tab-home-light.png) ([dark](tab-home-dark.png)): The Home tab with the recording control and the formatting bar.
- [tab-insert](tab-insert-light.png) ([dark](tab-insert-dark.png)): The Insert tab, with buttons for the chemistry, structure, materials, and economics tools, then Link, Insert table, and More.
- [tab-draw](tab-draw-light.png) ([dark](tab-draw-dark.png)): The Draw tab: the tools, the pen slots, color, and width (1600 by 900).
- [tab-view](tab-view-light.png) ([dark](tab-view-dark.png)): The View tab: panes, page layout, paper, background, and focus mode.

## Writing and page blocks

- [slash-menu](slash-menu-light.png) ([dark](slash-menu-dark.png)): The slash menu after typing a slash on an empty line, listing the blocks to insert.
- [formatting-bar](formatting-bar-light.png) ([dark](formatting-bar-dark.png)): The formatting bar over a selected sentence, with Bold, Italic, Highlight, Link, and More formatting.
- [block-callouts](block-callouts-light.png) ([dark](block-callouts-dark.png)): Note, tip, and warning callouts on a page, each with its own color and icon.
- [block-code](block-code-light.png) ([dark](block-code-dark.png)): A code block with Python highlighting and its language label.
- [lined-paper](lined-paper-light.png) ([dark](lined-paper-dark.png)): Typed notes on lined paper, with the text sitting on the rules.
- [table-chart](table-chart-light.png) ([dark](table-chart-dark.png)): A smart table with its formula cell selected, showing =B2*0.6, and the bar chart made from it with its summary in words.
- [insert-mind-map](insert-mind-map-light.png) ([dark](insert-mind-map-dark.png)): A mind map on a page, with a main idea and branches added under and beside it.
- [insert-diagram](insert-diagram-light.png) ([dark](insert-diagram-dark.png)): A flowchart written as text, drawn below its source.
- [code-cell](code-cell-light.png) ([dark](code-cell-dark.png)): A Python code cell that has run, with its output below the code.
- [page-templates](page-templates-light.png) ([dark](page-templates-dark.png)): The new page chooser with the Problem set, Cornell notes, and Lab report templates.
- [page-history](page-history-light.png) ([dark](page-history-dark.png)): The page history panel with earlier versions and the compare view of one of them.
- [canvas-view](canvas-view-light.png) ([dark](canvas-view-dark.png)): The canvas view, with pages and notes as cards joined by arrows.
- [writing-tools](writing-tools-light.png) ([dark](writing-tools-dark.png)): The writing tools on a selected paragraph, with a suggested change to accept or reject.

## Drawing and ink

- [ink-pens](ink-pens-light.png) ([dark](ink-pens-dark.png)): Ink on a page: a highlighter, three pens, and a pencil sketch (1600 by 900).
- [ink-pen-types](ink-pen-types-light.png) ([dark](ink-pen-types-dark.png)): Lines drawn with the fountain pen, brush, calligraphy pen, dashed pen, and dotted pen.
- [ink-eraser](ink-eraser-light.png) ([dark](ink-eraser-dark.png)): The eraser options open on the Draw tab, with the stroke and partial erasers.
- [ink-lasso](ink-lasso-light.png) ([dark](ink-lasso-dark.png)): Strokes chosen with the lasso, with the selection frame and the selection bar.
- [ink-shapes](ink-shapes-light.png) ([dark](ink-shapes-dark.png)): Hand-drawn shapes snapped to a clean line, arrow, rectangle, and circle, with the Shapes menu open.
- [ink-ruler](ink-ruler-light.png) ([dark](ink-ruler-dark.png)): The ruler and the protractor on a page, with a straight line drawn along the ruler.
- [ink-layers](ink-layers-light.png) ([dark](ink-layers-dark.png)): The Layers window with three layers, each with Make active, Hide, Lock, Move, Export, and Delete.
- [ink-groups](ink-groups-light.png) ([dark](ink-groups-dark.png)): Two pen strokes lassoed and grouped, with the Ungroup button on the selection bar.
- [ink-links](ink-links-light.png) ([dark](ink-links-dark.png)): The list of links on a page after a lassoed stroke was linked to a web address.

## Find, link, and organize

- [search](search-light.png) ([dark](search-dark.png)): The search panel with a result, the matched word in bold, and a preview.
- [find-replace](find-replace-light.png) ([dark](find-replace-dark.png)): Find and replace on the page, with every match highlighted.
- [backlinks](backlinks-light.png) ([dark](backlinks-dark.png)): The linked pages pane, listing the page that links here.
- [tags-pane](tags-pane-light.png) ([dark](tags-pane-dark.png)): The tagged lines pane, listing each tagged line with the page it is on.
- [graph-view](graph-view-light.png) ([dark](graph-view-dark.png)): The graph view, with pages as dots and their links as lines.
- [collections](collections-light.png) ([dark](collections-dark.png)): A live collection of pages shown as a board, grouped by status.
- [daily-calendar](daily-calendar-light.png) ([dark](daily-calendar-dark.png)): The daily notes calendar, with today marked and buttons for the day, week, month, and year notes.

## Audio and transcripts

- [recording](recording-light.png) ([dark](recording-dark.png)): The recording options under the Record button. Nothing is recording.
- [recording-block](recording-block-light.png) ([dark](recording-block-dark.png)): A recording block on a page: its player, speed, Skip silence, and flags that mark moments, with the notes typed below it.
- [transcript-block](transcript-block-light.png) ([dark](transcript-block-dark.png)): A transcript block with speaker names and time stamps under its recording.
- [speech-model](speech-model-light.png) ([dark](speech-model-dark.png)): The speech model in Settings, with its size shown before anything is downloaded.

## Import and export

- [import](import-light.png) ([dark](import-dark.png)): The Import notes dialog before a file is chosen, with the supported sources.
- [import-review](import-review-light.png) ([dark](import-review-dark.png)): The review after choosing a file: what comes over and what does not.
- [export](export-light.png) ([dark](export-dark.png)): The Export dialog with a section and the Word document format chosen.
- [print-preview](print-preview-light.png) ([dark](print-preview-dark.png)): The print preview of a page, with the paper size and margins beside it.
- [pdf-import](pdf-import-light.png) ([dark](pdf-import-dark.png)): A PDF inserted as locked page pictures to write on.
- [translate](translate-light.png) ([dark](translate-dark.png)): The Translate window, with the language pack and its size shown before anything is downloaded.

## Study and homework

- [study-flashcards](study-flashcards-light.png) ([dark](study-flashcards-dark.png)): The Flashcards window, with cards made from three typed lines.
- [flashcard-review](flashcard-review-light.png) ([dark](flashcard-review-dark.png)): A flashcard under review, with its answer shown and the buttons to rate it.
- [quiz-block](quiz-block-light.png) ([dark](quiz-block-dark.png)): A quiz block on a page, with one answer chosen and its feedback.
- [study-tutor](study-tutor-light.png) ([dark](study-tutor-dark.png)): The Tutor panel giving the first of four hints on a worked line, without the answer.
- [step-checker](step-checker-light.png) ([dark](step-checker-dark.png)): Check my work on three lines of working, with the wrong line marked and the reason.
- [practice-exam](practice-exam-light.png) ([dark](practice-exam-dark.png)): A practice exam made from a page, with its questions ready to answer.
- [practice-exam-results](practice-exam-results-light.png) ([dark](practice-exam-results-dark.png)): The marked results of a practice exam, with the score and each question's answer.
- [citations](citations-light.png) ([dark](citations-dark.png)): The Citations window with two sources and the bibliography style.

## Math, graphs, and calculators

- [math-graph](math-graph-light.png) ([dark](math-graph-dark.png)): An inline equation in a sentence and a graph block with its function.
- [tool-calculator](tool-calculator-light.png) ([dark](tool-calculator-dark.png)): The scientific calculator after a unit conversion, with the answer and its Copy and Insert buttons.
- [calc-graphing](calc-graphing-light.png) ([dark](calc-graphing-dark.png)): The graphing calculator with two functions drawn, and a value read off the graph near where they cross.
- [calc-graphing-3d](calc-graphing-3d-light.png) ([dark](calc-graphing-3d-dark.png)): The 3D graphing calculator with a surface plotted from one function.
- [subject-statistics](subject-statistics-light.png) ([dark](subject-statistics-dark.png)): The Statistics tab of the calculator after summarizing six numbers.
- [solvers-integrals](solvers-integrals-light.png) ([dark](solvers-integrals-dark.png)): The Math solvers window on its integrals tab, with the worked steps.
- [solvers-equations](solvers-equations-light.png) ([dark](solvers-equations-dark.png)): The Math solvers window on its differential equations tab, with the solution and its steps.
- [math-actions](math-actions-light.png) ([dark](math-actions-dark.png)): The math actions on an equation: a solved equation on the page, and the worked steps of a derivative inserted below an equation.
- [graph-3d](graph-3d-light.png) ([dark](graph-3d-dark.png)): A 3D graph block on a page, with a surface and its axes.
- [unit-converter](unit-converter-light.png) ([dark](unit-converter-dark.png)): The unit converter with a length converted from meters to feet.

## Engineering kits

- [kit-thermo](kit-thermo-light.png) ([dark](kit-thermo-dark.png)): The Thermodynamics kit finding a state of water from two properties.
- [kit-thermo-cycles](kit-thermo-cycles-light.png) ([dark](kit-thermo-cycles-dark.png)): The Thermodynamics kit working a Rankine cycle, with its diagram and results.
- [kit-fluid-heat](kit-fluid-heat-light.png) ([dark](kit-fluid-heat-dark.png)): The Fluid mechanics and heat transfer kit on its pipe flow and pumps tab.
- [kit-aerospace](kit-aerospace-light.png) ([dark](kit-aerospace-dark.png)): The Aerospace kit on its standard atmosphere tab, with the values at one altitude.
- [engineering-beam](engineering-beam-light.png) ([dark](engineering-beam-dark.png)): The beam deflection tool of the solid mechanics kit: the supports and loads of a simply supported beam, its results and reactions, and its deflection curve.
- [kit-solids-fem](kit-solids-fem-light.png) ([dark](kit-solids-fem-dark.png)): The finite element workbench of the Solid mechanics kit, with a meshed part and its stresses.
- [kit-mechanisms](kit-mechanisms-light.png) ([dark](kit-mechanisms-dark.png)): The linkage analyzer of the Mechanisms and dynamics kit, with a four-bar linkage.
- [kit-control](kit-control-light.png) ([dark](kit-control-dark.png)): The Dynamics and control kit drawing a Bode plot for a transfer function.
- [kit-circuits](kit-circuits-light.png) ([dark](kit-circuits-dark.png)): The circuit simulator of the Circuits and energy kit, showing the netlist of an RC low-pass filter with its AC sweep results, the -3 dB frequency, and the magnitude and phase plots (1280 by 1560).
- [kit-engineering-math](kit-engineering-math-light.png) ([dark](kit-engineering-math-dark.png)): The linear algebra workbench of the Engineering mathematics kit, with a matrix and its results.
- [kit-civil](kit-civil-light.png) ([dark](kit-civil-dark.png)): The Civil and chemical engineering kit on its hydrology and open channels tab.
- [kit-design](kit-design-light.png) ([dark](kit-design-dark.png)): The drafting sheet of the Design kit, with a title block.
- [kit-design-code](kit-design-code-light.png) ([dark](kit-design-code-dark.png)): The memory and pointer tracer of the Design kit, stepping through a short program.
- [kit-signals](kit-signals-light.png) ([dark](kit-signals-dark.png)): The spectrum analyzer of the Signals and sound kit, with a signal and its spectrum.

## Science kits

- [kit-physics](kit-physics-light.png) ([dark](kit-physics-dark.png)): The Physics kit on its electric and magnetic fields tab, with field lines around two charges.
- [kit-modern-physics](kit-modern-physics-light.png) ([dark](kit-modern-physics-dark.png)): The Modern physics and astronomy kit on its quantum wells and barriers tab.
- [kit-chemistry](kit-chemistry-light.png) ([dark](kit-chemistry-dark.png)): The Chemistry calculators window balancing an equation.
- [kit-chemistry-structure](kit-chemistry-structure-light.png) ([dark](kit-chemistry-structure-dark.png)): The Chemical structures window drawing aspirin from SMILES.
- [kit-chemmat](kit-chemmat-light.png) ([dark](kit-chemmat-dark.png)): The Chemistry and materials kit on its chemical equilibrium tab, solving an ICE table.
- [kit-earth](kit-earth-light.png) ([dark](kit-earth-dark.png)): The Earth sciences kit on its atmospheric thermodynamics and soundings tab.
- [kit-life-science](kit-life-science-light.png) ([dark](kit-life-science-dark.png)): The Life science kit on its population dynamics tab, with a population curve.
- [kit-biology](kit-biology-light.png) ([dark](kit-biology-dark.png)): The Biology tools kit on its DNA and RNA sequences tab, with a sequence and its details.

## Data and society kits

- [kit-statistics](kit-statistics-light.png) ([dark](kit-statistics-dark.png)): The Statistics kit describing a column of data, with its summary table.
- [kit-stat-models](kit-stat-models-light.png) ([dark](kit-stat-models-dark.png)): The Statistical models kit fitting a linear regression, with its fit statistics and coefficients.
- [kit-psychology](kit-psychology-light.png) ([dark](kit-psychology-dark.png)): The Psychology and behavior kit on its signal detection tab.
- [kit-reasoning](kit-reasoning-light.png) ([dark](kit-reasoning-dark.png)): The logic workbench of the Reasoning kit, with a truth table.
- [kit-economics](kit-economics-light.png) ([dark](kit-economics-dark.png)): The Economics and finance kit on its markets and welfare tab, with supply and demand curves.

## Humanities and arts kits

- [kit-humanities](kit-humanities-light.png) ([dark](kit-humanities-dark.png)): The map maker of the History, places, languages, and texts kit.
- [kit-music](kit-music-light.png) ([dark](kit-music-dark.png)): The Music, script, camera, and studio kit on its music theory tab.
- [kit-music-score](kit-music-score-light.png) ([dark](kit-music-score-dark.png)): The Score tab of the music kit: a short melody engraved on a staff, with its results and the Play button.

## Connectors and sync

- [protected-section](protected-section-light.png) ([dark](protected-section-dark.png)): A password-protected section after it locks, with the Unlock section button.
- [sync-settings](sync-settings-light.png) ([dark](sync-settings-dark.png)): Settings, then Sync: step 1 of 4, choosing where sync keeps its encrypted data.
- [connector-prompt](connector-prompt-light.png) ([dark](connector-prompt-dark.png)): A connector card after Connect, stopped at the sign-in step with nothing sent yet.

## Settings

- [settings-general](settings-general-light.png) ([dark](settings-general-dark.png)): General: the notes folder and start-up.
- [settings-appearance](settings-appearance-light.png) ([dark](settings-appearance-dark.png)): Appearance: theme cards, page color, text size, and interface size.
- [settings-language](settings-language-light.png) ([dark](settings-language-dark.png)): Language: the language and spelling choices, with American English as the default.
- [settings-editing](settings-editing-light.png) ([dark](settings-editing-dark.png)): Editing: Markdown shortcuts, the slash menu, and AutoCorrect.
- [settings-recording](settings-recording-light.png) ([dark](settings-recording-dark.png)): Recording: live captions, a transcript of every recording, formats, and the consent reminder.
- [settings-pen](settings-pen-light.png) ([dark](settings-pen-dark.png)): Pen and touch: the writing hand, drawing with a finger, steady pen, and the pressure curve.
- [settings-my-handwriting](settings-my-handwriting-light.png) ([dark](settings-my-handwriting-dark.png)): My handwriting: calibration and the symbols written in your own hand.
- [settings-intelligence](settings-intelligence-light.png) ([dark](settings-intelligence-dark.png)): On-device intelligence: every feature off, each marked as running on this device.
- [settings-storage](settings-storage-light.png) ([dark](settings-storage-dark.png)): Storage and backups: backups and the notebooks that cannot be found.
- [settings-updates](settings-updates-light.png) ([dark](settings-updates-dark.png)): Updates: the update channel, checking for updates, and going back to the last version.
- [settings-windows](settings-windows-light.png) ([dark](settings-windows-dark.png)): Windows and power: quick capture and its shortcut.
- [settings-privacy](settings-privacy-light.png) ([dark](settings-privacy-dark.png)): Privacy: work offline and a plain list of every network use.
- [settings-app-permissions](settings-app-permissions-light.png) ([dark](settings-app-permissions-dark.png)): App permissions: the local API and the apps allowed to use it.
- [settings-connectors](settings-connectors-light.png) ([dark](settings-connectors-dark.png)): Connectors: accounts that some features use, each saying "Needs setup".
- [settings-help](settings-help-light.png) ([dark](settings-help-dark.png)): Help: this copy of OpenNote and the ways to get help.
- [settings-shortcuts](settings-shortcuts-light.png) ([dark](settings-shortcuts-dark.png)): Shortcuts: the two sets and the list of commands to change.
- [settings-about](settings-about-light.png) ([dark](settings-about-dark.png)): About: version, channel, license, and the window drawing.

## Trash, the palette, and tool windows

- [trash](trash-light.png) ([dark](trash-dark.png)): Trash with two deleted pages and a Restore button for each.
- [palette](palette-light.png) ([dark](palette-dark.png)): The command palette over a page, with pages and commands.
- [tool-timer](tool-timer-light.png) ([dark](tool-timer-dark.png)): The timers window with a countdown running.
- [tool-upcoming](tool-upcoming-light.png) ([dark](tool-upcoming-dark.png)): The Upcoming window for tasks and due dates.
- [accessibility-checker](accessibility-checker-light.png) ([dark](accessibility-checker-dark.png)): The accessibility checker's report on a page, with each problem and how to fix it.
- [dictionary](dictionary-light.png) ([dark](dictionary-dark.png)): The dictionary window with a word's definitions and related words.
- [reference-tables](reference-tables-light.png) ([dark](reference-tables-dark.png)): The reference tables window with a table of standard values.

## Real window pictures

These pictures show the real Windows app window (the beta 8 build), including the OpenNote title bar and its caption buttons. They are not browser renders. They live in `docs/screens/real/` and show a sample biology page with typed text, a table, and a stroke written with synthetic pen input.

- `real/real-workspace-light.png`: the full window in the light theme, with the notebook list, page list, typed lines, a table, and handwriting.
- `real/real-workspace-dark.png`: the same window in the neutral dark gray theme.
- `real/real-ink-light.png`: the Draw tab with the Writing pen selected, in the light theme.
- `real/real-ink-dark.png`: the Draw tab with the Writing pen selected, in the dark theme.
- `real/real-settings-dark.png`: Settings on the Appearance page in the dark theme.
- `real/real-tool-window-dark.png`: the Chemistry calculators panel open beside a page, in the dark theme.
- `real/real-title-bar-light.png`: the top 120 pixels of the light window, showing the single title bar, tabs, and caption buttons (taken at 150 percent display scale).
