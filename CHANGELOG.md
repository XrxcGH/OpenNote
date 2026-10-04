# Changelog

All notable changes to OpenNote are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Foundation

- Set up the project structure for Windows development with Tauri 2
- Integrated TypeScript and React for the user interface
- Configured continuous integration with automated checks and tests
- Established the release workflow for signed, stable builds

### Releases

- Each release ships three Windows files: one for 64-bit PCs, one for 32-bit PCs, and one for Arm PCs
- Each release lists what OpenNote is made of, and publishes a checksum for every file
- The update notice shows the release notes for the new version
- A release is checked the way the app checks an update before anyone can download it
- Windows package manager (winget) files are made for every stable release

### Experiments

- Evaluated ink drawing performance with Surface Pen and Wacom tablets
- Tested placing text editors on a zoomable canvas alongside handwriting
- Prototyped PDF export to verify page layout fidelity
- Built audio recording support for microphone and system audio capture

## 0.1.0-beta.4 - 2026-10-03

Unsigned, for Windows, with no installer and no self-update. Agents only started it and opened each main screen. The hand test is [the beta 4 checklist](docs/testing/beta-4-checklist.md).

### Added

- Smart tables, charts, math, and the grapher, with calculated columns, board, calendar, gallery, and timeline views, Mermaid diagrams, and mind maps
- Search and links: the search panel, the quick switcher, page and paragraph links, backlinks, tags, daily notes, the graph view, and replace across notebooks
- Recording with stamped notes, flags, trim, system audio, transcript blocks, speakers, and meeting recaps
- Import and export for Markdown, Obsidian, Word, HTML, Excel, PowerPoint, email, Kindle, and Readwise files, with a review and undo
- On-device intelligence, all off until turned on: text in pictures, read aloud, summaries, handwriting to text, search by meaning, Ask your notes, and writing tools
- Hardening and privacy: crash reports with consent, a self-check, a feedback file, safe start, and Work offline
- Study tools: flashcards, Anki and CSV, study tape, Upcoming, timers, a calculator, a unit converter, and citations
- Quality-of-life features in eleven areas, 142 in all, such as pen gestures, insert space, page templates, find and replace, layout presets, tabs, focus mode, quick capture, and scheduled backups
- Settings > Connectors, with sign-in for six services and tokens for three more, kept in Windows Credential Manager
- Real screenshots of every screen, 34 redrawn wireframes, and a help page for each area of the app

### Changed

- A new page has its title and a gray "Changed" line only, with no date text box
- On lined, grid, and dot paper, text rests on the rules like handwriting, and text boxes snap from rule to rule
- The page area shrinks with a narrower window or pane, with no empty strip to scroll into
- The start-up bundle limit rose from 250 KB to 300 KB gzipped to fit the new features

### Fixed

- A stray box beside each to-do checkbox
- A sideways scroll bar under the page at 150 percent display scale

### Not built yet

- 26 features, including the pen library, PDF import, the local API, the web clipper, and the speech engine for transcripts. [FEATURES.md](docs/FEATURES.md) marks each one.
- 15 features wait on the owner's accounts, app registrations, or a decision about the note format.

## 0.1.0-beta.3 - 2026-10-03

### Added

- The typed notes editor: headings, lists, checklists, quotes, code, tables, images, and the formatting bar
- The "desk by the window" look, with new setup screens
- Ink: the Draw tab with pens, a highlighter, two erasers, the lasso, and ink to shape, with palm rejection while a pen is near
- Page views: infinite canvas and pages with breaks, paper and backgrounds, a gallery, slides, and reading aids
- Export as PDF, picture, HTML, or Markdown, and Print

### Fixed

- A page with handwriting no longer scrolls sideways
- The lasso's bar stays inside the page view
- Lassoed text boxes move together with their ink

## 0.1.0-beta.2 - 2026-10-03

### Added

- Trash with Restore for deleted pages, sections, section groups, and notebooks
- Opening a notes folder on another computer shows its notebooks
- Beta 1 notes move over by themselves on the first start, and a copy of the old files is kept

### Changed

- The notes folder holds all of your notes in OpenNote's open note format. Each notebook is a folder with its sections, pages, history, images, and Trash.
- The big heading on a page and its name in the list are one title
- New notebook opens the new notebook

### Fixed

- A horizontal scroll bar showed under the page when nothing was off to the side

## 0.1.0-beta.1 - 2026-10-03

The first beta build, for Windows, unsigned.

### Added

- First-run setup with a look, a notes folder, and a first notebook, and an offer to add OpenNote to the Start menu
- Notebooks, sections, and pages, with headings, bulleted lists, bold text, the slash menu for code blocks and tables, and undo and redo
- Pages that save as you type and come back after a restart

[Unreleased]: https://github.com/XrxcGH/OpenNote/compare/main...main
