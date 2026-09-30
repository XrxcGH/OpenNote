# OpenNote feature specification

This spec lists what OpenNote does, beyond the basics in [DEVELOPMENT.md](DEVELOPMENT.md). Each feature notes the phase that builds it.

## Contents

- [Office and Google Workspace](#office-and-google-workspace)
- [Video and audio platforms](#video-and-audio-platforms)
- [Handwriting to text](#handwriting-to-text)
- [Shapes and lines](#shapes-and-lines)
- [Transcripts and summaries](#transcripts-and-summaries)
- [Study tools](#study-tools)
- [Page layouts](#page-layouts)
- [Export a selection](#export-a-selection)
- [On-device intelligence setup](#on-device-intelligence-setup)
- [Quality-of-life fixes](#quality-of-life-fixes)

## Office and Google Workspace

Import and export (Phase 11):

| App | Import | Export |
|---|---|---|
| Word / Google Docs | `.docx`, `.odt`, Google Docs | `.docx`, Google Docs, PDF |
| Excel / Google Sheets | `.xlsx`, `.csv`, Google Sheets into smart tables | `.xlsx`, `.csv`, Google Sheets |
| PowerPoint / Google Slides | `.pptx`, Google Slides as annotatable pages | `.pptx` (one page per slide), PDF |
| OneNote / Evernote | Graph API, `.enex` | PDF, Markdown |

Linked accounts (Phase 11):

- People can link Google and Microsoft accounts in Settings. Sign-in uses the provider's own secure page (OAuth), and tokens are stored in Windows Credential Manager.
- The "Send to" menu converts a page, section or selection to PDF, Word or Google Docs, then uploads it to a chosen Google Drive or OneDrive folder. It all happens inside OpenNote.
- Favorite destinations are saved, so "Send to Drive: Biology/Lab reports" becomes one click.
- A page can stay linked to its exported copy and offer "Update the Drive copy" after edits.
- Linking is optional. Nothing is uploaded without an explicit action.

## Video and audio platforms

(Phase 9)

- Paste a YouTube, Vimeo or podcast link to embed a player. Notes taken while it plays are time-stamped to the video, like audio recordings.
- Transcripts come from the platform's captions when available, or from on-device transcription of audio the person has the right to use.
- Recordings can be exported as audio or as a narrated video of the page, and uploaded to a linked YouTube account as private or unlisted.

## Handwriting to text

(Phase 5 and Phase 12)

- A "Writing pen" converts handwriting to typed text as the person writes, with the original ink kept one tap away.
- Math is recognized as math: subscripts, superscripts, fractions, roots, integrals, matrices and Greek letters become editable equations.
- Special characters (°, ±, →, ≤, µ) and chemistry notation such as H₂O are kept.
- Unsure words are underlined; tapping one shows alternatives.
- Any existing ink can be converted later with the lasso.

## Shapes and lines

(Phase 5)

- Draw a rough shape and hold still for half a second. It snaps to a clean circle, ellipse, rectangle, triangle, polygon, star or arrow.
- Keep holding and move to resize or rotate it before lifting the pen.
- Straight lines, arcs, curved arrows and double arrows snap the same way. Lines snap to 15° steps near horizontal and vertical.
- Shapes keep editable handles, and connectors stay attached when shapes move.

## Transcripts and summaries

(Phase 9 and Phase 12)

- Every recording gets a transcript automatically, with a one-paragraph summary at the top.
- Each line starts with a timestamp. Clicking a line or its time jumps playback to that moment.
- Different voices are labeled Speaker 1, Speaker 2 and so on. Renaming a speaker once ("Dr. Patel") updates the whole transcript, and saved names are suggested in later recordings.
- Transcripts are searchable and can be edited to fix mistakes.

## Study tools

(Phase 10)

- Flashcard and quiz blocks can be embedded in any page.
- Make them by hand, or generate them from a page, a section or a recording's transcript.
- Card types: question and answer, fill-in-the-blank, multiple choice, and image occlusion (hide part of a diagram).
- A spaced-repetition schedule shows which cards are due. Decks export to Anki and CSV.

## Page layouts

(Phase 6)

Presets, set per page or as a notebook default:

- Plain (no lines), infinite or paginated.
- Ruled: narrow (6 mm), college (7 mm), wide (8.7 mm) and custom.
- Grid: 5 mm, 1/4 in, 1 cm and custom. Dot grid and isometric.
- Cornell notes, lab notebook, music staff, planner and storyboard.
- Custom templates can be saved and shared.

## Export a selection

(Phase 6)

- Lasso any area, then choose "Export selection" to save it as PDF, PNG, SVG or `.docx`, or copy it as an image.
- Smart select grows the lasso to include whole strokes, text boxes and images that it only partly touches, and trims empty margins.
- This works for annotated images: import a photo, draw on it, and export just that part.

## On-device intelligence setup

First-time setup has a step for it, instead of leaving everything off. The step offers three choices:

1. **Recommended:** transcription, handwriting recognition, text in images (OCR) and summaries, all running on this device.
2. **Custom:** pick each feature, and choose a local model or your own cloud key.
3. **Not now:** everything stays off and can be turned on later in Settings.

The step shows the download size of each model and states that nothing leaves the device.

## Quality-of-life fixes

These answer known complaints about other note apps:

- **Versions and trash:** page history, and a trash that keeps deleted items for 30 days.
- **Clean paste:** pasting from the web keeps structure but drops stray fonts and colors. Ctrl+Shift+V pastes plain text.
- **Speed:** large notebooks open lazily, and nothing freezes while syncing.
- **Content locks:** text boxes and images can be locked in place.
- **Sections and pages:** can be pinned, colored, sorted and duplicated.
- **Links:** internal links survive renames and moves.
- **Tabs and windows:** open several pages side by side in tabs or windows.
- **Snap tools:** a ruler, protractor and snap-to-grid for neat diagrams.
- **Offline:** everything works offline, and conflicts are shown side by side, never silently overwritten.
- **Export:** a whole notebook exports in one step, so data is never locked in.
