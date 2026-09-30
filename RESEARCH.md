# OpenNote market and feature research

> **Purpose:** A reference for designing OpenNote: an open-source note-taking app that combines writing, drawing and recording for personal, educational, and business use.
> **Platform strategy:** Build the first working prototype on Windows. The app must eventually run on macOS, Linux, iOS/iPadOS and Android, and work on every screen size from phone to large desktop monitor. Recommendations are made with that end state in mind.
> **Research date:** 2026-09-30.

---

## Table of contents

1. [Method & caveats](#1-method--caveats)
2. [Executive summary](#2-executive-summary)
3. [The established players](#3-the-established-players)
4. [Most-loved features, by category](#4-most-loved-features-by-category)
5. [Rising apps & what they offer that incumbents don't](#5-rising-apps--what-they-offer-that-incumbents-dont)
6. [State of open-source ink + typed notes](#6-state-of-open-source-ink--typed-notes)
7. [Pain points & missing features](#7-pain-points--missing-features)
8. [Feature comparison matrix](#8-feature-comparison-matrix)
9. [Opportunity list for OpenNote](#9-opportunity-list-for-opennote)
10. [Quality-of-life feature backlog](#10-quality-of-life-feature-backlog)
11. [Cross-platform & multi-screen implications](#11-cross-platform--multi-screen-implications)
12. [Windows-first specifics](#12-windows-first-specifics)
13. [Suggested positioning & first prototype](#13-suggested-positioning--first-prototype)
14. [Open questions / things to verify](#14-open-questions--things-to-verify)
15. [Sources](#15-sources)

---

## 1. Method & caveats

- **How it was compiled.** About 120 web searches and page fetches in four parallel research passes: incumbent apps, best-loved features, rising apps, and gaps/pain points. The results were then combined into this document.
- **Evidence quality varies.**
  - Microsoft Q&A threads, GitHub repos and issues, vendor docs and pricing pages, and TechCrunch/Bloomberg reporting are the strongest sources.
  - Many "best note app" roundups are written by vendors or for search engine optimization (SEO), and repeat each other.
  - Reddit could not be fetched directly in this environment, so there are no Reddit upvote counts.
  - Sentiment is paraphrased from reviews, support forums, and roundups.
- **User and revenue figures are rarely audited.** Anything marked **[uncertain]** comes from a vendor claim or an aggregator estimate. GitHub star counts were read live on 2026-09-30 and are reliable.
- Items marked *(synthesis)* are conclusions drawn for OpenNote, not claims from a source.

---

## 2. Executive summary

1. **The market splits into two camps, and nothing bridges them well.**
   - Ink-first apps: Goodnotes, Notability, Samsung Notes, Nebo, Xournal++. Weak at typed and structured notes.
   - Typed/structured apps: Notion, Obsidian, Evernote, Joplin, Logseq. Weak or no handwriting.
   - OneNote is the only mainstream app that mixes typed text and ink on one freeform page. Its known weaknesses are layout and printing, tables and charts, sync, lock-in, and paywalled AI.
2. **There is no strong open-source replacement for OneNote.**
   - Open-source ink apps (Xournal++, Rnote, Saber, Write) lack organization, search, linking, and sync.
   - Open-source typed-note apps (Joplin, Logseq, AppFlowy, AFFiNE, Trilium) lack real ink.
   - This is the clearest gap for OpenNote.
3. **Your OneNote complaints are widely shared and long-standing.**
   - *No page breaks, infinite page:* Microsoft confirmed in 2022 that OneNote "does not support manual page breaks." The feedback-portal request is still open.
   - *No easy charts:* OneNote can only graph equations via Math Assistant. There is no data-driven chart block.
   - *Weak tables:* one-column sort, no formulas without add-ins.
4. **The best-loved features, in rough order:**
   1. Notes synced to audio recording (Notability).
   2. Local, open file formats (Obsidian).
   3. A natural pen feel with good palm rejection.
   4. Backlinks.
   5. Accurate ink-to-text conversion (Nebo).
   6. Search across handwriting, images, and PDFs.
   7. A freeform canvas.
   8. PDF annotation.
5. **Rising trends:**
   - Local-first storage and data ownership.
   - Optional, private AI (local Whisper, Ollama, Model Context Protocol (MCP) servers).
   - Spatial canvases (Excalidraw 133k★, tldraw 51k★, Heptabase).
   - Structured/typed notes (Tana, Capacities, Obsidian Bases).
   - Bot-free meeting capture. Granola is valued at $1.5B as of March 2026.
6. **Timing favors a new entrant.**
   - OneNote for Windows 10 became read-only on 2025-10-14, forcing a migration.
   - Evernote's free plan is capped at 50 notes.
   - Copilot features in OneNote are behind paid licenses.
   - Goodnotes and Notability remain Apple-first.
7. **Proposed positioning** *(synthesis)*: *"The open, local-first notebook where typed text, ink, audio, math and charts live on the same page. It has a real print layout, private AI and one-click import from OneNote and Evernote. Windows first, every platform eventually."*

---

## 3. The established players

### 3.1 Summary table

| App | Platforms | Pricing (2025–26) | Popularity signal | Paradigm |
|---|---|---|---|---|
| **Microsoft OneNote** | Win, Mac, iOS, Android, Web | Free (5 GB OneDrive); M365 for more storage; Copilot license for AI | 500M+ Android installs (Wikipedia list; one source says 1B+) **[uncertain]** | Notebook › Section › Page; freeform infinite canvas |
| **Evernote** | Win, Mac, iOS, Android, Web | Free capped at 50 notes / 1 notebook; Starter ≈ $99/yr, Advanced ≈ $250/yr **[uncertain]** | 225–250M *registered* (legacy, mostly dormant) **[uncertain]** | Notebooks + tags, web clipper |
| **Notion** | Win, Mac, iOS, Android, Web | Free / Plus $10 / Business $20 per user per month; AI bundled in Business | 100M+ users; >$500M ARR (2025) | Blocks + relational databases |
| **Apple Notes** | Apple only (+ iCloud web) | Free | Preinstalled on every Apple device | Folders, rich text, drawings, scans |
| **Google Keep** | Android, iOS, Web | Free | 1B+ Android installs | Sticky-note cards, labels |
| **Obsidian** | Win, Mac, Linux, iOS, Android | Free (commercial use free since 2024); Sync ≈ $4/mo | ~1.5M MAU **[uncertain]**; 16.1% of devs (Stack Overflow 2025) | Local Markdown "vault" + plugins + links |
| **Goodnotes** | iOS, Mac, Android, Windows, Web | Free (3 notebooks); $12–36/yr | "25M+ monthly users" (vendor) | Paper-like notebooks, PDF annotation |
| **Notability** | iOS, Mac, Web, Android (2026); Windows **[unverified]** | Free Starter; Plus $16/yr; Pro $80/yr | Very high iOS ratings | Handwriting + audio sync |
| **Samsung Notes** | Galaxy devices; Windows via Store | Free | 1B+ installs (mostly preinstalled) | S Pen notebook pages |
| **Joplin** | Win, Mac, Linux, iOS, Android, CLI | Free & open source; optional cloud | 56.5k GitHub ★ | Markdown notebooks, E2EE sync |
| **Logseq** | Win, Mac, Linux, (mobile beta) | Free & open source | 45k GitHub ★ | Outliner + backlinks + graph |
| **Bear** | Apple only | Pro $30/yr for sync | Design-award favorite | Markdown editor, nested tags |
| **Standard Notes** | All + Web | Freemium (owned by Proton since 2024) | Niche (privacy users) | E2EE notes |
| **Zoho Notebook** | All + Web | Free / Pro ≈ $20/yr | Not published | Card-based notebooks |
| **Simplenote** | All + Web | Free | Maintenance-only since 2025 **[uncertain]** | Plain text, tags |
| **Nebo / MyScript Notes** | iOS, Android, Windows | $8/yr or $25 lifetime | Niche; best-in-class handwriting recognition | Handwriting → text, math, diagrams |
| **Microsoft Loop** | Web, Windows, mobile | Included in M365 commercial plans | Not published | Pages + live "components" |

**Market-size reports** put the 2025 note-taking market anywhere from **$0.8B to $17B**. The numbers disagree so much they are unusable. The better signals are Stack Overflow's 2025 survey (Notion 16.5%, Obsidian 16.1% of developers), Play Store install brackets and GitHub stars.

### 3.2 Per-app notes

#### Microsoft OneNote *(the app OpenNote most directly replaces)*
- **Praised:**
  - Free.
  - Freeform canvas: click anywhere, mix text, ink, images, and files.
  - Familiar notebook hierarchy.
  - Strong ink on Windows.
  - Searches text inside images.
  - Web clipper.
  - M365/Teams integration.
  - Class Notebook for teachers.
  - Recent Windows ink additions: ink replay, auto-shapes, laser pointer, and ink replayed in sync with audio recordings.
- **Complaints:**
  - Infinite canvas breaks when printing.
  - No page breaks.
  - No global paper size.
  - Weak tables, no charts.
  - No Markdown or code blocks.
  - No backlinks.
  - Sync conflicts and "red X" errors.
  - Slow on large notebooks. Microsoft's own advice is to turn off handwriting recognition if the app lags.
  - Proprietary `.one` format stored in OneDrive.
  - Copilot and larger transcription quotas are paywalled: 300 min/mo upload transcription on M365 vs 30,000 with Copilot.
- **Recent changes:**
  - **OneNote for Windows 10 became read-only on 2025-10-14.** It was merged into "OneNote on Windows."
  - Copilot in OneNote and Copilot Notebooks were added.
  - Users are frustrated by the overlap between OneNote, Loop, Copilot Pages, and Copilot Notebooks.

#### Evernote
- **Praised:** web clipper, optical character recognition (OCR) search inside images and PDFs, document scanning, templates, and tasks.
- **Complaints:**
  - Bending Spoons acquired Evernote (closed January 2023), cut staff, capped the free plan at 50 notes and one notebook (December 2023), and raised prices sharply. Some long-time users saw renewals go from $60–80 to $250 or more.
  - Slow with large libraries.
  - Mobile sync problems.
- Evernote users have been leaving for Joplin, Obsidian, and others.

#### Notion
- **Praised:** databases and views, templates, polished design, team wikis, API, AI Q&A across a workspace. Notion 3.0 (September 2025) added autonomous AI agents.
- **Complaints:**
  - Weak offline mode: you cannot create pages or edit databases offline.
  - Slow on mobile and with large databases.
  - Steep learning curve.
  - AI only on the Business tier.
  - No local files.
  - No handwriting.

#### Apple Notes
- **Praised:** free, fast iCloud sync, Pencil support, scanning, simple sharing.
  - iOS 18 added **audio recording with transcription** and **Math Notes**, which solve handwritten equations inline.
  - iOS/macOS 26 added Markdown import/export and 3D graphing in Math Notes.
- **Complaints:** Apple-only, limited organization, no plugins, limited export.

#### Google Keep
- **Praised:** quick capture, simplicity, reminders, image OCR, Gemini integration.
- **Complaints:** no nested folders, minimal formatting, no desktop app, doesn't scale.

#### Obsidian
- **Praised:**
  - Local plain Markdown files: data ownership, Git, easy migration.
  - Wiki-links, backlinks, and graph view.
  - About 1,400+ plugins.
  - Canvas.
  - Bases (2025): database views over note properties.
  - Speed and privacy.
- **Complaints:**
  - Steep setup curve.
  - Sync is paid or do-it-yourself.
  - Not open source.
  - Mobile is weaker.
  - No native ink; Excalidraw plugin only.
  - Plugin quality varies.

#### Goodnotes
- **Praised:** natural handwriting, PDF annotation, templates, and planners, handwriting search, and conversion, Math AI, AI handwriting spellcheck.
- **Complaints:**
  - Moved from a one-time purchase to a subscription.
  - Windows and Android versions are more limited (feedback-portal requests ask them to stop building Windows as a web app).
  - Clumsy folders.
  - Free tier is very limited: 20 minutes of audio recording.

#### Notability
- **Praised:**
  - **Audio recording synced to notes:** tap a word or stroke to jump to that moment. This is the feature that made it popular with students.
  - Clean UI, PDF annotation, and AI study tools (summaries, quizzes).
- **Complaints:** subscription backlash (2021), no real-time collaboration, late to Android, Windows presence unclear.

#### Samsung Notes
- **Praised:** excellent S Pen feel and palm rejection, voice recording synced to notes, Galaxy AI summaries, and transcription, free.
- **Complaints:** best only on Samsung devices, proprietary format, limited desktop features.

#### Nebo / MyScript
- **Praised:** best-in-class handwriting recognition. Live conversion of ink to text, math (LaTeX) and diagrams that stay editable. Cheap lifetime license.
- **Complaints:** weaker organization and PDF tools, confusing rebrand, sometimes misreads `x` as `×`.

#### Joplin / Logseq / Standard Notes (open source or privacy-first)
- **Joplin**
  - Praised: end-to-end encrypted (E2EE) sync to any backend, Evernote import, plugins, web clipper.
  - Complaints: dated UI, clunky mobile app, OCR plugins unmaintained, ink limited to a sketch plugin.
- **Logseq**
  - Praised: block references and journals.
  - Complaint: the 2.0 move from Markdown files to a SQLite database (beta, July 2026) has been slow, and loses the appeal of plain open files.
- **Standard Notes**
  - Strong E2EE.
  - Slow feature delivery.
  - Owned by Proton since 2024.

---

## 4. Most-loved features, by category

### 4.1 Writing & text
| Feature | Best at it | Notes |
|---|---|---|
| Wiki-links / backlinks `[[ ]]` | Obsidian, Logseq | Called Obsidian's "killer feature." OneNote notes stay "isolated." |
| Local plain-text / Markdown files | Obsidian, Joplin | Ownership, offline use, Git, easy migration |
| Block / outliner model | Logseq, Tana | Every bullet can be linked and referenced |
| Code blocks, LaTeX/KaTeX, Mermaid | Obsidian, Joplin | Wanted by developers and STEM students |
| Freeform page (click anywhere) | OneNote | Adapts to any kind of content |
| Templates | Notability (20k+), Goodnotes, Notion | Cornell, planners, meeting notes |
| Fast search across everything | OneNote, Evernote | Includes text inside images and PDFs |

### 4.2 Handwriting & drawing
| Feature | Best at it | Notes |
|---|---|---|
| Pen feel: pressure, low latency, vector ink | Goodnotes, Xournal++, Samsung Notes | Vector ink stays sharp at any zoom |
| Palm rejection | Samsung Notes, Goodnotes | A leading complaint about OneNote on Windows |
| Ink-to-text | Nebo (best), OneNote, Goodnotes, Apple Scribble | Live preview conversion is the most loved |
| Handwriting search (OCR) | Goodnotes, Apple Notes, OneNote | Users now expect it |
| Math ink → LaTeX / solve / graph | Nebo, OneNote Math Assistant, Apple Math Notes, Goodnotes Math AI | Students love it |
| Shape and diagram recognition | Nebo, Xournal++, OneNote auto-shapes | Diagrams in OneNote feel like "fighting the software" |
| Layers, PDF as a fixed background | Xournal++ | OneNote imports PDFs as "a clunky image" |
| Lasso select, move, resize, recolor | All ink apps | Lasso should grab ink *and* text together |
| Highlighter, ruler, tape/hide tool | Notability, Goodnotes | Used for studying |
| Hand-drawn whiteboard | Excalidraw, tldraw | "Reduces perfectionism anxiety"; shape libraries |

### 4.3 Audio & video recording
- **Audio-synced notes are the most beloved single feature** across all categories.
  - While recording, every stroke and word gets a timestamp. Tapping it plays from that moment.
  - Notability made this famous. OneNote on Windows now replays ink "in lockstep" with recordings. Samsung Notes has it too.
- Video is rarely praised. Treat it as an embed, not a core feature *(synthesis)*.

### 4.4 Transcription & meetings
- **On-device transcription** (Apple Notes, MacWhisper, Buzz, Whisper Notes). Audio "never touches the cloud."
- **Speaker labels (diarization).** Wanted, but still shaky in local tools.
- **Granola's approach:**
  - No bot joins the meeting; it captures mic and system audio directly.
  - Your own typed notes steer the AI summary.
  - Rated 9.5/10 across about 500 reviews.
  - Weaknesses: cloud transcription, no audio replay, manual start.
- **Warning:** Otter.ai's auto-joining bot led to a class action (*Brewer v. Otter.ai*, 2025), which survived a motion to dismiss. Consent and privacy matter.
- **Gap:** No mainstream app combines local Whisper transcription, speaker labels, and ink/text synced to the audio timeline.

### 4.5 AI
- **Seen as useful:**
  - Summaries and auto-formatting (Samsung Note Assist).
  - Meeting-note enhancement (Granola).
  - Q&A over your own notes (RAG), e.g. Obsidian with Smart Connections and Ollama.
  - Handwriting fixes: spellcheck, smoothing, math checking.
  - Flashcards and quizzes generated from notes.
- **Seen as gimmicky or intrusive:**
  - Constant AI prompts.
  - AI that is hard to turn off (Notion).
  - Notes processed in the vendor's cloud (Copilot, Notion).
  - Concerns about training on user data.
- **What users ask for:** AI that is optional, **off by default**, runs **on-device**, and lets them **bring their own model or API key**.
  - A clone of NotebookLM (open-notebook) reached 39.6k★ in under two years, which shows demand for open, local "chat with my sources."

### 4.6 Organization, sync & files
- A notebook › section › page hierarchy (OneNote) **plus** tags and links.
- **Reliable sync** is a top frustration: OneNote conflicts and corrupt sections, Evernote mobile sync, Simplenote data loss.
- **OCR on images and PDFs** is what users miss most after leaving Evernote.
- Web clipper (full page, region, or clean article view).
- PDF import and annotation (Goodnotes, Notability, Xournal++).
- Version history (OneNote keeps about 60 days, so this is expected).
- Real-time collaboration (OneNote, Notion, Excalidraw).

### 4.7 Embedded content
- **Databases, relations, and filtered views** (Notion): loved for lightweight customer relationship managers (CRMs), trackers and roadmaps.
- **Diagrams:** Mermaid in Markdown, Excalidraw drawings, Nebo diagrams.
- **Embedded files**, with a preview (OneNote).
- **Charts:** almost no note app has a native chart block. Users paste images of Excel charts. This is an open slot *(synthesis)*.

### 4.8 Top 20 most-loved features

Ranked by how often and how strongly each one comes up.
1. Notes synced to audio playback: tap to jump (Notability, OneNote Windows, Samsung Notes)
2. Local-first storage in open formats with easy export (Obsidian, Joplin)
3. Natural pen feel: pressure, low latency, vector ink, palm rejection
4. Backlinks, wiki-links, and graph view
5. Accurate ink-to-text (Nebo, OneNote)
6. Global search including handwriting, images, PDFs, and audio
7. Freeform canvas mixing text, ink, images, and files (OneNote)
8. PDF import and annotation with the PDF as a locked background
9. Notebook › section › page hierarchy plus tags
10. Private, bot-free meeting capture where your notes steer the summary (Granola)
11. On-device transcription with speaker labels
12. Lasso, shape, and diagram recognition
13. Math handwriting → LaTeX, solving, and graphing
14. Works on every platform, free or generous storage
15. OCR on images and scans
16. Q&A over your notes (RAG), ideally with a local model
17. Plugin / extension ecosystem
18. Web clipper
19. Databases, smart tables, and templates
20. Infinite whiteboard with hand-drawn diagrams (Excalidraw, tldraw)

*Runners-up:* handwriting spellcheck, ink smoothing, ink replay, real-time collaboration, version history, E2EE.

---

## 5. Rising apps & what they offer that incumbents don't

### 5.1 Profiles

| App | What it is | Growth signal | What's new compared to incumbents | Weaknesses |
|---|---|---|---|---|
| **Obsidian** | Local Markdown vault + plugins | ~1.5M MAU, ~$25M revenue, no outside funding **[uncertain]** | Open files, 1,400+ plugins, Canvas, Bases (database views) | Closed source, paid sync, no ink, learning curve |
| **Logseq** | Open-source outliner + graph | 45k★ | Block references, daily journals; 2.0 adds a database, sync, and real-time collaboration | Slow development; the file → database move is controversial |
| **Tana** | Outliner + typed "supertags" | $25M raised, 160k waitlist (2025) | Tagging a node turns it into a typed database object with fields and live views | Closed, cloud-only, subscription |
| **Capacities** | Object-based notes | Popular with PKM enthusiasts | Typed objects (Person, Book, Meeting) plus daily notes | Closed, cloud-only |
| **Heptabase** | Cards on infinite whiteboards | ~$7M ARR **[uncertain]** | Spatial research and learning; a bootstrapped, profitable niche | Closed, no ink |
| **Anytype** | P2P, E2EE, object-based | 8.9k★ | Fully local-first, CRDT sync, no server required | Heavy app, learning curve |
| **AFFiNE** | Doc + whiteboard hybrid | 73k★ | "Notion + Miro"; switch between page and edgeless canvas; CRDT | Feature sprawl, big issue backlog |
| **AppFlowy** | Open-source Notion alternative | 77k★ | Self-hostable, AI workspace | Team focus, 1,000+ open issues |
| **SiYuan** | Local-first block editor | 46.6k★ (only 15 open issues) | Self-hosted, MCP/AI-agent friendly | Smaller community outside China |
| **Trilium (TriliumNext)** | Hierarchical, scriptable notes | 38k★ | Scripting, cloned notes, self-hosted | Dated UI |
| **memos** | Quick-capture timeline | 63k★ | Frictionless, Twitter-like capture | Not for long-form notes |
| **Notesnook** | E2EE Evernote alternative | 14.7k★ | Privacy-first | No ink |
| **open-notebook** | Open-source NotebookLM clone | 39.6k★ in < 2 yrs | Local "chat with your sources" | Research tool, not a notebook |
| **Granola** | Bot-free AI meeting notes | $1.5B valuation (March 2026); revenue up 250% in a quarter | Captures system audio with no bot; your notes steer the AI | Cloud transcription, closed, no audio replay |
| **NotebookLM** | Source-grounded AI research | ~10M MAU (2024) **[uncertain]** | Chat with citations; podcast-style "Audio Overviews" | Cloud only; not for writing |
| **Microsoft Loop** | Live components across M365 | Available to all Entra users from February 2026 | Blocks that stay in sync across Teams, Outlook, and Word | M365 lock-in; not personal |
| **Excalidraw / tldraw** | Infinite-canvas whiteboards | 133k★ / 51k★ | Hand-drawn style, embeddable SDKs, collaboration | Not notebooks |
| **reMarkable / Supernote / Boox** | E-ink note devices | E-ink tablet market ≈ $5.8B **[uncertain]** | Distraction-free, paper-like writing | Subscriptions, weak desktop integration |

### 5.2 Trends and what they mean for OpenNote

| Trend | Evidence | Implication for OpenNote *(synthesis)* |
|---|---|---|
| **Local-first / data ownership** | Obsidian, Anytype, SiYuan, Joplin; the Logseq backlash; OneNote/OneDrive lock-in complaints | Store notes as open, documented files. Use a database only as a rebuildable index. Sync is optional and pluggable. |
| **AI-native, but private** | Notion Agents, Tana, open-notebook (39.6k★), SiYuan/note-gen pitching MCP | Optional AI layer: local models (Whisper, Ollama, NPU) or bring-your-own-key. Semantic search, chat with notes, MCP server. |
| **Structured notes** (supertags, types, database views) | Tana, Capacities, Anytype, Obsidian Bases, Logseq 2.0 | Page and block properties stored with the note, plus table, board, and calendar views. |
| **Spatial / canvas thinking** | Excalidraw, tldraw, Heptabase, AFFiNE edgeless, Obsidian Canvas | OneNote's freeform page was an early version of this. Offer a canvas that can also be paginated. |
| **Bot-free meeting capture** | Granola's valuation; Otter and Fireflies copying it | Record mic and system audio with local transcription and notes synced to the timeline. Privacy is the advantage over Granola. |
| **Handwriting + typing hybrid** | OneNote Win10 retirement; e-ink growth; open-source ink gap | The clearest opening. |
| **Open-source Notion clones are crowded** | AppFlowy and AFFiNE at ~75k★ each, large backlogs | Don't build another team-wiki clone. Personal and single-user first; collaboration later. |
| **Performance / lightness** | memos (63k★); complaints about Electron and OneNote slowness | Keep startup and ink latency fast. Choose the technology stack carefully (§11). |

---

## 6. State of open-source ink + typed notes

| Project | ★ (2026-09) | Stack | Platforms | Strengths | Gaps |
|---|---|---|---|---|---|
| **Xournal++** | 15.5k | C++ / GTK3 | Win, Mac, Linux | Vector ink, layers, PDF background, LaTeX, shape recognition | No notebook organization, no search across files, no sync, no mobile, dated UI; GTK crashes on Windows 11 (September 2026 issues) |
| **Rnote** | 11.7k | Rust / GTK4 | Win, Mac, Linux | Pressure ink, shapes, PDF/SVG import | No typed-text tool, no sync; file format changed in breaking ways |
| **Saber** | 4.9k | Flutter | Win, Mac, Linux, iOS, Android | Runs everywhere, Nextcloud sync, E2EE | Handwriting-first; limited typed text |
| **Write (Styluslabs)** | — | C++ | All | Handwriting "word processor" with reflow and handwritten links | Niche, no typed notes |
| **OpenBoard** | 3.1k | C++ / Qt | Win, Mac, Linux | Classroom whiteboard | Not a notebook |
| **Joplin** | 56.5k | Electron / React Native | All | Sync, E2EE, OneNote importer | Ink is a sketch plugin only |

**Verdict:** No open-source app currently combines:
- typed text and ink on the same freeform page
- searchable handwriting
- a notebook hierarchy with backlinks
- sync that handles ink data
- a native-quality pen experience
- OneNote import

Of these projects, Saber's Flutter approach is the closest to OpenNote's cross-platform, pen-first goals. It lacks the typed and structured half.

---

## 7. Pain points & missing features

Ratings are qualitative, based on how often, and how strongly each issue appears across sources.

### 7.1 Layout, pagination & export — *the owner's #1 complaint*
| # | Gap | Affects | Evidence | Rating |
|---|---|---|---|---|
| A1 | **No page breaks / page-boundary view.** Infinite page length; content "moves off into a grey void"; images split across pages when exported. | OneNote, Samsung Notes | MS Q&A (2022, still current): "OneNote does not support manual page breaks"; Duke Libraries preservation blog; a third-party add-in (Gem) exists just to preview page breaks | **High** |
| A2 | **No notebook-wide paper size (A4/Letter) or margins** | OneNote | MS Q&A 2026: size must be set page by page; margins not kept | Med-High |
| A3 | **PDF round-trip problems.** Printed PDFs shift off-margin; ink flattens to images on export. | OneNote | MS Q&A; Plaud review | Med-High |
| A4 | **No position lock** for text boxes and images; content drifts while editing | OneNote | MS Q&A feature request | Medium |

### 7.2 Charts, tables & math — *the owner's #2 complaint*
| # | Gap | Affects | Evidence | Rating |
|---|---|---|---|---|
| B1 | **No data charts or graphs.** Only equation graphing via Math Assistant (M365, and only on some builds). Workarounds: Excel embed, Desmos clip, pasted image. | OneNote, most note apps | MS Support; OneNote Education (Desmos) | **High** |
| B2 | **Weak tables.** Single-column A–Z sort, no filter, no formulas without the Gem/OneMore add-ins. | OneNote, Apple Notes, Keep | MS Q&A (multiple threads) | **High** |
| B3 | **Math tools are scattered.** LaTeX in one app, ink math in another, graphing in a third (Desmos). | All | MakeUseOf; review roundups | Med-High (students) |

### 7.3 Platform, sync & lock-in
| # | Gap | Affects | Rating |
|---|---|---|---|
| C1 | OneNote Win10 / "OneNote on Windows" split; the retired app is read-only since 2025-10-14 | OneNote | Medium (one-time, but opens the door to switching) |
| C2 | Sync conflicts ("conflicting changes"), duplicate pages, slow large notebooks | OneNote, Evernote | **High** |
| C3 | Proprietary formats, locked to a cloud account | OneNote, Evernote, Notion, Goodnotes, Samsung | **High**: the #1 reason people switch |
| C4 | Price hikes, note, and device caps | Evernote, Goodnotes, Notability, Bear | **High** (trust) |
| C5 | Weak offline mode | Notion | High |
| C6 | Steep learning curve, paid sync, no ink | Obsidian | High |
| C7 | Apple-first; weak Windows/Android versions | Goodnotes, Notability, Apple Notes | **High** |

### 7.4 Content & knowledge
| # | Gap | Affects | Rating |
|---|---|---|---|
| D1 | No Markdown, no code blocks, or syntax highlighting (the OneMore add-in exists to fill this) | OneNote | High (professionals) |
| D2 | No backlinks; tags weak; no graph | OneNote, Evernote, Apple Notes | Med-High |
| D3 | "Notes go in easily and never come back out": weak search in deep hierarchies; no saved searches | OneNote | Med-High |
| D4 | Dark mode doesn't fully apply to the page canvas | OneNote | Low |

### 7.5 Handwriting, audio, AI, study
| # | Gap | Affects | Rating |
|---|---|---|---|
| E1 | **No single Windows app does it all**: each ink app lacks OCR, sync, typed text, or a modern UI | Xournal++, Nebo, Goodnotes Win, Scrble, Samsung Notes | **High**: the white space |
| E2 | Goodnotes on Windows is web-based and limited; Notability's Windows presence is unclear | Goodnotes, Notability | High |
| E3 | Audio, transcription, and AI are paywalled or capped (Copilot license; 300 min/mo) | OneNote, Goodnotes, Notability | **High**, rising |
| E4 | No flashcards or spaced repetition from notes; students juggle RemNote/Anki | Nearly all | Med-High (education) |
| E5 | Citation manager and PDF reading live in separate apps (Zotero + note app + Word) | Nearly all | Med-High (grad students) |
| E6 | Few templates, and inconsistent quality (Cornell, lab, meeting) | OneNote | Medium |
| E7 | Local-first + E2EE apps lack ink and canvas | Joplin, Anytype, Notesnook | Med-High |

---

## 8. Feature comparison matrix

✅ strong / ◐ partial or paid / ❌ missing. These are approximate and meant for orientation only; verify before publishing any comparison.

| Feature | OneNote | Evernote | Notion | Obsidian | Goodnotes | Notability | Apple Notes | Joplin | Xournal++ | **OpenNote goal** |
|---|---|---|---|---|---|---|---|---|---|---|
| Typed rich text | ✅ | ✅ | ✅ | ✅ | ◐ | ◐ | ✅ | ✅ | ◐ | ✅ |
| Ink / handwriting | ✅ | ◐ | ❌ | ◐ (plugin) | ✅ | ✅ | ✅ | ◐ | ✅ | ✅ |
| Ink + text on same freeform page | ✅ | ❌ | ❌ | ❌ | ◐ | ◐ | ◐ | ❌ | ◐ | ✅ |
| Paginated / print-layout view | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ (toggle) |
| Charts from data | ❌ | ❌ | ◐ | ◐ (plugin) | ❌ | ❌ | ❌ | ◐ (plugin) | ❌ | ✅ |
| Smart tables (sort, filter, formulas) | ◐ | ❌ | ✅ | ◐ | ❌ | ❌ | ❌ | ◐ | ❌ | ✅ |
| Math (LaTeX / ink math / graph) | ◐ | ❌ | ◐ | ◐ | ◐ | ◐ | ✅ (Apple) | ◐ | ◐ | ✅ |
| Audio synced to notes | ✅ | ❌ | ❌ | ❌ | ◐ | ✅ | ◐ | ❌ | ❌ | ✅ |
| Local / private transcription | ❌ | ❌ | ❌ | ◐ (plugin) | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| Backlinks / graph | ❌ | ◐ | ◐ | ✅ | ❌ | ❌ | ◐ | ◐ | ❌ | ✅ |
| Markdown + code blocks | ❌ | ◐ | ✅ | ✅ | ❌ | ❌ | ◐ | ✅ | ❌ | ✅ |
| Handwriting / image OCR search | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| PDF annotation | ◐ | ◐ | ❌ | ◐ | ✅ | ✅ | ◐ | ❌ | ✅ | ✅ |
| Open / local file format | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ◐ | ✅ | ✅ |
| Works offline | ✅ | ◐ | ◐ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Every OS incl. Windows + mobile | ✅ | ✅ | ✅ | ✅ | ◐ | ◐ | ❌ | ✅ | ◐ | ✅ (eventually) |
| Open source | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |

---

## 9. Opportunity list for OpenNote

Items marked ★ span all audiences and belong in the core product.

### 9.1 Core (all audiences)
1. ★ **Page view toggle: Infinite ↔ Paginated.** The same page can be shown as an infinite canvas or as Letter/A4/custom pages. Paginated view shows page boundaries, margins and manual page breaks, keeps images and tables together, and uses a default paper size per notebook. Printing and PDF match what you see on screen. *(A1–A4)*
2. ★ **Chart blocks.** Bar, line, pie, and scatter charts built from a table, a CSV or pasted data. They update live when the data changes and export as vector images. *(B1)*
3. ★ **Smart tables.** Column types, multi-column sort and filter, formulas and totals, and "make chart from this table." *(B2)*
4. ★ **Ink and typed text on the same page.** Pressure, tilt, palm rejection, low latency, a lasso that selects ink *and* text, shape snapping, and ink-to-text. *(E1)*
5. ★ **Open, documented storage.** Readable files (e.g. Markdown + JSON/SVG ink + assets). SQLite only as a rebuildable search index. Export to Markdown, PDF, DOCX, and HTML. No account required. *(C3)*
6. ★ **Importers.** OneNote (keeping the 2D layout and ink, which existing tools flatten), Evernote export files (ENEX), Notion, Obsidian, Joplin, Goodnotes/PDF. *(C1, C3, C4)*
7. ★ **Search everything.** Typed text, handwriting (OCR), images, PDFs, and audio transcripts, with saved searches and filters. *(D3)*
8. **Backlinks, `[[links]]`, graph view, nested tags**, all built in with no plugins needed. *(D2)*
9. **Reliable, pluggable sync.** Folder-based sync (OneDrive, Dropbox, iCloud Drive, Syncthing), WebDAV or self-hosted, optional E2EE. Conflict-free replicated data types (CRDTs) or field-level merging so conflicts never corrupt pages. *(C2)*
10. **Version history** with no short expiry, including a page timeline and restore.

### 9.2 Education
11. **Audio-synced notes.** Tap a stroke or word to hear that moment. Local transcription with speaker labels, no monthly limits. *(E3)*
12. **Math suite.** Typed LaTeX, ink → equation, a step-by-step solver, and an embedded function grapher (Desmos-style) as a block. *(B3)*
13. **PDF and slide import with annotation.** The PDF is a locked background layer, and annotations export back to PDF with correct pages. *(A3)*
14. **Flashcards and spaced repetition** built from notes (cloze deletions, Q/A blocks), optionally AI-generated. *(E4)*
15. **Citations.** Zotero integration and BibTeX blocks; export with a bibliography. *(E5)*
16. **Paper templates.** Cornell, lined, dot grid, graph, isometric, lab notebook, music staff, planners, plus custom templates. *(E6)*
17. **Class mode.** Hand out pages, lock submitted pages, add teacher feedback in its own layer, lock object positions. *(A4)*

### 9.3 Business / professional
18. **Markdown and code.** Markdown shortcuts and paste, fenced code with syntax highlighting, Mermaid/PlantUML diagrams. *(D1)*
19. **Meeting mode.** Record mic and system audio without a bot, with a consent reminder. Local transcription, summary, action items turned into tasks, agenda template.
20. **Tasks and calendar.** Checkbox tasks with due dates rolled up into a daily/agenda view. Calendar links (Outlook/Google/CalDAV) to create a meeting note from an event.
21. **Properties and database views.** Typed page properties; table, board, and calendar views over pages (like Obsidian Bases or Notion databases).
22. **Whiteboard / canvas blocks** and, later, real-time collaboration (CRDT, so it also works offline).
23. **Branded export and publishing.** Paginated PDF/DOCX with headers, footers, and a logo; static HTML sharing.
24. **Privacy and admin.** E2EE, local-only AI, a "never train on my data" guarantee, and optional audit logs.
25. **Extensibility.** Plugin API, command palette, local API, and MCP server so AI agents can read and write notes.

### 9.4 AI (optional, off by default)
- Summaries, "chat with this notebook" with citations, semantic search, auto-tagging, flashcard generation, handwriting cleanup, meeting enhancement.
- Run on local models: Whisper, llama.cpp or Ollama, a Windows neural processing unit (NPU) via Foundry Local / ONNX / DirectML, Apple Core ML, or Android NNAPI.
- Or use a bring-your-own-key (BYOK) cloud endpoint.
- Always show what data leaves the device.

---

## 10. Quality-of-life feature backlog

Small features that together make a "one-stop shop." Many were inspired by the complaints above; the rest are *(synthesis)*.

**Layout & page**
- Page-view toggle (infinite / paginated / continuous paginated scroll), with rulers and margins shown.
- Snap-to-grid and alignment guides; position lock on any object.
- Paper backgrounds that can be set per page, section, or notebook.
- Zoom presets (fit width, fit page, 100%) with pinch-zoom everywhere.
- Split view and tabs: two pages side by side (e.g. a PDF and notes, or lecture slides and notes).
- Focus / distraction-free mode; true dark mode, including the page canvas and optionally inverted ink colors.

**Content**
- Chart, table, math, code, Mermaid, callout, toggle/collapsible, and embedded-file blocks.
- Paste handling: Excel/CSV → smart table; Markdown → formatted text; image → OCR'd image; URL → preview card.
- Handwriting tools: ruler/protractor, highlighter behind text, tape/hide for self-quizzing, pen presets, pressure curve settings.
- Emoji and symbol picker, including equation symbols.

**Capture**
- Global quick-capture hotkey or widget (like memos / Keep).
- Screenshot or region clip into the current page, with OCR.
- Web clipper (full page / region / clean article).
- Document scanner on mobile (edge detection + OCR).
- Voice memo → transcript in one tap.

**Navigation & organization**
- Command palette (Ctrl+K / Ctrl+P); recent pages; back/forward history.
- Outline / table of contents panel for long pages.
- Pinned and favorite pages; per-notebook color and icon; section groups.
- Saved searches; a "Today" daily note; templates chosen when creating a page.

**Trust**
- A visible sync-status indicator, conflict copies instead of silent overwrites, a one-click "export everything," and autosave with local snapshots.

---

## 11. Cross-platform & multi-screen implications

> **Requirement:** Windows first, but the app must eventually run on macOS, Linux, iOS/iPadOS and Android, and scale from phones to large monitors. Every decision below keeps that door open. *(synthesis)*

### 11.1 Architecture principles
1. **The file format is the platform.** Define an open, versioned, documented note format early (text as Markdown or JSON blocks, ink as vector strokes with pressure and timestamps, audio, and assets as files, page layout metadata). Any client on any OS reads the same files. Rnote's breaking format changes are a warning; Obsidian's plain files show what works.
2. **Share the core, keep the shells thin.** Put the document model, format read/write, search indexing, sync/merge (CRDT), import/export and the ink geometry engine into a **shared, portable core**. Rust or C++ compile everywhere; TypeScript works if the UI is web-based. Only UI, pen input, audio capture, and OS integration should be platform-specific.
3. **Use a platform-agnostic ink model.** Store raw input points (x, y, pressure, tilt, timestamp) and draw them with your own renderer. Don't depend on Windows Ink's `InkCanvas` / ISF format for storage, or mobile clients will not be able to read the notes. Use Windows Ink, Apple Pencil, and Android stylus APIs only as *input sources*.
4. **Timestamp everything.** Per-stroke and per-block timestamps make audio sync, ink replay, version history, and CRDT merges possible on every platform.
5. **Keep AI local, with abstractions.** Hide AI behind a provider interface. whisper.cpp and llama.cpp run on every OS. NPU backends differ by platform (DirectML / Foundry Local on Windows, Core ML on Apple, NNAPI on Android). Cloud BYOK is the fallback.

### 11.2 UI framework options

| Option | Windows | macOS/Linux | iOS/Android | Pen / ink latency | Notes |
|---|---|---|---|---|---|
| **Flutter** | ✅ | ✅ | ✅ | Good; custom canvas | One UI codebase for every target. Saber shows it works for ink notes. Desktop feels a bit less native. |
| **Tauri 2 (Rust + web UI)** | ✅ (WebView2) | ✅ | ✅ (Tauri 2 mobile) | Web canvas; pointer-event pressure works, but latency needs care | Small installs, Rust core. Web UI can reuse Excalidraw/tldraw-style libraries. Mobile support is newer. |
| **Avalonia / .NET MAUI** | ✅ | ✅ / ◐ | ✅ (MAUI) | Good (Skia) | Suits developers who know C#. MAUI's Linux support is weak. |
| **Qt (C++/QML)** | ✅ | ✅ | ✅ | Very good | Mature, but licensing and the mobile experience are harder. |
| **Electron + React Native** | ✅ | ✅ | ✅ (separate RN app) | Web canvas | Joplin's approach. Two UI codebases, heavy desktop app. |
| **WinUI 3 (native)** | ✅ best | ❌ | ❌ | Best on Windows | Best Windows ink, but a cross-platform rewrite later. **Not recommended** given the multi-platform goal. |

**Recommendation to evaluate:**
- **Flutter** or **Tauri 2 + a shared Rust core.** Both reach every target from one codebase.
- **Build a pen-latency prototype on Windows first** (Surface Pen or Wacom). Ink feel decides whether an app is used or abandoned, and it is where the options differ most.
- The final choice belongs in a design/architecture document.

### 11.3 Responsive and adaptive layout
- **Breakpoints:** phone (< 600 dp), small tablet or foldable (600–840), tablet/laptop (840–1200), desktop and ultrawide (> 1200).
- **Navigation:**
  - Desktop: three panes (notebooks | pages | editor).
  - Tablet: two panes with a collapsible sidebar.
  - Phone: one pane with stacked navigation and a bottom toolbar.
- **Pages on small screens:**
  - A freeform OneNote-style page is hard to use on a phone. Offer a **reflow / "reading" view** that shows blocks in a single column while leaving the stored layout alone.
  - Paginated pages fit to width.
  - Infinite canvases pan and zoom.
  - This fixes a common complaint about OneNote mobile *(synthesis)*.
- **Toolbars adapt:** ribbon or top bar on desktop, floating pen palette on tablets, compact bottom sheet on phones. Pen shortcuts are configurable.
- **Input modes:** mouse + keyboard, touch, and pen are all first-class. Finger vs pen drawing is set per device (the Goodnotes/Notability pattern). Palm rejection is on whenever a pen is active.
- **Accessibility:** screen-reader labels, keyboard navigation, high contrast, and scaling that respects OS text-size settings on every platform.
- **Performance budget:** large notebooks must stay smooth on low-end phones, so use lazy loading, tile-based ink rendering, and background indexing.

### 11.4 Platform-specific capability map
| Capability | Windows | macOS | Linux | iOS/iPadOS | Android |
|---|---|---|---|---|---|
| Pen input | Windows Ink / Pointer API | NSEvent tablet / Pencil (Sidecar) | libinput / Wacom | Apple Pencil (PencilKit input or raw touches) | MotionEvent stylus / S Pen |
| System audio capture (meetings) | WASAPI loopback | ScreenCaptureKit (macOS 13+) | PipeWire / PulseAudio monitor | Not allowed (mic only) | Limited (MediaProjection) |
| On-device OCR | Windows.Media.Ocr | Vision framework | Tesseract | Vision framework | ML Kit |
| On-device AI | DirectML / Foundry Local / NPU | Core ML / MLX | CPU / GPU (llama.cpp) | Core ML | NNAPI / LiteRT |
| File sync location | OneDrive folder | iCloud Drive | Any folder / Syncthing | iCloud / Files app | SAF / Syncthing |

Mobile operating systems restrict background system-audio capture. On phones, meeting mode will be mic-only, and the UI should say so.

---

## 12. Windows-first specifics

- **Pen and Surface:**
  - Low-latency inking with pressure and tilt, the pen's barrel button and eraser, and Surface Slim Pen haptics where available.
  - Windows' own palm rejection and hover.
  - This is where OneNote on Windows draws the most complaints (unpredictable palm rejection) and where Xournal++'s GTK base is fragile.
- **OneNote migration:**
  - OneNote for Windows 10 has been read-only since 2025-10-14.
  - A OneNote importer that **keeps the 2D layout and ink** would be a headline feature. Current tools (OneNote Md Exporter, Obsidian Importer) flatten pages to linear Markdown.
  - Import can go through the Microsoft Graph API (OneNote pages come back as HTML with ink data) or through local `.one` / `.onepkg` parsing.
- **Copilot+ PC NPUs (40+ trillion operations per second (TOPS)):**
  - Local Whisper transcription, handwriting recognition, summaries, and flashcard generation, without the Copilot license Microsoft charges for.
  - Foundry Local provides an OpenAI-compatible localhost endpoint. Use the NPU when present and fall back to CPU/GPU otherwise.
- **Meeting capture:** WASAPI loopback records Teams, Zoom, or Meet audio with no bot joining the call.
- **OS integration:**
  - Windows OCR API.
  - Share target, Print to PDF, file associations.
  - Jump lists and a global hotkey for quick capture.
  - Snipping Tool / clipboard image paste.
  - Toast notifications for reminders.
  - Snap Layouts / multi-window.
- **Distribution:** Microsoft Store, winget, and a portable build.

---

## 13. Suggested positioning & first prototype

### Positioning *(synthesis)*
> **OpenNote:** the open-source, local-first notebook where **typed text, handwriting, audio, math, and charts live on the same page**. It has a real **print layout**, **private on-device AI**, and **one-click import from OneNote and Evernote**. Windows first; every screen and OS next.

### Suggested prototype sequence (Windows)
1. **Document model + open file format** (text blocks, ink strokes, images) and notebook › section › page navigation.
2. **Freeform page with ink and typed text together.** Pen pressure, palm rejection, lasso, undo. Validate pen latency early.
3. **Page view toggle** (infinite ↔ paginated with page breaks) + **PDF export that matches the screen**.
4. **Smart tables → chart blocks.**
5. **Audio recording synced to strokes and text** (tap to play).
6. **Search** (typed text, then OCR of handwriting, and images) + **backlinks**.
7. **Markdown shortcuts, code blocks, LaTeX math.**
8. **OneNote / Evernote import.**

Items 1–4 answer your two stated complaints plus the largest white space (ink + typed). Items 5–8 cover the most-loved features and switching costs. Next: local transcription, PDF annotation, templates, flashcards, sync, then mobile clients.

### Things *not* to do (lessons from the research)
- Don't clone Notion's team wiki; AppFlowy and AFFiNE already crowd that space.
- Don't lock data in an opaque database (the Logseq 2.0 backlash) or a vendor cloud (OneNote, Evernote).
- Don't make AI intrusive or on by default. Don't join meetings as a bot.
- Don't gate core features (sync, audio minutes, note counts) behind paywalls. That is the main source of distrust in Evernote, Goodnotes, and Notability.

---

## 14. Open questions / things to verify

- Exact Evernote Starter/Advanced prices and limits (the official FAQ was blocked).
- Whether Notability has a real Windows app today.
- Whether Ink Math Assistant graphing exists in the new "OneNote on Windows" (it was documented for the retired Win10 app and the web).
- Obsidian, Goodnotes, and NotebookLM user numbers (vendor or aggregator only).
- Simplenote's status (maintenance mode vs. shut down).
- Reddit / Microsoft Feedback Portal vote counts for page breaks, charts and table requests (not reachable during this research).
- Licensing: is the OneNote `.one` format (`[MS-ONESTORE]`) documented well enough for an offline importer? Or is the Graph API the only practical route?
- Legal: recording-consent rules for meeting capture differ by region (one-party vs two-party consent).

---

## 15. Sources

### Incumbent apps
- OneNote Win10 retirement: https://support.microsoft.com/en-us/office/what-is-happening-to-onenote-for-windows-10-2b453bfe-66bc-4ab2-9118-01e7eb54d2d6 · https://support.microsoft.com/en-us/office/moving-to-onenote-on-windows-4ba7b498-aafc-44b1-8326-a582a6c71196 · https://techcommunity.microsoft.com/blog/microsoft365insiderblog/onenote-for-windows-10-support-is-ending/4445230 · https://www.thurrott.com/cloud/microsoft-365/318795/microsoft-finally-kills-onenote-for-windows-10
- OneNote transcription and ink: https://techcommunity.microsoft.com/blog/microsoft365insiderblog/transcribe-and-ink-experience-in-onenote-on-windows/4217122 · https://support.microsoft.com/en-us/office/transcribe-your-recordings-7fc2efec-245e-45f0-b053-2a97531ecf57 · https://support.microsoft.com/en-us/onenote/take-notes-with-copilot-in-onenote · https://mc.merill.net/message/MC1405506 · https://www.hubsite365.com/en-ww/crm-pages/7-new-features-in-microsoft-onenote-for-2026.htm
- Evernote: https://techcrunch.com/2022/11/16/bending-spoons-acquires-evernote-marking-the-end-of-an-era/ · https://techcrunch.com/2023/11/27/evernote-pushes-users-to-upgrade-with-test-of-a-free-plan-limited-to-only-50-notes/ · https://www.eesel.ai/blog/evernote-pricing · https://www.tamingthetrunk.com/p/how-did-evernote-do-in-2025-my-thoughts
- Notion: https://research.contrary.com/report/notion · https://www.notion.com/blog/introducing-notion-3-0 · https://www.eesel.ai/blog/notion-pricing · https://sqmagazine.co.uk/notion-statistics/
- Apple Notes: https://www.macrumors.com/how-to/ios-import-export-markdown-apple-notes/ · https://appleinsider.com/articles/24/06/13/record-summarize-and-transcribe-audio-with-apple-notes-on-ios-18 · https://9to5mac.com/2024/07/17/ipados-18-smart-script-math-notes-interview/
- Google Keep: https://support.google.com/keep/answer/15222789?hl=en
- Obsidian: https://obsidian.md/about · https://practicalpkm.com/2026-obsidian-report-card/ · https://www.operatorbook.dev/stories/obsidian-revenue-estimates-2m-to-25m · https://fueler.io/blog/obsidian-usage-revenue-valuation-growth-statistics
- Goodnotes: https://www.goodnotes.com/pricing · https://support.goodnotes.com/hc/en-us/articles/13651365090575-Changes-to-Android-Windows-Yearly-Plan · https://techcrunch.com/2023/08/09/goodnotes-biggest-update-in-four-years-brings-ai-powered-handwriting-features-and-a-digital-marketplace
- Notability: https://9to5google.com/2026/08/03/notability-app-android-release/ · https://en.wikipedia.org/wiki/Notability_(application) · https://sdrc.ucr.edu/notability
- Samsung Notes: https://www.androidauthority.com/samsung-notes-windows-update-3559666/ · https://www.samsung.com/us/support/answer/ANS10000941/
- Joplin: https://joplinapp.org/plans/ · https://joplinapp.org/help/apps/drawing_tool/ · https://discourse.joplinapp.org/t/evernote-is-contemplating-limiting-free-account-to-50-notes-we-may-get-a-surge-of-en-refugees/33620
- Others: https://bear.app/faq/features-and-price-of-bear-pro/ · https://zoia.org/posts/the-slow-death-of-simplenote/ · https://www.zoho.com/notebook/pricing.html · https://standardnotes.com/blog/2025-update · https://techcrunch.com/2024/04/10/proton-standard-notes/ · https://www.myscript.com/pricing/ · https://petri.com/microsoft-loop-generally-available/
- Market and surveys: https://survey.stackoverflow.co/2025/technology · https://en.wikipedia.org/wiki/List_of_most-downloaded_Google_Play_applications · https://www.researchandmarkets.com/reports/5790688/note-taking-app-market-report

### Features and sentiment
- https://zapier.com/blog/best-note-taking-apps/ · https://www.selecthub.com/note-taking-software/onenote-vs-obsidian-notes/ · https://noteplan.co/blog/obsidian-vs-onenote
- https://www.xda-developers.com/open-source-note-taking-app-beats-onenote-at-its-own-game/ · https://www.xda-developers.com/obsidian-proves-note-taking-doesnt-need-ai/
- https://www.macstories.net/reviews/nebos-handwriting-recognition-elevates-your-notes/ · https://paperlike.com/blogs/paperlikers-insights/nebo-app-review
- https://zackproser.com/blog/granola-ai-review · https://tldv.io/blog/granola-review/ · https://natlawreview.com/article/ai-notetaking-tools-under-fire-lessons-otterai-class-action-complaint
- https://www.getvoibe.com/resources/macwhisper-review/ · https://lumevoice.com/blog/macwhisper-vs-buzz-vs-whisper-desktop/ · https://localaimaster.com/blog/local-ai-obsidian-integration
- https://daftei.com/blog/posts/notes-app-privacy-comparison/ · https://svenstork.com/posts/switching-from-evernote-to-joplin/ · https://www.eesel.ai/blog/notion-review

### Rising apps
- https://techcrunch.com/2026/03/25/granola-raises-125m-hits-1-5b-valuation-as-it-expands-from-meeting-notetaker-to-enterprise-ai-app/ · https://www.bloomberg.com/news/articles/2026-03-25/ai-notetaker-granola-hits-1-5-billion-value-in-125-million-funding
- https://techcrunch.com/2025/02/03/tana-snaps-up-25m-with-its-ai-powered-knowledge-graph-for-work-racking-up-a-160k-waitlist/ · https://www.cbinsights.com/company/heptabase/
- https://kompozy.io/news/logseq-2-0-db-version-beta · https://github.com/logseq/docs/blob/master/db-version.md
- https://affine.pro/blog/affine-vs-appflowy-vs-anytype · https://openalternative.co/compare/anytype/vs/appflowy · https://gitnux.org/notebooklm-statistics/
- https://www.clearpeople.com/blog/could-microsoft-loop-be-the-future-of-collaboration · https://hub.causo.ai/guides/granola-vs-otter-vs-fireflies-ai-notes-2026
- GitHub repositories (★ read 2026-09-30): `AppFlowy-IO/AppFlowy` · `toeverything/AFFiNE` · `siyuan-note/siyuan` · `logseq/logseq` · `laurent22/joplin` · `TriliumNext/Trilium` · `anyproto/anytype-ts` · `xournalpp/xournalpp` · `flxzt/rnote` · `saber-notes/saber` · `styluslabs/Write` · `OpenBoard-org/OpenBoard` · `excalidraw/excalidraw` · `tldraw/tldraw` · `usememos/memos` · `lfnovo/open-notebook` · `streetwriters/notesnook` · `zsviczian/obsidian-excalidraw-plugin`
- Xournal++ Windows crash reports: https://github.com/xournalpp/xournalpp/issues/7744 · https://github.com/xournalpp/xournalpp/issues/7763

### Pain points and gaps
- Page breaks: https://learn.microsoft.com/en-us/answers/questions/5148471/how-to-add-page-breaks-in-one-note-in-order-avoid · https://feedbackportal.microsoft.com/feedback/idea/97a018b5-d71c-ec11-b6e7-0022481f8879 · https://blogs.library.duke.edu/preservation/?p=5603 · http://www.onenotegem.com/a/documents/gem-for-OneNote/Cooperation_Tab/2019/1124/1026.html
- Paper size / PDF: https://learn.microsoft.com/en-au/answers/questions/5864803/onenote-issue-suggestions-to-improve-onenote-pdf-h · https://www.plaud.ai/blogs/articles/onenote-alternatives
- Position lock: https://learn.microsoft.com/en-us/answers/questions/5804951/feature-request-page-lock-content-position-lock-in
- Charts and math: https://support.microsoft.com/en-us/onenote/draw-graphs-of-math-functions-with-math-assistant-in-onenote · https://www.cdata.com/kb/tech/onenote-odbc-clear-analytics.rst
- Tables: https://learn.microsoft.com/en-us/answers/questions/4981811/onenote-table-limitations · https://learn.microsoft.com/en-us/answers/questions/fee57fc8-a06b-4621-b502-9e60e0187b34/filter-and-sort-tables-in-onenote?forum=msoffice-all
- Sync and performance: https://learn.microsoft.com/en-us/answers/questions/5238477/how-to-fix-onenote-being-incredibly-laggy · https://learn.microsoft.com/en-us/answers/questions/5233076/onenote-reasonable-limits-to-avoid-performance-iss · https://www.usecarly.com/blog/onenote-alternatives/ · https://www.atlasworkspace.ai/blog/onenote-alternatives
- Markdown and code in OneNote: https://unmarkdown.com/blog/onenote-markdown · https://github.com/stevencohn/OneMore · https://zettelkasten.de/posts/one-note-review/
- OneNote export tools: https://obsidian.md/help/import/onenote · https://github.com/segunak/one-note-to-markdown
- Notion offline: https://affine.pro/blog/notion-offline · https://ones.com/blog/notion-docs-app-offline-mode-what-actually-works-in-2026/
- Obsidian costs: https://toolsbrief.org/obsidian-review-2026-local-first-notes-free-core-honest-costs/
- Windows pen apps: https://www.makeuseof.com/note-taking-apps-windows-pen-tablet-users/ · https://setapp.com/app-reviews/goodnotes-vs-notability · https://feedback.goodnotes.com/forums/950440-improve-goodnotes-for-android-windows-and-web/suggestions/46194589-stop-developing-for-windows-as-a-web-app
- Study tools: https://www.screensnap.pro/blog/best-study-notes-app · https://effortlessacademic.com/ipad-workflow-notero-papership-zotero-for-organised-note-taking/
- Local-first: https://myflexnote.com/blog/best-local-first-note-taking-apps
- Windows AI: https://blogs.microsoft.com/blog/2024/05/20/introducing-copilot-pcs/ · https://techcommunity.microsoft.com/blog/surfaceitpro/vibe-coding-for-the-npu/4497674
