# OpenNote note format

This document specifies version 1 of the OpenNote note format. It describes how a notebook is stored as a folder of files, and how to read and write those files safely. It is written for anyone who builds software that reads or writes OpenNote notebooks, including OpenNote itself on each platform. An architecture decision record (ADR), [ADR 0008](../adr/0008-note-file-format.md), records why the format looks the way it does.

- Format version: 1
- Status: draft. Version 1 is frozen when Phase 3 merges into `main`. After that it never changes. Later versions add sections and list their changes in [Appendix C](#appendix-c-change-log).

## Contents

1. [About this specification](#1-about-this-specification)
2. [Conventions](#2-conventions)
3. [Notebook layout](#3-notebook-layout)
4. [Tree files](#4-tree-files)
5. [Pages](#5-pages)
6. [Blocks](#6-blocks)
7. [OpenNote Markdown](#7-opennote-markdown)
8. [Ink](#8-ink)
9. [Ink segment files](#9-ink-segment-files)
10. [Assets](#10-assets)
11. [Readable copies](#11-readable-copies)
12. [Trash](#12-trash)
13. [Page history](#13-page-history)
14. [Conflicts and sync tools](#14-conflicts-and-sync-tools)
15. [Versions and compatibility](#15-versions-and-compatibility)
16. [Validation and limits](#16-validation-and-limits)
17. [Saving safely](#17-saving-safely)
18. [Changing the notebook tree](#18-changing-the-notebook-tree)
19. [Automatic deletions](#19-automatic-deletions)
20. [Device-local data and the journal](#20-device-local-data-and-the-journal)
21. [Security considerations](#21-security-considerations)
- [Appendix A: Constants](#appendix-a-constants)
- [Appendix B: Test vectors and fixtures](#appendix-b-test-vectors-and-fixtures)
- [Appendix C: Change log](#appendix-c-change-log)

## 1. About this specification

### 1.1 Scope

This specification covers every file inside a notebook folder. It also covers the small set of files that OpenNote keeps on each device to recover from crashes. It does not cover the search index, thumbnails, or other caches. Those are private to the app, and the app can rebuild them from the notebook at any time.

### 1.2 Requirement words

"Must" and "must not" mark requirements. "Should" marks a strong recommendation that a writer may skip only for a stated reason. "May" marks an option.

A reader is software that opens notebook files. A writer is software that changes them. Most software is both.

### 1.3 Parts and who needs them

| Part | Sections | Needed by |
|---|---|---|
| Conventions, layout, and file formats | 2 to 11 | Every reader and writer |
| Trash, page history, and conflicts | 12 to 14 | Every writer, and readers that show Trash or history |
| Versions, limits, safe saving, tree changes, and deletions | 15 to 19 | Every writer |
| Device-local data and the journal | 20 | Apps that edit notebooks interactively and recover from crashes, as OpenNote does |
| Security considerations | 21 | Every reader |

A tool that only exports notebooks needs sections 2 to 11, 15, 16, and 21.

### 1.4 Design goals

- Notes stay readable without OpenNote. Every page has a Markdown copy, handwriting has an SVG picture, and every format is documented here in full.
- A crash never damages a page. Each page changes through one atomic file replace, and every file it refers to is written first and never changed afterward.
- At most 1 second of work is lost when the app or the computer stops suddenly, as [BRAND.md section 10](../../BRAND.md#10-comfort-and-performance-budgets) requires.
- Sync tools and several devices are expected. Files may arrive in any order. Conflicting copies are kept and shown, never silently overwritten.
- Older apps open newer files read-only. Newer apps upgrade older files with tested migrations.
- The same rules work on Windows, macOS, Linux, iOS, and Android.

## 2. Conventions

### 2.1 Binary values and checksums

All integers in binary files are little-endian. `f32` is an IEEE 754 binary32 value.

CRC-32 is the cyclic redundancy check (CRC) that zlib, gzip, and PNG use: the reflected polynomial `0xEDB88320`, an initial value of `0xFFFFFFFF`, and a final bitwise exclusive or with `0xFFFFFFFF`. Its check value for the 9 ASCII bytes `123456789` is `cbf43926`. JSON files write a CRC-32 as 8 lowercase hexadecimal digits.

To round a value means to round half away from zero, as Rust's `f64::round` does. JavaScript's `Math.round` rounds −2.5 to −2, so JavaScript writers must use `Math.sign(v) * Math.round(Math.abs(v))`.

### 2.2 JSON files

Readers must accept UTF-8 with or without a byte order mark (BOM), any whitespace between tokens, carriage return and line feed (CRLF) line endings, and keys in any order. Readers must reject duplicate keys, invalid UTF-8, escaped lone surrogates such as `\ud800`, and nesting deeper than 128 levels.

Writers must produce the canonical form, so the same content always gives the same bytes. That keeps sync uploads small, makes diffs readable, and lets tests compare files byte for byte. The canonical form is:

| Rule | Detail |
|---|---|
| Encoding | UTF-8 without a byte order mark, line feed (LF) line endings, and a final newline |
| Indentation | 2 spaces per level, one key per line, and `": "` after each key |
| Scalar arrays | An array whose items are all strings, numbers, booleans, or null is written on one line, with `, ` between items |
| Other arrays | One item per line |
| Empty values | `[]` and `{}` |
| Key order | Known keys in the order this specification lists them, then unknown keys in Unicode code point order |
| Maps | Objects keyed by IDs, such as `assets`, table `cells`, and element `tags` and `styles`, have their keys in code point order |
| Unknown objects | Keys in code point order at every level |
| Strings | Escape only `"`, `\`, and `U+0000` to `U+001F`. Use `\b`, `\f`, `\n`, `\r`, and `\t` where they exist, and `\u00XX` with lowercase hexadecimal digits otherwise. Write everything else as raw UTF-8, including `/` |
| Defaults | A field whose value equals its stated default is left out |

Writers leave a file alone when the bytes they would write equal the bytes it already holds. Git, sync tools, and backups then see a change only when the content changed. The readable copies in section 11 use the same encoding, line endings, and final newline.

### 2.3 Numbers

Integers are written in decimal, with no fraction and no leading zeros.

Geometry values (positions, sizes, spacing, margins, and angles) are rounded to 0.01 before writing. They are written in the shortest form, with no exponent, no trailing zeros after the decimal point, and `0` instead of `-0`. Examples: `96`, `96.5`, `793.7`, and `-12.25`. Their absolute value must be at most 10,000,000.

NaN and infinity are never valid.

### 2.4 IDs

IDs are 128-bit values in the layout of a Universally Unique Lexicographically Sortable Identifier (ULID). The first 48 bits are the Unix time in milliseconds when the ID was made. The other 80 bits come from the operating system's secure random generator.

| Form | Rule |
|---|---|
| Text | 26 characters of Crockford base32 in lowercase, from the alphabet `0123456789abcdefghjkmnpqrstvwxyz`. The first character is `0` to `7` |
| Parsing | Readers accept uppercase letters and store lowercase. They reject any other character, including `i`, `l`, `o`, and `u`, and any other length |
| Binary | 16 bytes, most significant byte first, so byte order matches text order |

Notebooks, section groups, sections, pages, blocks, text elements, table rows and columns, strokes, assets, ink segments, revisions, transactions, Trash items, devices, and tree intents have IDs.

Notebook, section, and page IDs are unique everywhere. Block, text element, stroke, asset, and segment IDs must be unique within their page. They are random, so in practice they are unique everywhere, too.

The time prefix shows when an item was made. The item's `created` field already records that, so the prefix exposes nothing new.

### 2.5 Timestamps

Timestamps are strings in exactly this form, in Coordinated Universal Time (UTC) with milliseconds: `YYYY-MM-DDTHH:MM:SS.sssZ`. An example is `2026-09-30T14:03:22.114Z`. Years run from 0001 to 9999.

Readers also accept a numeric offset such as `+02:00`, a missing fraction, and more than 3 fraction digits, which they truncate to milliseconds. Writers always write the 24-character form.

Writers take times from the wall clock, anchored to a monotonic clock once per session. A change to the system clock during a session then never makes a later time jump behind an earlier one. Readers must not use timestamps to decide which of two versions wins, except where this specification says so.

### 2.6 Units and coordinates

One page unit is 1/96 inch (0.2645833 mm), which is one CSS pixel at 100% zoom. The origin is the top-left corner of the page. The x axis grows to the right and the y axis grows down. Angles are in degrees, clockwise.

### 2.7 Colors

A color is a palette name, a hexadecimal color, or absent (no color).

| Kind | Values |
|---|---|
| Pen names | `ink`, `indigo`, `brick`, `fern`, `plum`, `amber`, `walnut` |
| Highlighter names | `honey`, `mint`, `rose`, `apricot`, `lilac` |
| Hexadecimal | `#rrggbb`, lowercase. Where alpha is allowed, `#rrggbbaa` |

The app maps a palette name to its light or dark value from its design tokens, so colors follow the theme. Readers must keep unknown palette names from newer versions and show them in a neutral color.

### 2.8 Order keys

Ordered items (section groups, sections, pages, and blocks) carry an order key. A key is a string of 1 to 256 characters from `0-9A-Za-z`. Items sort by comparing keys byte by byte, then by ID when keys are equal.

Readers only compare keys. Writers may use any method that makes a key strictly between two neighbors. OpenNote uses the base-62 variant of the fractional-indexing algorithm that Rocicorp published under the Creative Commons Zero (CC0) license. When any key in a list of siblings grows past 64 characters, writers should give that list new, evenly spaced keys.

Writers write sorted arrays in key order, then ID order. A reader that ignores keys still sees the right order.

### 2.9 Unknown data

Readers must preserve unknown keys in every object this specification defines, and writers must write them back. Unknown enum values are kept, and shown with a neutral default, such as plain paper or a pen. Section 6.5 covers unknown block types, and section 9.6 covers unknown binary records.

### 2.10 Paths

JSON files never store paths. The one exception is an asset's file name (section 10.1), which readers check against a strict pattern. Readers build every path from IDs and checked names. They must never follow symbolic links or junctions inside a notebook, and must never read or write outside the notebook folder.

## 3. Notebook layout

### 3.1 The folder tree

```text
Biology/                                   notebook folder, named by the person
  notebook.json                            notebook settings and section groups
  README.md                                what this folder is, for people without OpenNote
  index.md                                 readable table of contents (derived)
  .opennote/
    FORMAT.md                              a copy of this specification
    trash/
      01m3sd8rc0w1pt611mq42a0rx1/          one Trash item
        item.json                          what was deleted, where from, and until when
        01m3saznsm2jxj28tzqrqhddv4/        the deleted page folder, moved here unchanged
    conflicts/                             sync-tool copies of tree files, kept 30 days
    lock                                   writer lock, only on network drives
  01m3s9v8ym7yt5c8yb61tthbwt/              a section, named by its ID
    section.json                           section settings and its page list
    01m3sa12426sg32pmtyffjaqcf/            a page, named by its ID
      page.json                            the page: the source of truth
      page.md                              readable copy (derived)
      ink.svg                              picture of the handwriting (derived)
      ink/
        01m3sa81n2n6c32zjexe5yq0r5.onk     ink segment (immutable)
      assets/
        01m3sa43z1tp9rdr5e8df2jbxy-leaf-section.png    image, PDF, audio, or attachment (immutable)
      .history/
        versions.json                      list of saved versions (can be rebuilt)
        01m3sa6634zkpfshkpzzrzbmav.json.gz a saved version
      .conflicts/                          other versions waiting for review (rare)
      .damaged/                            files that failed to read, moved aside (rare)
```

Section groups are not folders. They exist only in `notebook.json` (section 4.3), so the depth of the tree on disk never changes.

### 3.2 What each file is

| File | Kind | Section |
|---|---|---|
| `notebook.json` | Notebook identity, settings, and section groups | 4.1 |
| `section.json` | Section settings and its ordered page list | 4.2 |
| `page.json` | One page. The source of truth for the page | 5 |
| `ink/<ID>.onk` | Ink segment: pen strokes in a compact binary form | 9 |
| `assets/<ID>...` | Images, PDFs, audio, and attachments | 10 |
| `page.md`, `ink.svg`, `index.md`, `README.md`, `.opennote/FORMAT.md` | Readable copies, derived from the files above | 11 |
| `.opennote/trash/` | Deleted pages, sections, and section groups | 12 |
| `.history/` | Saved versions of a page | 13 |
| `.conflicts/`, `.opennote/conflicts/` | Versions kept after a conflict | 14 |
| `.damaged/` | Files moved aside because they failed to read | 16 |
| `.opennote/lock` | Writer lock for notebooks on network drives | 20.3 |

A folder's kind comes from the file inside it, never from its name. A folder inside the notebook folder with a `section.json` is a section. A folder inside a section folder with a `page.json` is a page.

### 3.3 Folder and file names

Section and page folders are named with their IDs. Only the notebook folder has a name that a person chose.

This choice makes renaming a page or section an edit of one JSON file. On Windows, renaming a folder fails whenever any file inside it is open, and antivirus scanners, the search indexer, and sync clients open files constantly. ID names also rule out illegal characters, reserved names, case clashes, and differences in Unicode normalization between platforms. People can still browse the notebook through `page.md`, `index.md`, and `README.md` (section 11).

If a person renames an ID folder by hand, nothing breaks. Identity comes from the ID inside the JSON file. The scan in section 18.3 finds the folder by that ID, and writers keep using it where it is.

Other naming rules:

- OpenNote's own file names are lowercase ASCII. Readers look up the exact name first and then a case-insensitive match, because a tool might have changed the case.
- Temporary files are named `~<target name>.<8 lowercase hex digits>.tmp` and sit in the same folder as their target. Several sync tools skip names of this form.
- Writers must never set the hidden attribute on `.opennote` or any other folder, because some backup tools skip hidden folders.
- Unknown files and folders are left alone. Writers never change or delete them, except as section 19 lists.

### 3.4 The notebook folder name

When a writer creates a notebook folder from a title, or names an exported file, it turns the title into a safe name with these steps:

1. Normalize to Unicode Normalization Form C (NFC).
2. Replace control characters (`U+0000` to `U+001F` and `U+007F` to `U+009F`) with a space. Replace `/`, `\`, `|`, and `:` with `-`. Remove `<`, `>`, `"`, `?`, and `*`. Remove the invisible format characters `U+200B` to `U+200F`, `U+202A` to `U+202E`, `U+2060` to `U+2069`, and `U+FEFF`. Then normalize to NFC again, because a removed character can let its neighbors combine.
3. Collapse each run of whitespace into one space.
4. Trim spaces at both ends, remove leading `.` and `~` characters, and remove trailing `.` characters and spaces. Repeat this step until nothing changes.
5. If the result is empty, use `Untitled`.
6. Truncate to 64 UTF-16 code units at a character boundary, then repeat step 4.
7. If the part before the first `.`, compared without case, is a reserved Windows name, insert `_` right after that part. The reserved names are `CON`, `PRN`, `AUX`, `NUL`, `CONIN$`, `CONOUT$`, `COM0` to `COM9`, `LPT0` to `LPT9`, and `COM` or `LPT` followed by a superscript 1, 2, or 3. Also append `_` to `desktop.ini`, and replace each `_vti_` with `_vti-` until none is left. If the name is now longer than 64 units, truncate it again as in step 6.
8. Compare the name, after NFC and lowercasing, with every entry in the parent folder. If it is taken, append ` (2)`, ` (3)`, and so on, shortening the base so the whole stays within 64 units.
9. Create the folder with "fail if it exists". If the file system still reports a clash, go back to step 8 with the next number. The file system has the final word.

Writers apply these rules on every platform, so a notebook made on Linux still works on Windows.

### 3.5 Path length

The deepest path a writer creates is an asset of a page inside a section in Trash. It is about 165 characters longer than the notebook folder's path. OpenNote warns when a notebook folder's full path is longer than 90 characters. That keeps every path under the classic 260-character limit of Windows, so Explorer, sync clients, and zip tools can open every file. OpenNote itself uses long paths (the `\\?\` prefix on Windows), so a longer root still works inside the app.

### 3.6 What lives where

| Data | Where | Travels with the notebook |
|---|---|---|
| Notebook content, Trash, page history, and conflicts | The notebook folder | Yes |
| Journal, locks, per-device view state, caches, and migration backups | Device-local data (section 20) | No |

Per-device view state, such as scroll position, zoom, the last open page, and collapsed items, never goes into the notebook. It differs between devices and changes constantly, so it would cause needless sync traffic and conflicts.

## 4. Tree files

### 4.1 notebook.json

```json
{
  "formatVersion": 1,
  "minReaderVersion": 1,
  "kind": "opennote.notebook",
  "id": "01m3s9q9xbpmxwz4cz4ht6twg9",
  "title": "Biology",
  "color": "fern",
  "created": "2026-09-30T13:58:02.411Z",
  "changed": "2026-09-30T13:59:10.000Z",
  "defaults": {
    "view": {
      "mode": "paginated",
      "paper": {
        "size": "a4",
        "width": 793.7,
        "height": 1122.52
      },
      "background": {
        "pattern": "ruled"
      }
    }
  },
  "groups": [
    {
      "id": "01m3s9sbxgnp9pzjzdccftczg5",
      "title": "Semester 1",
      "order": "a0",
      "created": "2026-09-30T13:59:10.000Z",
      "changed": "2026-09-30T13:59:10.000Z"
    }
  ]
}
```

| Field | Type | Default | Meaning |
|---|---|---|---|
| `formatVersion` | integer | required | The format version the writer used (section 15) |
| `minReaderVersion` | integer | required | The oldest reader version that can show this file (section 15) |
| `kind` | string | required | Always `"opennote.notebook"` |
| `id` | ID | required | The notebook's identity. Links between notebooks use it |
| `title` | string | required | Display name. It can differ from the folder name |
| `color` | color | none | Section 2.7 |
| `created` | timestamp | required | When the notebook was made |
| `changed` | timestamp | required | When a field of this file last changed. Used only to merge sync copies (section 14.3) |
| `defaults` | object | none | Defaults for new pages. Only `view` (section 5.4) is defined in version 1 |
| `groups` | array | `[]` | Section groups (section 4.3) |
| `styles` | object | none | Reserved for how this notebook shows each named style (section 5.6) |

The list of sections is not stored here. Each section records its own group and order in its own `section.json`. Creating a section on one device and reordering sections on another then change different files.

### 4.2 section.json

```json
{
  "formatVersion": 1,
  "minReaderVersion": 1,
  "kind": "opennote.section",
  "id": "01m3s9v8ym7yt5c8yb61tthbwt",
  "title": "Lab reports",
  "color": "indigo",
  "group": "01m3s9sbxgnp9pzjzdccftczg5",
  "order": "a1",
  "created": "2026-09-30T14:00:12.500Z",
  "changed": "2026-09-30T14:20:05.300Z",
  "pages": [
    {
      "id": "01m3sa12426sg32pmtyffjaqcf",
      "title": "Photosynthesis",
      "order": "a0",
      "pinned": true,
      "changed": "2026-09-30T14:07:40.520Z"
    },
    {
      "id": "01m3saznsm2jxj28tzqrqhddv4",
      "title": "Light reactions",
      "parent": "01m3sa12426sg32pmtyffjaqcf",
      "order": "a0",
      "changed": "2026-09-30T14:20:05.300Z"
    }
  ]
}
```

| Field | Type | Default | Meaning |
|---|---|---|---|
| `formatVersion`, `minReaderVersion`, `kind` | | required | As in `notebook.json`. `kind` is `"opennote.section"` |
| `id` | ID | required | The section's identity. It matches the folder name |
| `title` | string | required | Display name |
| `color` | color | none | Section 2.7 |
| `group` | ID | none | The section group that holds this section. Absent means the top level |
| `order` | order key | required | Position among its siblings |
| `created`, `changed` | timestamp | required | As in `notebook.json` |
| `defaults` | object | none | Defaults for new pages in this section. They override the notebook's defaults |
| `encryption` | object | none | Reserved for password-protected sections. A version 1 reader that finds this key treats the section as unreadable, never as writable |
| `pages` | array | `[]` | The page list, in order (below) |

Each page entry:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | ID | required | The page's ID, which is also its folder name |
| `title` | string | required | A copy of the page's title, so the navigation tree opens without reading every `page.json`. The title in `page.json` wins when they differ, and writers repair the copy when they notice |
| `parent` | ID | none | Makes this page a subpage of another page in the same section (section 4.4) |
| `order` | order key | required | Position among pages with the same parent |
| `pinned` | boolean | `false` | Pinned in the navigation tree |
| `color` | color | none | Color chip in the navigation tree |
| `changed` | timestamp | required | When a field of this entry last changed. Used only to merge sync copies |
| `moving` | object | none | Present while the page folder is still on its way here: `{"from": <section ID>}` for a move between sections (section 18.2), or `{"fromTrash": <Trash item ID>}` for a restore (section 12.3) |

The page's modified time is not stored here. Writers keep it in a device-local cache for sorting (section 20.1), so a save never has to rewrite `section.json`.

### 4.3 Section groups

A section group has `id`, `title`, `color`, `parent` (another group, or absent for the top level), `order`, `created`, and `changed`. Groups play the part of nested folders in the navigation tree, and nest at most 4 levels deep. A section joins a group through its own `group` field, so moving a section between groups changes only that section's `section.json`.

### 4.4 Subpages

A page entry with `parent` is a subpage. Its parent must be a page in the same section. The chain of parents is at most 2 long, so a tree shows at most a page, a subpage, and a sub-subpage, as OneNote does. A page whose parent is missing is shown at the top level.

A page's level is the length of its chain of parents: 0 for a page, 1 for a subpage, and 2 for a sub-subpage. The navigation tree lists each page's subpages right after it, sorted by order key, then by ID. That flat list with levels, as OneNote shows it, maps one to one onto the parents. A page deeper than level 2 is shown at level 2. When parents form a loop, the page in the loop that sorts first is shown at the top level.

Moving a parent page moves its subpages with it. Deleting a parent page puts it and its subpages into one Trash item, and restoring brings them back together.

### 4.5 Defaults for new pages

When a writer creates a page, it copies a `view` object into the new `page.json`. It takes the section's `defaults.view`, then the notebook's `defaults.view`, then the app's defaults, field by field. The app defaults are a freeform layout, infinite mode, plain paper, and Letter paper in the United States and Canada or A4 elsewhere.

Pages do not follow later changes to these defaults. Each `page.json` is complete on its own, so any reader can show a page without reading the files around it.

## 5. Pages

### 5.1 The page folder

A page folder holds `page.json` and, when needed, `page.md`, `ink.svg`, `ink/`, `assets/`, `.history/`, `.conflicts/`, and `.damaged/`. Writers create the subfolders only when they first need them.

`page.json` is the source of truth. It lists every ink segment and asset that belongs to the page. Every other file in the folder is either immutable and listed there, derived from it, or kept for history and conflicts.

### 5.2 The page.json fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `formatVersion` | integer | required | The format version the writer used |
| `minReaderVersion` | integer | required | The oldest reader version that can show this page |
| `kind` | string | required | Always `"opennote.page"` |
| `id` | ID | required | The page's identity. It matches the folder name |
| `title` | string | required | Plain text, not Markdown, at most 1,000 characters. It may be empty |
| `created` | timestamp | required | When the page was made. For imported pages, when the source was made |
| `modified` | timestamp | required | The last change to the content, not the time of the last save |
| `tags` | array of strings | `[]` | Tags. A `/` nests them, as in `exam/unit-3`. Stored as typed |
| `view` | object | required | Layout, paper, and background (section 5.4) |
| `blocks` | array | `[]` | The page's blocks, sorted by order key (section 6) |
| `assets` | object | `{}` | The asset table, keyed by asset ID (section 10.2) |
| `ink` | object | none | The ink segment list (section 8.3) |
| `recordings` | array | `[]` | Reserved for audio recordings (section 5.6) |
| `encryption` | object | none | Reserved for pages in encrypted sections (section 5.7) |
| `revision` | object | required | This saved revision (section 5.3). Always the last known key |

Outgoing links are not stored separately. They live inside the Markdown of text blocks, so they can never disagree with the text.

### 5.3 The revision object

```json
"revision": {
  "id": "01m3sa8yf8bryf28a7sjgb7mmc",
  "parents": ["01m3sa81nc71kgdfrzdejhbngd"],
  "ancestors": ["01m3sa81nc71kgdfrzdejhbngd", "01m3sa6634zkpfshkpzzrzbmav"],
  "savedAt": "2026-09-30T14:07:40.520Z",
  "device": {
    "id": "01m1e34qm04rx4vfj1927vgwgm",
    "label": "Windows device GWGM"
  },
  "writer": "OpenNote 0.4.0 (windows)"
}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | ID | New on every save |
| `parents` | array of IDs | The revision this one was made from. Empty for a page's first revision. A later version may list two parents after a merge |
| `ancestors` | array of IDs | Up to 32 earlier revisions, newest first, including the parents |
| `savedAt` | timestamp | When this revision was written |
| `device` | object | The device that wrote it: its ID and a label |
| `writer` | string | The app and version that wrote it |

The `ancestors` list lets a reader tell, in one step, whether another copy of a page is simply an older version of this one or a real divergence (section 14.1).

The device label is chosen by the person. Its default is the platform name and the last 4 characters of the device ID, such as `Windows device GWGM`. Writers must never use the computer name or the account name as a default, because page files travel through sync tools and shared folders.

### 5.4 View settings

```json
"view": {
  "layout": "flow",
  "mode": "paginated",
  "paper": {
    "size": "a4",
    "orientation": "landscape",
    "width": 1122.52,
    "height": 793.7,
    "margins": [48, 48, 48, 48]
  },
  "background": {
    "pattern": "ruled",
    "spacing": 32.88,
    "color": "indigo",
    "marginLine": true
  }
}
```

Fields that equal their defaults are left out, as section 2.2 requires, so this example lists only values that differ from them.

| Field | Default | Values and meaning |
|---|---|---|
| `layout` | `"freeform"` | `freeform` places new blocks anywhere, as OneNote does. `flow` stacks new blocks like a document |
| `mode` | `"infinite"` | `infinite` or `paginated`. Switching mode never changes block coordinates |
| `paper.size` | `"letter"` | `a4`, `a5`, `letter`, `legal`, `tabloid`, or `custom`. A label for the interface |
| `paper.orientation` | `"portrait"` | `portrait` or `landscape`. A label for the interface |
| `paper.width`, `paper.height` | Letter | The paper size in page units, as oriented. These two values are the truth |
| `paper.margins` | `[72, 72, 72, 72]` | Top, right, bottom, and left margins in page units |
| `background.pattern` | `"plain"` | `plain`, `ruled`, `grid`, `dots`, `isometric`, `cornell`, `staff`, or `template` |
| `background.spacing` | 26.46 | Line or grid spacing in page units |
| `background.color` | `"rule"` | `rule` (the theme's rule color), a palette name, or a hexadecimal color |
| `background.marginLine` | `false` | Draws a margin line on ruled paper |
| `background.template` | none | The ID of a saved template, for the `template` pattern |
| `contentWidth` | none | On flow pages, the width of the text column. Absent means the reading width |
| `readingOrder` | `[]` | Block IDs in the order screen readers, `page.md`, and the reading view read them (section 6.2). Absent means the default order |

Portrait paper sizes in page units:

| Size | Width | Height |
|---|---|---|
| A4 | 793.7 | 1122.52 |
| A5 | 559.37 | 793.7 |
| Letter | 816 | 1056 |
| Legal | 816 | 1344 |
| Tabloid | 1056 | 1632 |

Common spacings are 22.68 (6 mm narrow ruling), 26.46 (7 mm college ruling), 32.88 (8.7 mm wide ruling), 18.9 (5 mm grid), 24 (1/4 inch grid), and 37.8 (1 cm grid).

In paginated mode, sheet `k` shows the content from `y = k × paper.height` to `y = (k + 1) × paper.height`. Page breaks are part of the view, not gaps in the coordinates.

### 5.5 A complete page.json

```json
{
  "formatVersion": 1,
  "minReaderVersion": 1,
  "kind": "opennote.page",
  "id": "01m3sa12426sg32pmtyffjaqcf",
  "title": "Photosynthesis",
  "created": "2026-09-30T14:03:22.114Z",
  "modified": "2026-09-30T14:07:40.412Z",
  "tags": ["biology", "exam/unit-3"],
  "view": {
    "mode": "paginated",
    "paper": {
      "size": "a4",
      "width": 793.7,
      "height": 1122.52
    },
    "background": {
      "pattern": "ruled"
    }
  },
  "blocks": [
    {
      "id": "01m3sa14y9zszek1wdk3snddsn",
      "type": "text",
      "order": "a0",
      "frame": {
        "x": 96,
        "y": 120,
        "w": 624
      },
      "created": "2026-09-30T14:03:25.001Z",
      "modified": "2026-09-30T14:05:40.020Z",
      "data": {
        "markdown": "## Light reactions\n\nThe **thylakoid** membrane holds ==chlorophyll a== and splits water into O<sub>2</sub>.\n\n> [!tip] Exam hint\n> Learn the Z-scheme diagram.\n\n- [x] Read chapter 8\n- [ ] Lab write-up"
      }
    },
    {
      "id": "01m3sa43z6vy2m3w1j4qw8y09j",
      "type": "image",
      "order": "a1",
      "frame": {
        "x": 760,
        "y": 140,
        "w": 320,
        "h": 240
      },
      "lock": "position",
      "created": "2026-09-30T14:05:02.310Z",
      "modified": "2026-09-30T14:05:02.310Z",
      "data": {
        "asset": "01m3sa43z1tp9rdr5e8df2jbxy",
        "alt": "Cross-section of a leaf"
      }
    },
    {
      "id": "01m3sa1242ayy4avvsz3yx5gxj",
      "type": "ink",
      "order": "a2",
      "frame": {
        "x": 0,
        "y": 0
      },
      "created": "2026-09-30T14:03:22.114Z",
      "modified": "2026-09-30T14:07:40.412Z",
      "data": {
        "role": "layer",
        "strokeCount": 215
      }
    },
    {
      "id": "01m3sa5x98mzky5xcv2a5xp2n6",
      "type": "ext:org.example/kanban",
      "order": "a3",
      "frame": {
        "x": 96,
        "y": 900,
        "w": 600,
        "h": 300
      },
      "created": "2026-09-30T14:06:01.000Z",
      "modified": "2026-09-30T14:06:30.000Z",
      "data": {
        "cards": 7,
        "columns": ["To do", "Done"]
      },
      "fallback": {
        "markdown": "**Kanban board**: 2 columns, 7 cards"
      }
    }
  ],
  "assets": {
    "01m3sa43z1tp9rdr5e8df2jbxy": {
      "file": "01m3sa43z1tp9rdr5e8df2jbxy-leaf-section.png",
      "mime": "image/png",
      "bytes": 482113,
      "sha256": "5f2b8e1c9d7a4b3e6f0a1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f",
      "name": "Leaf section.png",
      "width": 1600,
      "height": 1200,
      "created": "2026-09-30T14:05:02.305Z"
    }
  },
  "ink": {
    "segments": [
      {
        "id": "01m3sa81n2n6c32zjexe5yq0r5",
        "bytes": 151822,
        "records": 214,
        "crc32": "9a3b1c2d"
      },
      {
        "id": "01m3sa8yempcnn2qgrtvppsafr",
        "bytes": 176,
        "records": 1,
        "crc32": "c445a2a0"
      }
    ]
  },
  "revision": {
    "id": "01m3sa8yf8bryf28a7sjgb7mmc",
    "parents": ["01m3sa81nc71kgdfrzdejhbngd"],
    "ancestors": ["01m3sa81nc71kgdfrzdejhbngd", "01m3sa6634zkpfshkpzzrzbmav"],
    "savedAt": "2026-09-30T14:07:40.520Z",
    "device": {
      "id": "01m1e34qm04rx4vfj1927vgwgm",
      "label": "Windows device GWGM"
    },
    "writer": "OpenNote 0.4.0 (windows)"
  }
}
```

The ink block comes after the text and image in order, so handwriting is drawn on top of them. The extension block shows how a newer or third-party block type carries a readable fallback (section 6.5). The second segment is the test vector in Appendix B. The asset hash and the first segment's size and checksum are illustrative.

### 5.6 Reserved for later versions

Version 1 writers never write these fields. Version 1 readers must keep them unchanged if they appear:

| Field | Where | Planned use |
|---|---|---|
| `recordings` | `page.json` | Audio recordings and their pauses (Phase 9) |
| `marks` | `data` of text blocks | Ranges in the Markdown linked to moments in a recording (Phase 9) |
| `parent` | Blocks | Blocks nested inside a group block |
| `styles` | `notebook.json` | Each notebook's font, size, color, and spacing for the named styles of section 6.6 |
| `encryption` | `section.json` and `page.json` | Password-protected sections (section 5.7) |

A later version defines each field and raises `formatVersion`. Every stroke already stores its start time and per-point times (section 9.4), so handwriting needs no new field to link to audio.

### 5.7 Encrypted sections

Password-protected sections arrive in a later version. Version 1 reserves their hooks now, so that no plain text of such a section can leak once they exist:

- The `encryption` key in `section.json` or `page.json` marks encrypted content. A version 1 reader shows the section or page as locked, and never writes into it.
- Writers write no `page.md` or `ink.svg` for a page in an encrypted section. They list only the section's title in `index.md`, and keep no history snapshot in plain text.
- Apps keep no plain text of an encrypted section in device-local data. That covers the search index, thumbnails, the page cache, and journal payloads, which set flag bit 0 (section 20.6).
- The section's own title, color, and place in the tree stay readable, so the navigation tree can show a locked section.

## 6. Blocks

### 6.1 Common block fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | ID | required | Unique within the page |
| `type` | string | required | The block type (sections 6.3 and 6.4) |
| `order` | order key | required | Position among the page's blocks. It sets the reading order of flowing blocks and the drawing order of floating blocks |
| `frame` | object | none | Position and size (section 6.2) |
| `lock` | string | none | `position` (cannot be moved or resized) or `all` (cannot be moved, resized, or edited) |
| `created` | timestamp | required | When the block was made |
| `modified` | timestamp | required | The last change to this block |
| `data` | object | required | Fields of the block type |
| `fallback` | object | none | A readable stand-in, required for types newer than version 1 (section 6.5) |

### 6.2 Layout: floating and flowing blocks

A frame has `x`, `y`, `w`, `h`, and `rotate`, all in page units except `rotate`, which is in degrees. Each is optional.

- A block whose frame has both `x` and `y` is **floating**. It sits at that position on the page. A missing `h` means "as tall as the content", which text boxes use. A missing `w` and `h` on an ink block means it has no bounds.
- A block without a frame, or whose frame has only `w` or `h`, is **flowing**. Flowing blocks stack from top to bottom in order, and `w` and `h` act as size hints.

On a `freeform` page, new blocks float. On a `flow` page, new blocks flow. Either kind can appear on either page. For example, a flow page can carry floating handwriting over its text.

Floating blocks are drawn above flowing blocks, in order, so a block later in order is drawn on top.

Reading order, used by screen readers, `page.md`, and the phone's reading view, is the flowing blocks in order, then the floating blocks by position, in rows:

1. Sort the floating blocks by `y`, then `x`, then order key and ID.
2. A row starts at the first block not yet in a row. It takes every later block whose `y` is at most 8 units below the `y` of the row's first block.
3. Each row reads from left to right: by `x`, then `y`, then order key and ID.

A page can set its own reading order with `view.readingOrder` (section 5.4), a list of block IDs. The listed blocks come first, in that order. The others follow in the order above, so a block that is not in the list yet reads after the listed ones. IDs that name no block are ignored, and repeated IDs count once. Writers drop both at the next save.

Writers keep the list in step with the blocks:

- A change that deletes a block removes its ID from the list in the same transaction, so undo brings both back.
- A change to the view is a JSON merge patch (Request for Comments (RFC) 7396). A list is one value, so a patch that names `readingOrder` replaces the whole list, and `null` removes it and restores the default order.
- When two edits of the same page change the list, the later one wins in full. A reader never combines the two lists.
- A new page made from the notebook's `defaults.view` starts without a list.

### 6.3 Block types in version 1

| Type | `data` fields | Meaning |
|---|---|---|
| `text` | `markdown`, `ids`, `tags`, `styles` | A text box. It holds one or more paragraphs, headings, lists, quotes, callouts, and code blocks in OpenNote Markdown (section 7). The other fields name its elements (section 6.6) |
| `ink` | `role`, `strokeCount`, `anchor`, `alt`, `decorative` | A place for strokes (section 8). `role` is `layer` for the page's handwriting layer, or `drawing` for a drawing area. `strokeCount` is a cached count of live strokes. `anchor` ties it to text (section 8.1) |
| `image` | `asset`, `alt`, `decorative`, `crop` | An image from the asset table. `crop` is `{x, y, w, h}` as fractions from 0 to 1, and defaults to the whole image |
| `file` | `asset`, `display`, `alt`, `decorative` | An attachment from the asset table, shown as an `icon` (the default) or a `preview` |
| `table` | `header`, `columns`, `rows` | A table (below) |

Section 6.7 describes `alt` and `decorative`.

A writer may split a long run of text into several text blocks at any paragraph boundary, or keep it in one. Both are valid, and readers must treat them the same way. Element IDs, tags, and styles move with their elements.

In a table block, `columns` is a list of `{id, width}` objects, and `rows` is a list of `{id, cells}` objects. Each row's `cells` maps a column ID to `{"markdown": string}`, where the Markdown holds inline content only, with hard breaks allowed. The `header` field is `true` when the first row is a header row, and defaults to `false`. Rows and columns have IDs so that a later merge can match them. Cells are keyed by column ID for the same reason.

```json
"data": {
  "header": true,
  "columns": [
    {
      "id": "01m3sabc31y0rfa24eeh6j4ky4",
      "width": 200
    },
    {
      "id": "01m3sabc32dwqknfawtgwtsgcj",
      "width": 280
    }
  ],
  "rows": [
    {
      "id": "01m3sabc336ewa9gjr9z4z3dpv",
      "cells": {
        "01m3sabc31y0rfa24eeh6j4ky4": {
          "markdown": "Stage"
        },
        "01m3sabc32dwqknfawtgwtsgcj": {
          "markdown": "Where it happens"
        }
      }
    }
  ]
}
```

### 6.4 Reserved and extension types

These type names are reserved for later versions: `chart`, `math`, `graph`, `embed`, `audio`, `pdf`, `card`, `break`, `shape`, and `group`. Nobody else may use them.

Plugins and other tools may add their own types, named `ext:<reverse domain name>/<name>`, such as `ext:org.example/kanban`. Extension types follow the same rules as types from newer versions.

### 6.5 Unknown types and fallbacks

Every block whose type is not part of version 1 must carry `fallback`: `{"markdown": string, "image": asset ID}`, where `image` is optional. The fallback is a readable version of the block. Older readers show it in the block's frame, and `page.md` uses it. Writers refresh the fallback whenever the block changes.

Readers must keep an unknown block's JSON exactly and write it back unchanged. They show its fallback, or a placeholder that says the block needs a newer version of OpenNote. On a writable page, the block can be moved, reordered, and deleted, but not edited.

A block of a known type whose `data` is invalid, such as a negative width or a missing asset ID, is kept the same way as an unreadable block. The reader shows a placeholder and reports the problem. It never drops the block.

### 6.6 Text elements

The paragraphs, headings, and list items inside a text block are its elements. An element can have a stable ID, so that a link, a tag, a style, or handwriting can point at one paragraph. The paragraph keeps that ID while the text around it changes, and a restore from history can find it again.

A text block's elements are its headings, paragraphs, list items, code blocks, math blocks, and thematic breaks, at any depth, in document order. A list item's first paragraph belongs to the item and is not an element of its own. Block quotes and callouts are not elements, but the blocks inside them are.

| Field of `data` | Default | Meaning |
|---|---|---|
| `ids` | `[]` | Element IDs, one for each element, in document order |
| `tags` | `{}` | Tags of single elements: an object that maps an element ID to an array of tags, written like page tags |
| `styles` | `{}` | Named styles: an object that maps an element ID to a style name |
| `checked` | `[]` | Element IDs whose to-do tag is checked off, in ID order |

Element IDs share the page's ID space with block IDs. When `ids` lists fewer IDs than the block has elements, the last elements have no ID yet, and writers add IDs for them. When it lists more, readers ignore the extra IDs, and writers drop them. A tool that edits the Markdown but can't track elements leaves `ids` alone, and IDs then match elements in order. Keys of `tags` and `styles` that are not in `ids` are ignored.

A style name refers to a named style of the app, such as `title`, `subtitle`, `quote`, `citation`, or `code`, instead of formatting stored in the Markdown. Readers show an element with an unknown style as plain text. Named styles keep the Markdown and `page.md` clean, because neither carries styles. A later version lets each notebook change how a style looks.

### 6.7 Descriptions for screen readers

Images, drawings, and embedded files carry a description for screen readers and exports:

| Field of `data` | Default | Meaning |
|---|---|---|
| `alt` | `""` | A short description of the picture, drawing, or file |
| `decorative` | `false` | The block only decorates the page. Screen readers skip it, and `page.md` gives it an empty description |

The fields apply to `image` blocks, `ink` blocks whose role is `drawing`, and `file` blocks. Later types that show pictures, such as `chart`, `embed`, and `pdf`, use the same two fields. The app's accessibility checks point out a picture that has neither a description nor the `decorative` flag.

## 7. OpenNote Markdown

### 7.1 Base

Text blocks and table cells store OpenNote Markdown 1: CommonMark 0.31.2 with two extensions from GitHub Flavored Markdown (GFM), task list items and strikethrough with `~~`, plus the additions in this section.

Readers must parse the whole CommonMark syntax, because text can come from hand edits and imports. Writers must write only the canonical form described here, so that saving, reloading, and undo give identical text. The editor in the app's interface serializes and parses this dialect. The Rust core stores `markdown` as an opaque string, except for escaping text it generates (section 7.6) and rewriting links in `page.md` (section 11.1).

### 7.2 Block syntax

| Element | Canonical syntax |
|---|---|
| Paragraph | Lines of text. A hard line break is a `\` at the end of a line |
| Heading, levels 1 to 6 | `#` to `######`, one space, then the text. No closing `#` characters |
| Bullet list item | `- ` before the item |
| Numbered list item | `1. ` before the first item, using the list's start number, then counting up by 1 |
| Task list item | `- [ ] ` or `- [x] `, with a lowercase `x` |
| Nested blocks in an item | Indented to the first character after the item's marker |
| Block quote | `> ` before every line, and `>` alone on a blank line inside the quote |
| Callout | A block quote whose first line is `> [!type]`, then optionally `-` (folded) or `+` (open), then optionally a space and a title |
| Code block | Fenced with backticks. The info string is the language: up to 32 characters from `A-Za-z0-9_+#.-` |
| Thematic break | `---` |
| Display math (reserved for Phase 10) | `$$` on its own lines around the math |

Callout types are `note`, `tip`, `important`, `warning`, `caution`, `info`, `question`, `success`, `danger`, `example`, and `quote`. Readers keep unknown types and show them as `note`.

Writers never write setext headings, indented code blocks, raw HTML blocks, link reference definitions, footnotes, or GFM tables. Tables are `table` blocks.

### 7.3 Inline syntax

| Formatting | Canonical syntax |
|---|---|
| Emphasis | `*text*` |
| Strong emphasis | `**text**` |
| Strikethrough | `~~text~~` |
| Code | A backtick code span (section 7.7) |
| Link | `[text](destination)` (section 7.5) |
| Image from the page's assets | `![alt text](asset:<asset ID>)` |
| Highlight in the default color, Honey | `==text==` |
| Inline math (reserved for Phase 10) | `$math$`, with the opening `$` followed by a non-space and the closing `$` preceded by a non-space |
| Underline, subscript, superscript, colors, and sizes | The HTML tags in section 7.4 |

A `==` opens a highlight when the next character is not whitespace, and closes one when the previous character is not whitespace.

### 7.4 Allowed HTML

Only these exact tags have meaning. Attribute values come from fixed lists, so they never need escaping.

| Opening tag | Closing tag | Meaning |
|---|---|---|
| `<u>` | `</u>` | Underline |
| `<sub>` | `</sub>` | Subscript |
| `<sup>` | `</sup>` | Superscript |
| `<mark data-color="NAME">` | `</mark>` | Highlight in a highlighter color other than Honey: `mint`, `rose`, `apricot`, or `lilac` |
| `<span data-color="COLOR">` | `</span>` | Text color: a pen name or `#rrggbb` |
| `<span data-size="SIZE">` | `</span>` | Text size: `small`, `large`, or `xlarge` |
| `<em>`, `<strong>`, `<del>`, `<mark>` | `</em>`, `</strong>`, `</del>`, `</mark>` | The same as `*`, `**`, `~~`, and `==`. Writers use these forms only where delimiters would not work (section 7.7) |

Tags must nest properly and close within the same paragraph, heading, or cell. Readers must treat any other raw HTML as plain text, and writers then escape its `<`.

Other Markdown tools show these tags as intended where they render HTML. Where they do not, the text inside stays readable.

### 7.5 Links

| Destination | Target |
|---|---|
| `opennote:page/<page ID>` | A page, in any section or notebook |
| `opennote:page/<page ID>#<ID>` | A block on a page, or a text element in one of its text blocks (section 6.6) |
| `opennote:section/<section ID>` | A section |
| `opennote:notebook/<notebook ID>` | A notebook |
| `asset:<asset ID>` | A file in the page's asset table, used by inline images |
| `https:`, `http:`, and `mailto:` URLs | The web and email |

Links use IDs, so they keep working when pages are renamed or moved. The link text of a page link is the target's title when the link was made. The interface shows the current title, and a later phase updates the stored text on rename.

Readers must keep links with any other scheme, must never open them, and should show them as plain text. Anything after the ID in a fragment is reserved.

A destination is written bare when it has no spaces, parentheses, `<`, `>`, `\`, or control characters. Otherwise it is written between `<` and `>`, with `<`, `>`, and `\` escaped by a backslash.

### 7.6 Escaping

Writers escape text with a backslash exactly as this table says, and nowhere else. The rules also cover syntax that later phases will add, such as math and inline tags. Turning on a feature later can then never change the meaning of text that already exists.

The rules apply to text outside code spans, code blocks, link destinations, and allowed tags. A paragraph line is the first line of a paragraph, or a line after a hard break, including paragraphs inside lists and quotes. The start of a word is the start of the text or a position after whitespace. Letters and digits are the Unicode categories L and N.

| Character | Escaped when | Reason |
|---|---|---|
| `\` | Always | The escape character |
| `` ` `` | Always | Code spans and fences |
| `*` | Always | Emphasis, list items, and breaks |
| `_` | Unless the characters on both sides are letters or digits | Emphasis and breaks |
| `~` | Always | Strikethrough and fences |
| `=` | Next to another `=`, or first on a paragraph line | Highlights and setext headings |
| `$` | Always | Math, from Phase 10 |
| `[` and `]` | Always | Links, images, task items, callouts, and footnotes |
| `{` | Always | Attributes, reserved for later versions |
| `<` | Always | HTML and autolinks |
| `&` | When followed by an optional `#`, one or more ASCII letters or digits, and `;` | Character references |
| `\|` | Always | Tables in other Markdown tools |
| `#` | At the start of a word | Headings, and inline tags from Phase 8 |
| `>` | First on a paragraph line | Block quotes |
| `-` and `+` | First on a paragraph line | Lists, breaks, and setext headings |
| `.` and `)` | After 1 to 9 digits that begin a paragraph line | Numbered lists |

Two characters are written as numeric character references instead of escapes. A space that is first or last on a paragraph line is written `&#32;`, because CommonMark would drop it. A tab is always written `&#9;`.

Every other character is written as itself. Text never contains `U+000D`: a line break inside a paragraph is always a hard break. `U+0000` is replaced with `U+FFFD`, as CommonMark requires.

### 7.7 Canonical form

- Exactly one blank line separates blocks. There are no blank lines at the start, no trailing spaces on any line, and no newline at the end of the `markdown` string.
- A list is tight, with no blank lines between items, unless an item holds more than one block. Then one blank line separates its items.
- Marks nest in this order, outermost first: link, strong emphasis, emphasis, strikethrough, underline, highlight, text color, text size, subscript or superscript, and code. Where two ranges overlap, the mark that comes later in this order is closed and reopened.
- Whitespace at either edge of a marked range is moved outside the delimiters.
- Where a delimiter (`*`, `**`, `~~`, or `==`) would not open or close under CommonMark's rules for that position, the writer uses the matching HTML tag from section 7.4 for that range.
- A code span uses the smallest number of backticks that does not appear as a run of exactly that length in its content. It adds one space inside each end when the content starts or ends with a backtick, or starts and ends with a space without being all spaces.
- A code fence is 3 backticks, or 1 more than the longest run of backticks that starts any line of its content after up to 3 spaces, whichever is more. The closing fence matches the opening fence.
- Text is stored as typed, without Unicode normalization. Clients running JavaScript replace lone surrogates with `U+FFFD` before sending text to the core.

### 7.8 Conformance fixtures

`docs/format/fixtures/markdown/` holds two sets of shared test files:

| Set | Contents | Used by |
|---|---|---|
| `escape/` | Pairs of plain text and its escaped form | The Rust escaping function, the TypeScript serializer, and the Python reference reader |
| `documents/` | Canonical Markdown paired with a neutral document tree, which that folder's README defines | The serializer and parser in the interface |

Every implementation must pass both sets. For any document `d`, `parse(serialize(d))` equals `d`. For any canonical string `m`, `serialize(parse(m))` equals `m`.

## 8. Ink

### 8.1 Ink blocks

Every stroke belongs to exactly one ink block.

- A freeform page has one floating ink block with `role` set to `layer`, at `x = 0` and `y = 0`, with no size. It holds free handwriting anywhere on the page.
- A drawing area in a document is a flowing ink block with `role` set to `drawing`, and a `w` and `h`.
- Handwriting over an image is an ink block floating above the image. The order of blocks decides what is drawn on top.

Stroke coordinates are relative to the ink block's origin. Moving a whole drawing therefore changes one frame, not thousands of strokes.

Handwriting can be anchored to text, so that a note in the margin follows its paragraph. The ink block's `data` then holds an `anchor` object. Its `block` field is the ID of a text block or of one of its elements (section 6.6). Its `offset` field counts the Unicode code points of that element's displayed text before the anchored character.

- The frame's `x` and `y` keep the handwriting's position from the last layout.
- When the text reflows, an app that lays out text moves the ink block so that it keeps its distance from the anchored character. It writes the new `x` and `y` at the next save. The stroke points never change.
- A reader that doesn't lay out text uses the frame as it is. So does every reader when the anchor names nothing on the page.

### 8.2 Strokes

A stroke stores its raw input: position, pressure, tilt, and time for every point. Once a stroke is finished, its points never change. Moving, scaling, or rotating a stroke sets its affine transform, and recoloring it sets its style. Rendering can improve later without changing the data, as the development plan requires.

A stroke's style has four parts:

| Part | Meaning |
|---|---|
| Tool | Pen, pencil, highlighter, marker, or brush |
| Palette slot | Which brand pen or highlighter it was drawn with, or custom |
| Color | Red, green, blue, and alpha in sRGB, as the light-theme value |
| Width | The nominal diameter in page units |

The palette slot is the pen name that [BRAND.md section 4](../../BRAND.md#4-color) asks notes to store. It lets the app draw each brand pen with its dark value in the dark theme. The stored color stays the authority for printing, export, and other readers.

Strokes in one ink block are drawn in order of their start time, then their ID. This needs no stored order, never conflicts in a merge, and puts a restored stroke back at its original depth. Highlighter strokes are drawn below the other strokes of their block.

A partial erase removes the stroke and adds one or two new strokes with slices of its points. The new strokes get new IDs, keep their original times, and record the erased stroke's ID as their origin.

Imported ink without times sets the "start time unknown" flag (section 9.3).

### 8.3 The segment list

`page.json` lists the ink segments of the page in order:

```json
"ink": {
  "segments": [
    {
      "id": "01m3sa81n2n6c32zjexe5yq0r5",
      "bytes": 151822,
      "records": 214,
      "crc32": "9a3b1c2d"
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `id` | The segment's ID. Its file is `ink/<id>.onk`. Paths are never stored |
| `bytes` | The file's size |
| `records` | The number of records in the file |
| `crc32` | The CRC-32 in the file's footer (section 9.1) |

A reader applies the records of every segment, in list order and then in record order:

- A `Stroke` record adds the stroke with its ID, or fully replaces a stroke with the same ID.
- A `StrokeProps` record changes some properties of a stroke.
- A `Remove` record deletes the stroke with its ID.

A `StrokeProps` or `Remove` record for a stroke that does not exist is ignored, and the reader reports a warning.

The strokes left at the end are the page's live strokes. Each ink block's `strokeCount` must equal the number of its live strokes. A mismatch is a warning, and writers correct it at the next save.

### 8.4 Compaction

How a writer groups records into segments is writer policy, not format. Readers must accept any valid segment list. OpenNote's policy keeps saves small and lets page history share ink:

- A save writes one new, small segment with only the records since the last save.
- Minor compaction runs when a page has more than 8 segments. It merges every segment except the largest one, the base, into one segment that holds their net effect. A stroke added and removed within them disappears, removals of base strokes stay as `Remove` records, and property changes fold into one record per stroke. The base is untouched, so older versions keep sharing it.
- Major compaction runs when dead bytes (base strokes that were removed or replaced) exceed half of the page's ink bytes, or when more than 16 segments remain. It writes a new base with only the live strokes, sorted by ink block, start time, and ID.

Old segments stay while any saved version still refers to them. The ink of a page on disk therefore stays below about twice its live ink, plus old bases that history still uses.

## 9. Ink segment files

### 9.1 File layout

A segment file has a 64-byte header, then its records, then an 8-byte footer. A segment is immutable once written.

| Offset | Size | Field |
|---|---|---|
| 0 | 8 | Magic `89 4F 4E 4B 0D 0A 1A 0A`. As in PNG, these bytes reveal damage from text-mode transfers |
| 8 | 2 | Segment version, `1` |
| 10 | 2 | Flags, `0`. Bit 0 is reserved for a compressed body |
| 12 | 4 | Record count |
| 16 | 16 | Segment ID. It must match the file name and the `page.json` entry |
| 32 | 16 | Page ID |
| 48 | 8 | When the segment was written, in Unix milliseconds (`i64`) |
| 56 | 4 | Reserved, zero |
| 60 | 4 | CRC-32 of bytes 0 to 59 |
| 64 | ... | Records |
| end − 8 | 4 | CRC-32 of every byte before this field |
| end − 4 | 4 | Footer magic `4F 4E 4B 45` (`ONKE`) |

### 9.2 Records

Every record has the same frame, so a reader can skip records it does not understand:

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | CRC-32 of the rest of the record: bytes 4 to 12 + body length − 1 |
| 4 | 1 | Kind: 1 `Stroke`, 2 `StrokeProps`, 3 `Remove`. Kind 4 is reserved for shapes |
| 5 | 1 | Flags, `0` |
| 6 | 2 | Reserved, zero |
| 8 | 4 | Body length in bytes |
| 12 | ... | Body |

A record is 12 bytes plus its body. Each record carries its own CRC-32, so damage to one record costs one stroke, not the whole segment.

### 9.3 The stroke record

The body of a `Stroke` record has 72 fixed bytes, then optional fields, then the point data:

| Offset | Size | Field |
|---|---|---|
| 0 | 16 | Stroke ID |
| 16 | 16 | Ink block ID |
| 32 | 8 | Start time, in Unix milliseconds (`i64`) |
| 40 | 1 | Tool: 0 pen, 1 pencil, 2 highlighter, 3 marker, 4 brush |
| 41 | 1 | Palette slot: 0 custom; 1 to 7 the pens Ink, Indigo, Brick, Fern, Plum, Amber, and Walnut; 32 to 36 the highlighters Honey, Mint, Rose, Apricot, and Lilac |
| 42 | 2 | Stroke flags (below) |
| 44 | 4 | Color: red, green, blue, and alpha bytes, in sRGB with straight alpha |
| 48 | 4 | Width in page units (`f32`) |
| 52 | 16 | Bounding box of the raw points: minimum x, minimum y, maximum x, and maximum y, each an `i32` in 1/64 page units |
| 68 | 4 | Point count, 1 to 200,000 (`u32`) |
| 72 | 24 | Transform, only if flag bit 3 is set: six `f32` values `a b c d e f` |
| next | 16 | Origin stroke ID, only if flag bit 4 is set |
| next | rest | Point data (section 9.4) |

| Stroke flag bit | Meaning |
|---|---|
| 0 | Pressure present |
| 1 | Tilt present |
| 2 | Per-point time present |
| 3 | Transform present |
| 4 | Origin present |
| 5 | Start time unknown (imported ink) |
| 6 to 15 | Zero in version 1. Bit 6 is reserved for barrel rotation |

The transform maps a raw point `(x, y)` to `(a·x + c·y + e, b·x + d·y + f)` in the ink block's coordinates. This is the convention of SVG and the HTML canvas.

Readers draw unknown tool values as a pen and treat unknown palette slots as custom colors. They keep the record's bytes unchanged either way.

### 9.4 Point data

Each point has up to 6 channels, always in this order. `x` and `y` are always present. The other channels are present only when their flag is set.

| Channel | Stored as | Unit and range |
|---|---|---|
| `x`, `y` | `i32` | 1/64 page unit: `round(v × 64)`. Absolute value at most 2^29 |
| `p`, pressure | `u16` | `round(pressure × 65535)`, for pressure from 0 to 1 |
| `tx`, `ty`, tilt | `i16` | 1/100 degree: `round(tilt × 100)`, from −9000 to 9000. Tilt follows the `tiltX` and `tiltY` of Pointer Events |
| `t`, time | `u32` | 100 microseconds after the stroke's start time |

Point 0 stores absolute values: `x`, `y`, `tx`, and `ty` as zigzag varints, and `p` and `t` as unsigned varints. For point 0, `t` is the part of the start time below one millisecond, from 0 to 9. Every later point stores the difference from the point before it: `dx`, `dy`, `dp`, `dtx`, and `dty` as zigzag varints, and `dt` as an unsigned varint, because time never goes backward.

- An unsigned varint is Little Endian Base 128 (LEB128): 7 bits per byte, the lowest group first, and the high bit set on every byte except the last. It is at most 5 bytes long and must use the fewest bytes possible.
- Zigzag maps a signed 32-bit value `n` to `(n << 1) ^ (n >> 31)`, with an arithmetic shift, and back with `(z >> 1) ^ -(z & 1)`.

Writers clamp each point's time so that it is never earlier than the point before it. The decoder must use up exactly the point data's bytes. Every decoded value must stay in its range, and the decoded points must match the stored bounding box.

Coordinates below 2^24 in absolute value (about 262,000 page units) convert exactly to `f32` and back, so values quantized once survive any number of round trips. A typical handwritten stroke with pressure, tilt, and time takes about 8 bytes per point. A page of 5,000 strokes of about 80 points is then about 3.2 to 4 MB. OpenNote confirms this figure against pen recordings from real devices before version 1 is frozen.

### 9.5 Property and removal records

A `StrokeProps` body is the stroke ID (16 bytes), a `u16` mask, and a reserved `u16`. Then, in mask order, come the parts the mask names:

| Mask bit | Part | Size |
|---|---|---|
| 0 | Style: tool (`u8`), palette slot (`u8`), reserved (`u16`), color (4 bytes), width (`f32`) | 12 |
| 1 | Transform: six `f32` values. The identity `1 0 0 1 0 0` removes the transform | 24 |
| 2 | New ink block ID | 16 |

Mask bits 3 to 15 are zero in version 1.

A `Remove` body is the stroke ID (16 bytes).

### 9.6 Reading and damage

A reader checks a segment in this order:

1. A file shorter than 72 bytes, or with the wrong magic, cannot be read. Its strokes are missing.
2. A segment version above 1, or a header flag the reader does not know, means a newer writer made the file. The page opens read-only, with a notice that some ink needs a newer OpenNote.
3. A header whose CRC-32 fails, or whose IDs do not match the file name and the page, makes the segment damaged.
4. If the footer magic is present and the footer CRC-32 matches, the reader parses exactly the stated number of records, which must end exactly at the footer. It may skip the per-record checks, because the footer covers them.
5. Otherwise, the reader walks the records one at a time. A record with a bad CRC-32 is skipped, and the next record starts after it. A body length that runs past the end stops the walk. The reader may then scan forward byte by byte for the next place where a record frame parses and its CRC-32 matches.
6. A record of unknown kind, a stroke with an unknown flag bit, or a property record with an unknown mask bit is kept but not shown. The page opens read-only, because a writer cannot know what compaction would lose.
7. Every stroke's points are decoded and checked (section 9.4). A stroke that fails is damaged.

A page with damaged ink opens read-only. It says how many strokes are affected, for example "12 strokes on this page are damaged and can't be shown." A writer never saves such a page on its own.

The person can choose to repair the page. The writer then repairs it in these steps:

1. For each damaged stroke, look for an intact `Stroke` record with the same stroke ID. Search every other segment file in the page's `ink/` folder, which includes older segments that history still keeps, and the writer's own journal (section 20).
2. Use the newest intact copy, then apply the later `StrokeProps` and `Remove` records from the page's segments. Strokes with no intact copy are left out.
3. Save the damaged revision as a version with the reason `beforeRepair`, then save the result as a new revision.

The damaged segment stays until garbage collection removes it (section 19).

### 9.7 A worked example

One stroke of 3 points, with pressure and time and without tilt, drawn with the Ink pen at width 2:

| Point | Position | Pressure | Time | Stored as |
|---|---|---|---|---|
| 0 | (10.0, 20.0) | 0.5 | 0 ms | `x` 640, `y` 1280, `p` 32768, `t` 0 |
| 1 | (10.5, 21.0) | 0.52 | 4.2 ms | `x` 672, `y` 1344, `p` 34078, `t` 42 |
| 2 | (11.25, 22.5) | 0.55 | 8.3 ms | `x` 720, `y` 1440, `p` 36044, `t` 83 |

The point data is 20 bytes:

```text
point 0: x 640 → zigzag 1280: 80 0a | y 1280 → 2560: 80 14 | p 32768: 80 80 02 | t 0: 00
point 1: dx 32 → 64: 40         | dy 64 → 128: 80 01    | dp 1310 → 2620: bc 14 | dt 42: 2a
point 2: dx 48 → 96: 60         | dy 96 → 192: c0 01    | dp 1966 → 3932: dc 1e | dt 41: 29
```

The stroke's flags are `0x0005` (pressure and time), and its bounding box is (640, 1280, 720, 1440). Appendix B gives the complete 176-byte segment file that holds it.

## 10. Assets

### 10.1 Asset files

Images, PDFs, audio, and attachments are files in the page's `assets/` folder. An asset's file name is its ID, then optionally `-` and a short stem from its original name, then `.` and an extension. An example is `01m3sa43z1tp9rdr5e8df2jbxy-leaf-section.png`. The ID keeps names unique, and the stem helps people who browse the folder.

A writer makes the stem and the extension this way:

1. Take the original file name without its extension, and normalize it to NFC.
2. Lowercase it. Then replace each run of characters that are not letters or digits (the Unicode categories L and N) with `-`, and trim `-` from both ends.
3. Truncate it to 24 UTF-16 code units at a character boundary, and trim `-` from the end again. An empty stem is left out, along with its `-`.
4. The extension is the original one in lowercase, if it matches `[a-z0-9]{1,8}`. Otherwise it comes from the media type, or is `bin`.

Readers must check an asset's file name before using it. The name must be the asset's ID, then optionally `-` and a stem of Unicode letters, digits, and `-`, then `.` and an extension that matches `[a-z0-9]{1,8}`. A name that fails is treated as a missing file.

### 10.2 The asset table

```json
"assets": {
  "01m3sa43z1tp9rdr5e8df2jbxy": {
    "file": "01m3sa43z1tp9rdr5e8df2jbxy-leaf-section.png",
    "mime": "image/png",
    "bytes": 482113,
    "sha256": "5f2b8e1c9d7a4b3e6f0a1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f",
    "name": "Leaf section.png",
    "width": 1600,
    "height": 1200,
    "created": "2026-09-30T14:05:02.305Z"
  }
}
```

| Field | Default | Meaning |
|---|---|---|
| `file` | required | The file name in `assets/` (section 10.1) |
| `mime` | required | The media type |
| `bytes` | required | The file's size |
| `sha256` | required | The SHA-256 hash of the file, as 64 lowercase hexadecimal digits |
| `name` | required | The original file name. Shown for attachments and used by exports, never as a path |
| `width`, `height` | none | Pixel size, for images |
| `created` | required | When the asset was added |
| `state` | none | Reserved: `recording` while an audio file is still growing (Phase 9) |

### 10.3 Rules for assets

- Assets are immutable. Replacing or editing an image makes a new asset.
- A writer writes an asset file durably (section 17.2) when it is imported, before any block or journal record refers to it. Large imports copy in the background, and the block is added only when the file is safe on disk.
- The hash lets a writer reuse an existing asset when the same file is added twice to a page, and lets checks detect damage.
- A missing asset, often one that a sync tool has not delivered yet, is shown as a placeholder. Its reference is kept.
- Audio recordings are the one kind of asset that grows while it is referenced. A later version defines how (section 5.6).

## 11. Readable copies

Readable copies are derived files. Writers regenerate them from the files above and never read them back as content. Writers write them without flushing (section 17.2), so after a power cut they can be stale, empty, or missing. Section 11.2 explains how writers tell that apart from a person's edit.

Writers never write readable copies for encrypted sections, because they would reveal plain text (section 5.7).

### 11.1 page.md

`page.md` is written after every successful save. For the page in section 5.5:

```markdown
---
title: "Photosynthesis"
tags: ["biology", "exam/unit-3"]
created: "2026-09-30T14:03:22.114Z"
modified: "2026-09-30T14:07:40.412Z"
opennote:
  page: "01m3sa12426sg32pmtyffjaqcf"
  revision: "01m3sa8yf8bryf28a7sjgb7mmc"
  format: 1
  checksum: "crc32:d69a2039"
---

# Photosynthesis

![Handwriting on this page](ink.svg)

## Light reactions

The **thylakoid** membrane holds ==chlorophyll a== and splits water into O<sub>2</sub>.

> [!tip] Exam hint
> Learn the Z-scheme diagram.

- [x] Read chapter 8
- [ ] Lab write-up

![Cross-section of a leaf](assets/01m3sa43z1tp9rdr5e8df2jbxy-leaf-section.png)

**Kanban board**: 2 columns, 7 cards
```

Rules:

- The front matter is YAML, with every string written as a JSON string, so any title is valid. Obsidian, Hugo, Pandoc, and other tools read `title` and `tags` from it. `tags` is left out when there are none.
- The title follows as a level 1 heading, escaped as section 7.6 requires. A page with an empty title has no heading.
- A page with at least one stroke gets the line `![Handwriting on this page](ink.svg)` after the title.
- Blocks follow in reading order (section 6.2), with one blank line between them. Text blocks are copied as they are. Images become `![alt](assets/<file>)`, and files become `[name](assets/<file>)`. Tables become GFM tables, with a hard break in a cell written as `<br>`, and with an empty header row when the table has none. Ink blocks add nothing more, except that a drawing that has a description and is not decorative adds the description, escaped, as a line in italics. Blocks of unknown types use their fallback's Markdown, or the line `*This part of the page needs a newer version of OpenNote.*`
- An image marked `decorative` gets an empty description: `![](assets/<file>)`.
- Element IDs, tags, and styles (section 6.6) are left out, so the Markdown stays clean.
- Links are rewritten so other tools can follow them. `opennote:page/<ID>` becomes a relative path to that page's `page.md` when the page is in the same notebook, and `asset:<ID>` becomes `assets/<file>`. Other links stay as they are.
- The file ends with one newline.

The checksum is the CRC-32 of the whole file, computed with the 8 digits of the checksum replaced by `00000000`.

### 11.2 Edits made outside OpenNote

Before a writer replaces `page.md`, `ink.svg`, or `index.md`, it looks at the file on disk:

| The file on disk | Treated as | What the writer does |
|---|---|---|
| Missing | Missing | Writes the new file |
| Empty, contains a zero byte, or is not valid UTF-8 | Damaged by a power cut | Writes the new file, without a notice |
| Has a checksum that matches | Written by OpenNote | Writes the new file if its revision is stale |
| Anything else | Edited by a person or another tool | Moves it to the conflicts folder, writes the new file, and tells the person once |

Edited copies go to the page's `.conflicts/` folder as `page.md.<time>.edited` or `ink.svg.<time>.edited`, and to `.opennote/conflicts/index.md.<time>.edited` for the index. `<time>` has the form `20260930T140740Z`. A later version of OpenNote may offer to import such edits.

This check matters because readable copies are written without a flush. After a power cut they can be empty or filled with zero bytes, which must never be mistaken for a person's work.

### 11.3 ink.svg

`ink.svg` is a simplified SVG 1.1 picture of every stroke on the page, so handwriting stays visible without OpenNote:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- opennote: {"page": "01m3sa12426sg32pmtyffjaqcf", "revision": "01m3sa8yf8bryf28a7sjgb7mmc", "format": 1, "checksum": "crc32:00000000"} -->
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="2 12 17.3 18.5" width="17.3" height="18.5">
  <title>Handwriting: Photosynthesis</title>
  <g>
    <path d="M10 20L10.5 21L11.3 22.5" fill="none" stroke="#2b2521" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>
```

- The view box is the union of the strokes' bounding boxes, grown by 8 units on each side. Each ink block becomes one `<g>` group. Floating blocks sit at their frame position. Flowing blocks are stacked below the floating content, in order, 24 units apart.
- Each stroke becomes one `<path>` through its points, after its transform, in page units rounded to 0.1. It uses the stored color and nominal width. A color with alpha below 255 adds `stroke-opacity`. Highlighter strokes come first in each group.
- The comment on the second line carries the page ID, the revision, the format version, and a checksum computed as for `page.md`.
- Writers write `ink.svg` when a page closes after its ink changed, and when a page opens with a missing or stale `ink.svg`, after the page is on screen. They do not rewrite it during editing, because it can be several megabytes.

The example's checksum is shown as zeros for brevity.

### 11.4 index.md, README.md, and FORMAT.md

`index.md` in the notebook folder is a table of contents with a link to every page's `page.md`:

```markdown
---
opennote:
  kind: "notebook-index"
  notebook: "01m3s9q9xbpmxwz4cz4ht6twg9"
  format: 1
  checksum: "crc32:00000000"
---

# Biology

## Semester 1

### Lab reports

- [Photosynthesis](01m3s9v8ym7yt5c8yb61tthbwt/01m3sa12426sg32pmtyffjaqcf/page.md)
  - [Light reactions](01m3s9v8ym7yt5c8yb61tthbwt/01m3saznsm2jxj28tzqrqhddv4/page.md)
```

The notebook title is the level 1 heading. Each section group is a heading one level below its parent, and each section is a heading one level below its group. Pages are a list in page order, with subpages nested under their parents. Titles are escaped as section 7.6 requires. Writers rewrite the file at most once every 5 seconds after the tree or a title changes. It follows the rules of section 11.2, and its checksum is computed as for `page.md`. The example's checksum is shown as zeros for brevity.

`README.md` in the notebook folder tells people what the folder is and how to read it without OpenNote. Writers create it with the notebook:

```markdown
# Biology

This folder is a notebook made with OpenNote, an open-source note app. You can read all of it without OpenNote.

- Open index.md for a list of every page.
- Each page folder has page.md, a readable copy of the page, and ink.svg, a picture of its handwriting. Pictures and attachments are in its assets folder.
- page.json holds the full page. The format is described in .opennote/FORMAT.md.

<!-- Written by OpenNote. OpenNote only rewrites this file while this line is here. -->
```

Writers may update `README.md` only while its last line is still there. Otherwise they leave it alone.

`.opennote/FORMAT.md` is a copy of this specification for the newest format version in the notebook. Writers write it when they create the notebook, and again when they first write a newer format version into it. Nobody reads it back. It is there so the notebook describes itself.

## 12. Trash

### 12.1 Trash items

Deleted pages, sections, and section groups move to `.opennote/trash/` inside their notebook. Moving a folder there is a rename on the same volume, so it is fast whatever the page's size. Trash travels with the notebook, so a page deleted on one device can be restored on another.

Each deletion is one Trash item: a folder named by a new ID, holding `item.json` and the deleted folders.

```json
{
  "formatVersion": 1,
  "minReaderVersion": 1,
  "kind": "opennote.trash-item",
  "id": "01m3sd8rc0w1pt611mq42a0rx1",
  "itemKind": "page",
  "title": "Light reactions",
  "deletedAt": "2026-09-30T15:00:00.000Z",
  "expiresAt": "2026-10-30T15:00:00.000Z",
  "deletedBy": {
    "id": "01m1e34qm04rx4vfj1927vgwgm",
    "label": "Windows device GWGM"
  },
  "origin": {
    "section": "01m3s9v8ym7yt5c8yb61tthbwt",
    "sectionTitle": "Lab reports",
    "entries": [
      {
        "id": "01m3saznsm2jxj28tzqrqhddv4",
        "title": "Light reactions",
        "parent": "01m3sa12426sg32pmtyffjaqcf",
        "order": "a0",
        "changed": "2026-09-30T14:20:05.300Z"
      }
    ]
  },
  "contents": ["01m3saznsm2jxj28tzqrqhddv4"]
}
```

| Field | Default | Meaning |
|---|---|---|
| `formatVersion`, `minReaderVersion`, `kind` | required | As in `notebook.json`. `kind` is `"opennote.trash-item"` |
| `id` | required | The item's ID, which is also its folder name |
| `itemKind` | required | `page`, `section`, or `group` |
| `title` | required | The deleted item's title, for the Trash list |
| `deletedAt`, `expiresAt` | required | When it was deleted, and when it is purged. Storing `expiresAt` lets every device agree |
| `deletedBy` | required | The device ID and label |
| `reason` | `"deleted"` | `deleted`, or `moved` for a page, section, or group moved to another notebook (section 18.2) |
| `origin` | required | Where the item came from. For pages: `section`, `sectionTitle`, and `entries`, the removed page entries. For a section: `group`, `order`, and `parentTitle`, the group's title. For a group: `groups`, the removed group definitions, including nested groups, and `parentTitle`, the title of the group that held it |
| `contents` | required | The folders in this item, by name. For pages, their page IDs. For a section or group, section IDs |

### 12.2 Deleting

1. Close the pages involved in every window. Each gets a final save first.
2. Record a tree intent in the journal, if the writer keeps one (section 20.7).
3. Create the item folder and write `item.json` durably.
4. Remove the page entries from `section.json`, or the groups from `notebook.json`. The navigation tree changes at once.
5. Move each folder listed in `contents` into the item folder. If a file inside is held open, keep retrying in the background (section 17.6).
6. Mark the intent done.

`item.json` is written first, so it records the deletion inside the notebook, where any device can finish it. While a folder in `contents` is still outside the item folder, the deletion is pending. Readers must not show that page or section in the tree, and writers finish the move (section 18.3).

`parentTitle` is left out at the top level of the notebook. OpenNote gives each deleted page with its subpages, each section, and each group its own Trash item, so that each can be restored on its own. Deleting several at once makes several items.

### 12.3 Restoring

1. Record a tree intent.
2. Choose the destination: the original section, group, or top level if it still exists outside Trash. Otherwise, OpenNote puts restored pages into a new top-level section named after `sectionTitle`, and other writers may ask the person instead.
3. Add the entries back with their original order keys and parents, each marked `"moving": {"fromTrash": <item ID>}`. A missing parent makes a page top level, and equal order keys are fine, because the ID breaks the tie.
4. Move each folder back. If a folder with the same ID is already at the destination, which only copying can cause, the restored page gets a new ID.
5. Clear the `moving` marks, then delete `item.json` and the empty item folder.
6. Mark the intent done.

Restoring a section or a group has no page entries to mark. Step 3 puts any removed groups back into `notebook.json`, and each section appears in the tree when its folder is back in the notebook folder. A restored section whose group no longer exists moves to the top level.

### 12.4 Purging

Items whose `expiresAt` has passed are purged when the app starts and once a day. "Delete forever" and "Empty Trash" use the same steps after the person confirms:

1. Rename the item folder to `.opennote/trash/~purge-<item ID>`, which is atomic.
2. Delete that folder and everything in it. The deletion never follows links or junctions.

A leftover `~purge-<item ID>` folder is deleted at the next start. Deleting a whole notebook is outside this format: the app either removes it from its list or moves its folder to the operating system's recycle bin.

## 13. Page history

### 13.1 Saved versions

A saved version is the exact bytes of `page.json` at one revision, compressed with gzip and stored as `.history/<revision ID>.json.gz`. Writers should set the gzip time field to zero and leave out the file name, so the same page gives the same file. Revision IDs start with their time, so the file names sort by time.

A version does not copy ink or assets. It refers to the same immutable segments and asset files as the page, and they stay on disk while any version needs them. An unchanged drawing therefore costs nothing extra in history, and restoring a version brings back a deleted image.

`.history/versions.json` lists the versions:

```json
{
  "formatVersion": 1,
  "minReaderVersion": 1,
  "kind": "opennote.history",
  "page": "01m3sa12426sg32pmtyffjaqcf",
  "versions": [
    {
      "revision": "01m3sa6634zkpfshkpzzrzbmav",
      "savedAt": "2026-09-30T14:06:10.020Z",
      "reason": "closed",
      "device": {
        "id": "01m1e34qm04rx4vfj1927vgwgm",
        "label": "Windows device GWGM"
      },
      "bytes": 4122,
      "segments": ["01m3sa81n2n6c32zjexe5yq0r5"],
      "assets": ["01m3sa43z1tp9rdr5e8df2jbxy"]
    }
  ]
}
```

| Field | Default | Meaning |
|---|---|---|
| `formatVersion`, `minReaderVersion`, `kind` | required | As in `notebook.json`. `kind` is `"opennote.history"` |
| `page` | required | The page's ID |
| `versions` | `[]` | The versions, oldest first. Each has the fields below |
| `revision` | required | The version's revision ID, which names its snapshot file |
| `savedAt` | required | When that revision was saved |
| `reason` | required | Why it was kept (section 13.2) |
| `name` | none | A name the person gave it |
| `keep` | `false` | The person asked to keep it forever |
| `device` | required | The device that saved it |
| `bytes` | required | The snapshot file's size |
| `segments`, `assets` | `[]` | The segments and assets the version refers to, so garbage collection never has to open snapshots |

The list can be rebuilt. If it is missing or damaged, a writer lists the snapshot files and reads each one, with the reason then unknown. If a sync tool makes two copies of the list, writers merge them by revision.

### 13.2 When a save becomes a version

Autosave runs often, so only some saves become versions:

| Reason | When |
|---|---|
| `beforeEdit` | The first save of a session, when the revision on disk came from another device or tool and is not yet in history |
| `closed` | The page is closed or left after edits since its last version |
| `interval` | Every 10 minutes while editing continues |
| `exit` | The app exits with edits since the last version |
| `named` | The person saves a version, and may name it |
| `beforeRestore` | Before restoring an older version |
| `beforeUpgrade` | Before the first save in a newer format version |
| `beforeLargeDelete` | Before a change that removes more than 20 blocks or 200 strokes |
| `beforeRepair` | Before repairing damaged ink (section 9.6) |
| `conflict` | The version not kept when a conflict is resolved |
| `recovered` | After crash recovery replays a journal |

### 13.3 Thinning

Thinning is writer policy. OpenNote keeps:

| Age | Versions kept |
|---|---|
| Under 24 hours | All |
| 1 to 7 days | The newest in each hour |
| 7 to 30 days | The newest in each day, in local time |
| 30 days to 1 year | The newest in each ISO week |
| Over 1 year | The newest in each month |

Some versions are always kept: named ones, ones marked `keep`, the newest one, and ones an open conflict or a journal on this device still needs. If a page's history (snapshots, plus the ink and assets only history uses) passes 50 MiB, the oldest unnamed versions go first. People can choose to keep versions for 30 days, for 1 year (the default), or forever.

A writer first writes the new `versions.json`, then deletes the dropped snapshot files. A crash between the two leaves extra files, which the next rebuild finds and thins again. History is best effort: losing a version never loses the page's current content.

### 13.4 Restoring a version

1. Save the current state as a version with the reason `beforeRestore`.
2. Read the snapshot, and upgrade it in memory if it is older (section 15.3).
3. Give it a new revision whose parent is the current revision, and save it normally.

"Restore as a copy" makes a new page with a new page ID instead. Either way, the undo history of the page is cleared, because older edits no longer describe it.

## 14. Conflicts and sync tools

### 14.1 Changes made elsewhere

Many people keep notes in a folder that a sync tool manages. On many Windows computers, the Documents folder itself is in OneDrive. So a writer must expect other devices and tools to change files at any time.

A writer compares the fingerprint of `page.json` (its size, last-write time, and file ID) with the one it saw when it last read or wrote the file. It does so before every replace, when a page opens, and when a window regains focus. It may also watch the folder for changes. If the fingerprint changed, the writer reads the file's revision:

| What the writer finds | What it does |
|---|---|
| The revision it wrote itself | Nothing. A tool touched the file without changing it |
| An older revision of its own (listed in its `ancestors`), for example after a sync tool rolled the file back | Not a conflict. Its own version is newer, and saving goes ahead |
| Any other revision, with no unsaved edits here | Reloads the page and clears its undo history. Nothing of this device's is lost |
| Anything else, with unsaved edits here | A conflict (below) |

In a conflict, nothing is overwritten. The version on disk is copied to `.conflicts/<its revision ID>.json`, and this device's version is saved as `page.json`. The page then shows a notice such as "This page was also changed on Windows device 7Q2M. Compare the versions." Every device that syncs the folder sees the open conflict, because it is a file in the page folder.

The person resolves a conflict by keeping this version, keeping the other one, or keeping both as separate pages. The version not kept goes into history with the reason `conflict`, and the conflict file is then deleted.

### 14.2 Sync-tool conflict copies

Sync tools keep both versions of a file that changed in two places, by renaming one of them:

| Tool | Example |
|---|---|
| Dropbox | `page (Sam's conflicted copy 2026-09-30).json` |
| OneDrive | `page-LAPTOP.json` |
| Syncthing | `page.sync-conflict-20260930-140312-ABCDEFG.json` |
| Nextcloud | `page (conflicted copy 2026-09-30 140312).json` |
| iCloud Drive and Google Drive | `page 2.json` and `page (1).json` |

The rule is general. Any file in a page folder whose name starts with `page` and ends with `.json`, other than `page.json`, that parses as a page with the same page ID is a conflict copy. A writer moves it into `.conflicts/`, named by its revision ID, and handles it as in section 14.1. Copies of `versions.json` and `item.json` are merged by union. Immutable files never get conflict copies, because no device ever changes them.

### 14.3 Copies of tree files

Copies of `section.json` and `notebook.json` are merged without asking. The result is the union of the entries by ID. For an entry that both copies have, the fields come from the copy whose `changed` time is later. Device clocks can disagree, so the worst case is a wrong cached title, order, color, or pin, which the person can see and fix. No content can be lost, because pages and sections exist as folders (section 18.3). The copy is kept in `.opennote/conflicts/` for 30 days.

### 14.4 Duplicate IDs

Two page folders can hold the same page ID when a person copies a folder by hand, or when a sync tool brings back an old folder. The folder whose name equals the ID is the page. The other is a duplicate:

- Readers do not list it. Instead, the page shows a notice with three choices. The person can compare the two, keep both as separate pages, or move the copy to Trash. Keeping both gives the copy a new page ID and its own entry.
- A writer never gives the copy a new ID on its own.
- The page may refer to a segment or asset that is missing from its folder but present in the duplicate. If the name matches and the size and checksum agree, the writer copies it over.

The same rules apply to two section folders with the same ID. Two notebook folders with the same notebook ID are handled in section 20.2.

### 14.5 Files that are still on their way

A sync tool can deliver `page.json` before the files it refers to. A page whose segments or assets are missing opens read-only with "Waiting for this page to finish syncing", and the writer tries again when files arrive. After 10 minutes the notice becomes "Some parts of this page haven't arrived." Writers never save a page in this state.

A file that is only in the cloud, such as a file in OneDrive that is not downloaded yet, may need a download to read. If that fails because the computer is offline, the page shows "This page is stored in OneDrive and isn't downloaded yet."

## 15. Versions and compatibility

### 15.1 Where versions live

| Files | Version field | Version 1 value |
|---|---|---|
| `notebook.json`, `section.json`, `page.json`, `item.json`, `versions.json` | `formatVersion` and `minReaderVersion`, always the first two keys | 1 and 1 |
| Ink segments | The `u16` at offset 8 | 1 |
| Journal files (device-local) | The `u16` at offset 8 | 1 |
| Readable copies | `format` in their front matter or comment | 1 |

All JSON files share one format version number. A later version raises it at most once per app release, even for changes that only add things. The change log in Appendix C lists what each version changed.

### 15.2 Reading rules

Let V be the newest format version a reader supports. For a file with `formatVersion` F and `minReaderVersion` R:

| Condition | What the reader does |
|---|---|
| F ≤ V | Reads and writes normally. An older file is upgraded in memory first (section 15.3) |
| F > V and R ≤ V | Opens it read-only and shows what it can, using fallbacks. The banner says "This page was saved by a newer version of OpenNote. You can read it here. Update OpenNote to edit it." |
| R > V | Cannot show it. Shows the page's `page.md` read-only if it exists, with "This page needs a newer version of OpenNote." |
| `formatVersion` missing, or `kind` wrong | Reports that the file is not an OpenNote file, with its path |

Read-only applies per file. A newer `page.json` makes that page read-only. A newer `section.json` freezes that section's settings and page list, while its pages follow their own versions. A newer `notebook.json` freezes the notebook's groups and defaults.

Writers must never replace a file whose version is newer than the version they write. Writers set `minReaderVersion` to the oldest version that can show the file usefully with fallbacks, which is normally 1. They raise it only when older readers would show something wrong, such as encrypted content.

### 15.3 Migrations

A migration upgrades a file from one version to the next. The chain of migrations runs one step at a time, from the file's version to the current one.

- Migrations are pure functions on JSON values. They use no files, no clock, and no randomness, so running one twice gives the same result.
- They never drop data. A renamed field moves. A removed feature keeps its data as unknown keys.
- They run in memory whenever an older file is read. The file is written in the new version only when it is saved because of an edit. Untouched pages stay in the old version, so an older device that shares the notebook can still edit them.
- Ink segments are never migrated. Readers keep a decoder for every segment version ever released, and compaction writes the current one.
- History snapshots are never rewritten. They are upgraded in memory when opened.
- Every migration has fixture tests: an input file for each older version and the expected output.

### 15.4 Backups before an upgrade

Before a writer first writes an upgraded file into a notebook, it copies every JSON file of the notebook to its device-local backups folder (section 20.1). The copies keep their relative paths, and the writer flushes them. Ink and assets are never rewritten by migrations, so they need no backup. Writers keep the 3 newest backup sets per notebook. Each page's last revision before the upgrade is also kept as a version with the reason `beforeUpgrade`, so it is one click away inside the app.

### 15.5 Rules for later versions

These rules are for people who change this format:

- A new block type gets a new type name and must carry a fallback (section 6.5).
- A new field must be optional and have a stated default.
- A name or a binary code is never reused with a new meaning.
- A new encoding of ink gets a new segment version. Decoders for old versions stay forever.
- Every change raises `formatVersion`, updates this specification and Appendix C, adds fixtures, and adds a migration when old files need one.

## 16. Validation and limits

Readers check every file they read, and writers check every change they apply. Anything outside these limits is an error that names the file and the problem.

| Limit | Value |
|---|---|
| `page.json` size | 64 MiB |
| JSON nesting depth | 128 |
| Blocks per page | 100,000 |
| Markdown in one text block | 4 MiB |
| Strokes per page | 1,000,000 |
| Points per stroke | 200,000 |
| Segment file size | 256 MiB |
| Segments per page | 4,096 |
| Journal record payload | 64 MiB |
| Decompressed history snapshot or journal base | 64 MiB |
| Geometry values | Finite, absolute value at most 10,000,000 |
| Order key length | 1 to 256 characters |
| Title | 1,000 characters |
| Tags | 1,000 per page and per text element, 200 characters each |
| Element IDs | 100,000 per text block |

Structural checks:

- IDs are well formed and unique within their scope. Element IDs are unique together with block IDs.
- Every asset that a block or Markdown image refers to is in the asset table, and every asset file name passes section 10.1.
- Every stroke's ink block exists and has the type `ink`.
- A block's `strokeCount` matches its live strokes. A mismatch is a warning, corrected at the next save.

A `page.json` that cannot be parsed, or that fails a structural check, opens read-only as damaged. Writers never replace it on their own. The person can restore a version from history. Before any repair or restore, the writer moves the damaged file to `.damaged/<time>-page.json`.

## 17. Saving safely

### 17.1 Two invariants

Every writer must keep these two statements true after an app crash or a power cut at any moment:

- **I1:** every `page.json` parses and passes validation, and every file it refers to exists, is complete, and has the size and checksums it lists.
- **I2:** every edit that a writer reported as durable is either in `page.json`, or in the journal on top of a base revision the journal can find (section 20).

The crash tests in OpenNote check both after every simulated crash. A writer without a journal, such as an importer, only has to keep I1.

### 17.2 Write primitives

| Primitive | Used for | Behavior |
|---|---|---|
| `replace_durable` | `page.json`, `section.json`, `notebook.json`, `item.json`, and `versions.json` | Writes a temporary file, flushes it, renames it over the target, and makes the rename durable |
| `create_durable` | Segments, assets, history snapshots, and journal generations | The same, except that it fails if the target exists. An existing target with the expected size and checksum counts as success, because it can only be a retry after a crash |
| `write_derived` | `page.md`, `ink.svg`, and `index.md` | Writes a temporary file and renames it, without flushes |
| `create_dir_durable` | New page and section folders, `ink/`, `assets/`, `.history/`, and Trash items | Creates the folder, then flushes its parent folder: always on macOS, iOS, Linux, and Android, and on Windows for FAT32, exFAT, and FAT |
| `rename_dir` | Moving page and section folders | Never replaces an existing folder. Made durable like `create_dir_durable` |

The temporary file always sits in the same folder as its target, because a rename is only atomic within one volume.

### 17.3 On Windows

```text
1. tmp = <folder>\~<name>.<8 random hex digits>.tmp
   h = CreateFileW(tmp, GENERIC_READ | GENERIC_WRITE | DELETE, no sharing,
                   CREATE_NEW, FILE_ATTRIBUTE_NORMAL)
2. WriteFile(h, bytes) until every byte is written
3. FlushFileBuffers(h)
4. SetFileInformationByHandle(h, FileRenameInfoEx, FILE_RENAME_INFO {
       Flags = FILE_RENAME_FLAG_REPLACE_IF_EXISTS | FILE_RENAME_FLAG_POSIX_SEMANTICS,
       FileName = <folder>\<name> })
   On ERROR_INVALID_PARAMETER or ERROR_NOT_SUPPORTED (FAT32, exFAT, network redirectors):
       SetFileInformationByHandle(h, FileRenameInfo, { ReplaceIfExists = TRUE, ... })
   If renaming by handle is refused for any other reason:
       CloseHandle(h)
       MoveFileExW(tmp, target, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)
       and report the save as Unconfirmed (section 17.5)
5. FlushFileBuffers(h), which now names the target
6. On FAT32, exFAT, and FAT only: open the parent folder with FILE_FLAG_BACKUP_SEMANTICS
   and GENERIC_WRITE, and flush it
7. GetFileInformationByHandleEx(h): size, last-write time, and file ID (the new fingerprint)
8. CloseHandle(h)
```

`create_durable` leaves out `FILE_RENAME_FLAG_REPLACE_IF_EXISTS` in step 4. All paths use the `\\?\` form, so long paths work.

Why this sequence:

- Renaming by handle and then flushing the same handle makes the rename durable without opening the target again. Opening it again could fail while a scanner or a sync client has it open.
- With POSIX (Portable Operating System Interface) semantics, the rename succeeds even while another program has the target open with delete sharing. Antivirus scanners usually open files that way. That program keeps reading the old content.
- `MoveFileExW` stays only as a fallback. Its write-through flag is documented only for moves that copy and delete, so it proves nothing about durability.
- `ReplaceFileW` is not used. It copies attributes and permissions from the old file, and some of its documented failures leave the target missing.
- `FILE_ATTRIBUTE_TEMPORARY` is not used. It asks Windows to keep data in memory, and it would stay set on the renamed file.

OpenNote opens every file it reads with read, write, and delete sharing, so it never blocks its own writes.

### 17.4 On macOS, iOS, Linux, and Android

```text
1. fd = open(<folder>/~<name>.<hex>.tmp, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0644)
2. write(fd, bytes) until done
3. fsync(fd); on Apple platforms fcntl(fd, F_FULLFSYNC), falling back to fsync if it fails
4. replace_durable: rename(tmp, target)
   create_durable:  Linux renameat2(tmp, target, RENAME_NOREPLACE)
                    Apple platforms renamex_np(tmp, target, RENAME_EXCL)
                    otherwise, or if those are not supported: link(tmp, target), then unlink(tmp)
5. open(<folder>, O_RDONLY | O_DIRECTORY), fsync it, and close it
6. fstat(fd) for the new fingerprint, then close(fd)
```

`create_durable` must never check whether the target exists and then rename, because another program could create the target in between. The calls in step 4 fail atomically when the target exists.

Android's shared storage and iCloud Drive do not offer an atomic rename. Those platforms need their own storage adapter, and the format does not change.

### 17.5 Confirmed and unconfirmed durability

Every durable primitive reports whether its result is confirmed on disk:

| Volume | Confirmed when |
|---|---|
| NTFS or ReFS, the Windows file systems with a metadata log, on a local drive | The rename was done by handle, and the flush of that handle succeeded |
| FAT32, exFAT, or FAT on a local drive | The rename was done by handle, and the flushes of the handle and of the parent folder both succeeded |
| A network share on Windows | Never |
| Any volume where the `MoveFileExW` fallback ran | Never |
| A local drive on other platforms | The flushes of the file and of its folder both succeeded |
| A network file system on other platforms | Never |

Only a confirmed replace of `page.json` allows a writer to delete older journal generations (section 20.9). The journal lives on the system drive, and the notebook may be on another drive, a USB drive, or a network share. A flush on one volume says nothing about another.

FAT32 (the file allocation table format) and exFAT keep no metadata log, so a drive unplugged during a save can lose a folder change. When a notebook is on such a drive, the app shows a one-time note: "Notebooks on this drive are safest when you eject the drive before you unplug it."

### 17.6 Errors and retries

| Condition | Kind | What the writer does | What the person sees |
|---|---|---|---|
| A sharing or lock violation, usually a scanner, the search indexer, or a sync client | Busy | Retries after 5, 10, 20, 40, 80, 160, 320, and 640 ms, about 1.3 seconds in all. If it is still busy, the save fails, and autosave tries again after 1, 2, 5, 10, and 30 seconds, then every 30 seconds | From the second failure: "Can't save right now. Your changes are safe. Trying again." |
| Access denied on a target that is being deleted | Busy | As above | As above |
| The target file is marked read-only | Read-only file | Does not retry. The page becomes read-only | "This page's file is marked read-only in Windows. Make it editable?" The action clears the attribute |
| Access denied when creating the temporary file, or still denied after the Busy retries | Blocked | Does not retry on a timer loop. Tries again when the person chooses Try again, when the window regains focus, and every 5 minutes | "Windows blocked OpenNote from saving to this folder. If Controlled folder access is on, allow OpenNote in Windows Security." |
| The disk is full | Disk full | Deletes its temporary file. Tries again when free space grows, checking every 30 seconds | "Your disk is full, so OpenNote can't save. Your changes are safe on this device. Free some space, and saving will continue." |
| The notebook's folder is gone, such as an unplugged drive or an offline share | Offline | Keeps edits in memory and in the journal, and saves when the folder returns | "This notebook's drive isn't connected. Your changes are kept until it's back." |
| A cloud file that is not downloaded, while offline | Cloud placeholder | Keeps the page read-only until the file is available | "This page is stored in OneDrive and isn't downloaded yet." |

A writer may tell Controlled folder access apart from missing permissions, because it blocks writes that the folder's permissions allow, and then name the exact cause. Messages follow the voice in [BRAND.md section 3](../../BRAND.md#3-voice-and-tone).

### 17.7 The page save, step by step

A writer that keeps a journal saves a page in this order. `R` is the revision on disk, and `R'` is the new one.

| Step | Action |
|---|---|
| S1 | Take a snapshot of the page, and note the last journal sequence number it includes |
| S2 | Encode a new segment from the strokes and changes since the last save, or a compacted segment |
| S3 | Write the segment with `create_durable` |
| S4 | Check that every asset the snapshot refers to exists with its expected size |
| S5 | Serialize `page.json` with revision `R'`, whose parent is `R`. Parse the bytes back and compare them with the snapshot. Any difference stops the save before anything is replaced |
| S6 | Append a `SaveBegin` record for `R'` to the journal, and flush it |
| S7 | Check the fingerprint of `page.json` on disk again, immediately before S8. If it changed and its revision is not `R`, stop and handle the change (section 14.1) |
| S8 | Write `page.json` with `replace_durable`. This rename is the commit point |
| S9 | Make `R'` the page's base, and record the new fingerprint and segment list |
| S10 | If S8 was confirmed, let the journal rotate (section 20.9) |
| S11 | Write `page.md`, refresh the title copy in `section.json` if the title changed, write a history version if one is due, and schedule compaction or garbage collection |
| S12 | Report the save, and tell the search index which blocks changed |

If any step from S2 to S8 fails, the page stays dirty, and the writer tries again later. Every edit stays in memory and in the journal.

A writer without a journal, such as an importer, runs S2 to S5 and S8. The commit rule is the same for every writer: new immutable files first, and the `page.json` replace last.

### 17.8 What a crash leaves behind

| The crash happens | On disk afterward | Recovery | Work lost |
|---|---|---|---|
| Before an edit reaches the journal | Nothing new | Nothing to do | Up to 300 ms of typing, or 500 ms of a stroke |
| After a journal write, before its flush | App crash: the record is in the operating system's cache. Power cut: it may be torn | App crash: replayed. Power cut: the torn tail is dropped | Power cut: up to about 800 ms |
| During S3 | A temporary file | The journal replays the edits. The temporary file is deleted after 24 hours | None |
| After S3, before S6 | A segment nothing refers to | The journal replays the edits. The segment is deleted after 30 days | None |
| After S6, during S8 | `page.json` at `R`, and a `SaveBegin` for `R'` | Replay from the anchor that matches `R` | None |
| After the rename in S8, before its flush, with a power cut | `page.json` at `R` or at `R'` | Either anchor matches (section 20.10) | None |
| After S8, before S10 | `page.json` at `R'` | Replay the records after the `SaveBegin` for `R'` | None |
| During rotation | Two generations | Records after the anchor from both, without duplicates | None |
| During S11 | A stale or missing `page.md`, or a missing version | Regenerated, or written at the next version point | One version, never content |

In every row, `page.json` is either the complete old revision or the complete new one, and every file it refers to exists.

### 17.9 The check-then-replace race

Between the fingerprint check in S7 and the rename in S8, another program can still write `page.json`, and S8 then replaces that write. No file system call offers an atomic "replace only if unchanged". The window is the time between two system calls on the same thread: usually under a millisecond on a local drive, and one network round trip on a network share.

Writers limit the harm in three ways:

1. S7 runs immediately before S8, with no other file work in between.
2. A writer that watches the folder treats any change to `page.json` in that window that it did not make itself as a possible lost write. It flags the page and shows "OpenNote may have saved over a change that arrived at the same moment. Compare versions."
3. The writer lists the page folder 5 seconds and 60 seconds after every save, and handles any sync-tool conflict copy it finds (section 14.2). Sync tools usually keep the replaced write as such a copy, or in their own version history, which the notice points to.

### 17.10 What a save costs

| Save | Flushes |
|---|---|
| A text change | 3: the `SaveBegin` record, and `page.json` before and after its rename |
| New or changed ink | 5: as above, plus the segment before and after its rename |
| A journal rotation | 2 more on the system drive, done by the journal's own thread (section 20.9) |
| A history version | 4 more, at most once every 10 minutes |

On drives formatted with FAT32 or exFAT, each rename adds a flush of its folder. Saves run on a background thread and never block typing or drawing, and the journal flushes on its own thread, so a slow notebook drive never delays the journal.

## 18. Changing the notebook tree

### 18.1 Changes to one file

Renaming, recoloring, pinning, or reordering a section, section group, notebook, or page entry changes one tree file with `replace_durable`. After a crash, the file is either old or new, so these changes need no intent.

Renaming a page is an edit of its `page.json`, journaled like any other edit. The title copy in `section.json` is refreshed after the save.

### 18.2 Changes to several files

A change that touches several files or folders starts with a tree intent in the journal (section 20.7), if the writer keeps one, and ends by marking it done. It also leaves a mark inside the notebook, so that any device can finish it. After a crash, the writer rolls every unfinished intent forward. Each step can safely run twice.

| Change | Steps | Portable mark |
|---|---|---|
| Create a page | 1. Create `<section>/<page ID>` with `create_dir_durable`. 2. Write `page.json` from the template. 3. Add the entry to `section.json` | A folder without an entry is added by the scan |
| Create a section | 1. Create the folder. 2. Write `section.json` | A folder with `section.json` is a section |
| Move a page to another section | 1. Add the entry to the target `section.json`, marked `"moving": {"from": <source section ID>}`. 2. Remove the entry from the source `section.json`. 3. Rename the page folder into the target section, retrying in the background until it works. 4. Clear the mark | The `moving` mark |
| Duplicate a page | 1. Copy the folder to `<section>/~<new ID>.copying`, every file durably. 2. Give its `page.json` the new page ID and a new first revision. 3. Rename it to `<new ID>`. 4. Add the entry | A partial copy is deleted after 24 hours |
| Move a page to another notebook | 1. Copy the folder to `<target section>/~<page ID>.moving`, every file durably. 2. Rename it to `<page ID>` and add the target entry. 3. Delete the source page to Trash, with the reason `moved` | Before step 2, the partial copy is deleted and the source is untouched. The original stays in Trash for 30 days |
| Move a section or group to another notebook | 1. Copy each section folder to `<target notebook>/~<section ID>.moving`, every file durably. 2. Add any moved groups to the target `notebook.json`. 3. Give each copy's `section.json` its new group and order, then rename the copy to `<section ID>`. 4. Delete the source to Trash, with the reason `moved` | As for a page |
| Delete to Trash | Section 12.2 | `item.json` |
| Restore from Trash | Section 12.3 | The `moving` mark |
| Purge | Section 12.4 | The `~purge-` folder name |

The navigation tree shows a move or a deletion as soon as the tree files change. The folder rename can wait, because on Windows a folder cannot be renamed while any file inside it is open. The writer reads and saves the page at the folder's current place until the rename succeeds. A move waits for any save of that page in progress, and takes the notebook's tree lock before the page's lock, never the other way around.

### 18.3 The scan

When a notebook opens, after journal recovery, the writer scans it to heal any partial state left by a crash, a sync tool, or a person editing files by hand. People can also run the scan as "Check this notebook for problems". The scan reads folder listings and tree files, not page files, so it stays fast. It never uses timestamps to decide where a page belongs.

1. List the notebook folder. Each folder with a readable `section.json` is a section. A damaged `section.json` is rebuilt from the section's page folders, and the damaged file is moved to `.opennote/conflicts/`.
2. Read the Trash items. A folder listed in an item's `contents` that is still in its old place is a pending deletion. The scan finishes moving it into Trash, and readers do not show it.
3. List each section's folders. Each folder with a `page.json` is a page. A folder whose name is not an ID is known by the ID inside its `page.json`.
4. Match page lists with folders:
   - An entry marked `moving` whose folder is still in its old place is a pending move. The scan finishes it.
   - An entry whose folder sits in another section, without a `moving` mark, was moved by hand or by a sync tool. The folder's place wins, and the entry moves to that section's list.
   - A folder with no entry anywhere is added at the end of its section. Its title is read from `page.json` in the background.
   - An entry with no folder anywhere is kept and marked unavailable for 30 days, then dropped.
5. Handle duplicate IDs (section 14.4) and sync-tool copies of tree files (section 14.3).
6. Delete temporary files and partial copies older than 24 hours.

For an unavailable page, the notice depends on the cause. If the notebook is in a folder that a sync tool manages, it says "This page isn't here yet. It may still be syncing." If this device saw the page's folder before and no sync tool manages the notebook, it says "This page's folder is missing. It may have been lost when the computer or drive stopped suddenly," and offers to look in Trash or remove the entry.

The scan writes a tree file only when it changes something, and each change is an ordinary atomic replace.

## 19. Automatic deletions

A writer deletes only the files in this list without being asked. Before each deletion, it checks that the path is inside the notebook folder (or the device-local data folder) and that the name matches the pattern shown. It never follows links or junctions.

| What | Name pattern | When |
|---|---|---|
| The writer's temporary files | `~<name>.<8 hex digits>.tmp` | Older than 24 hours |
| Empty folders left by an interrupted create | A page or section ID | Older than 24 hours, and empty except for temporary files |
| Partial copies | `~<ID>.copying` and `~<ID>.moving` | Older than 24 hours |
| Ink segments that nothing refers to | `<ID>.onk` in `ink/` | Unchanged for 30 days |
| Assets that nothing refers to | `<ID>.<ext>` or `<ID>-<stem>.<ext>` in `assets/` | Unchanged for 30 days |
| History snapshots dropped by thinning | `<revision ID>.json.gz` in `.history/` | When thinning runs (section 13.3) |
| Trash items | A Trash item ID | After `expiresAt`, or when the person purges them |
| Leftover purge folders | `~purge-<ID>` | At the next start |
| Resolved conflict files | `<revision ID>.json` in `.conflicts/` | After the person resolves the conflict. The version not kept is in history |
| Copies of tree files | Files in `.opennote/conflicts/` | After 30 days |
| Damaged files moved aside | Files in `.damaged/` | After 90 days |
| Journal generations, locks, and migration backups | Section 20 | As section 20 describes. The 3 newest backup sets per notebook are kept |

For segments and assets, these files count as referring to them: `page.json`, every version in `versions.json` or in `.history/`, and every file in `.conflicts/`. So do sync-tool conflict copies in the page folder and the base snapshots of this device's journals. A writer collects unreferenced files only for a page that is not open, because undo can bring back a deleted image.

The 30-day wait protects against sync timing: another device may still be working from an older `page.json` that refers to a segment this device no longer needs. A file that a person puts into `ink/` or `assets/` by hand does not match the patterns, so it is never deleted.

Readable copies are overwritten, not deleted, following the rules in section 11.2.

## 20. Device-local data and the journal

This section is for apps that edit notebooks interactively and recover from crashes, as OpenNote does. Tools that only read or write notebook files can skip it. None of these files are part of a notebook, and none of them are ever synced.

### 20.1 Device-local data

```text
%LOCALAPPDATA%\OpenNote\              (macOS: ~/Library/Application Support/OpenNote,
                                       Linux: $XDG_DATA_HOME/opennote, mobile: app storage)
  device.json                         this device's ID and label
  session.json                        a "running" marker, used only for the start-up message
  journal\<notebook key>\
    <page ID>-<generation>.wal        journal generations of one page
    tree-<generation>.wal             tree intents of the notebook
  locks\<notebook key>.lock           one lock per open notebook
  state\<notebook key>.json           per-device view state: last page, scroll, zoom, and view
  cache\<notebook key>\               rebuildable: page titles and modified times, search index, thumbnails
  backups\<notebook ID>\<time>-v<from>-to-v<to>\    copies made before format upgrades
  recovery\                           changes that recovery could not apply, as readable JSON
```

`device.json` holds `{"id": <device ID>, "label": <label>}`. It lives in local, not roaming, app data. In managed Windows setups the roaming folder follows a person to other computers, which would give two computers the same device ID.

The cache keeps each page's `modified` time and title by page ID, except for pages in encrypted sections (section 5.7). The navigation tree sorts by modified time from this cache, never from folder times, which change for other reasons.

### 20.2 Notebook key and folder identity

A notebook's folder identity tells two folders apart even when they hold the same notebook. On Windows, it is the volume serial number and the 128-bit file ID of the notebook folder. On other platforms, it is the device and inode numbers. The notebook key is the notebook ID, a `-`, and the first 8 hexadecimal digits of the SHA-256 hash of the folder identity.

- A copied notebook has the same ID but a different folder identity. It therefore gets its own key, and never shares a journal, lock, view state, or cache with the original.
- Each journal header records the folder identity. Recovery replays a journal only into the folder whose identity matches.
- If two open notebooks have the same notebook ID, the second one opens read-only. It offers "Make this a separate notebook", which gives it a new notebook ID. Page IDs stay the same, so links inside the copy keep working.
- A notebook moved to another drive gets a new folder identity. If journals exist under another key with the same notebook ID, and the folder they record no longer holds that notebook, the app asks before it recovers them. It never does so on its own.

### 20.3 Locks and liveness

- Each open notebook holds an exclusive lock on `locks/<notebook key>.lock` (`LockFileEx` on Windows, `flock` elsewhere). The operating system releases it when the process ends, so a crash never leaves a stale lock. A second process opens the notebook read-only, with "This notebook is open in another OpenNote window."
- For a notebook on a network drive, the writer also locks `.opennote/lock` inside the notebook, because network file systems enforce such locks across computers. It does not use this file on local drives, where sync tools would upload it and complain that it is in use.
- A writer holds an exclusive lock on every journal generation it appends to. Recovery first tries to take that lock. If it can't, the owner is still running, and recovery leaves the journal alone. The `session.json` marker is never trusted for this.

### 20.4 Journal files and generations

A journal generation is one file of records based on one saved revision of a page. Its name is `<page ID>-<generation>.wal`, where the generation is 16 lowercase hexadecimal digits. At most 2 generations of a page normally exist, and 3 for a moment during rotation. More can build up while saves stay unconfirmed (section 20.9).

Numbers never restart while older files exist:

- A new generation's number is one more than the highest generation of that page in the folder, whatever state that file is in.
- Sequence numbers continue from the highest one in any existing generation of the page, counting both header anchors and records.
- Before a page opens for editing, the writer runs recovery (section 20.10) on every existing generation of that page. If a generation cannot be recovered yet, because it is from a newer app version, unreadable, or waiting for its notebook, the page opens read-only until it can.

The tree journal of a notebook, `tree-<generation>.wal`, uses the same framing and holds tree intents.

### 20.5 The journal header

| Offset | Size | Field |
|---|---|---|
| 0 | 8 | Magic `89 4F 4E 4A 0D 0A 1A 0A` |
| 8 | 2 | Journal version, `1` |
| 10 | 2 | Flags, `0` |
| 12 | 4 | Header length in bytes, including the final CRC-32 |
| 16 | 16 | Notebook ID |
| 32 | 16 | Page ID. Zero in a tree journal |
| 48 | 16 | Base revision: the revision of `page.json` these records apply to. Zero in a tree journal |
| 64 | 8 | Generation (`u64`) |
| 72 | 8 | Anchor sequence number. Every record in this file has a larger one |
| 80 | 8 | When the file was created, in Unix milliseconds (`i64`) |
| 88 | 2 | The page format version of the records' operations |
| 90 | 2 | Reserved, zero |
| 92 | 4 | Metadata length |
| 96 | 4 | Base snapshot length |
| 100 | varies | Metadata JSON: `notebookPath`, `notebookIdentity`, `app`, `device`, and `boot`, the operating system's boot identifier when the file was made |
| next | varies | Base snapshot: gzip of the exact `page.json` bytes of the base revision. Empty in a tree journal |
| end − 4 | 4 | CRC-32 of every header byte before it |

The base snapshot makes each generation complete on its own. Even if a sync tool replaces or deletes `page.json` while the app is closed, recovery can rebuild this device's version from the journal alone.

### 20.6 Records

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | CRC-32 of bytes 4 to 24 + payload length − 1 |
| 4 | 4 | Payload length, at most 64 MiB |
| 8 | 8 | Sequence number (`u64`): one more than the page's previous record |
| 16 | 1 | Kind: 1 `Txn`, 2 `SaveBegin`, 3 `InkProgress`, 4 `TreeIntent`, 5 `TreeDone`, 6 `Closed` |
| 17 | 1 | Flags. Bit 0 is reserved for an encrypted payload in encrypted sections. All bits are zero in version 1 |
| 18 | 2 | Reserved, zero |
| 20 | 4 | JSON length, at most the payload length |
| 24 | varies | JSON in UTF-8 |
| next | rest of payload | Blob: zero or more stroke records in the segment record format (section 9.2) |

A reader stops at the first record that is incomplete, is all zero bytes, fails its CRC-32, or does not have the expected sequence number. Everything after that point is ignored, copied to `recovery/` for diagnosis, and reported. A torn or zero-filled tail is expected after a power cut, and it is harmless.

### 20.7 Record contents

A `Txn` record holds one transaction: a group of operations that were applied together. Strokes travel in the blob and are named by index ranges, so ink is never inflated by JSON.

```json
{
  "txn": "01m3sa8z1czh26f1rsnav197pg",
  "at": "2026-09-30T14:07:41.100Z",
  "origin": "local",
  "client": "main-1",
  "ops": [
    {
      "op": "editText",
      "block": "01m3sa14y9zszek1wdk3snddsn",
      "splices": [
        {
          "at": 118,
          "del": "",
          "ins": " and b"
        }
      ],
      "stamps": ["2026-09-30T14:05:40.020Z", "2026-09-30T14:07:41.100Z"]
    },
    {
      "op": "addStrokes",
      "records": [0, 2]
    }
  ]
}
```

`origin` is `local`, `undo`, `redo`, or `recovery`. `client` names the window or editor that made the change. Every operation carries its preconditions, so a replay onto the wrong base fails loudly instead of damaging the page:

| Operation | Fields | Checked before it applies |
|---|---|---|
| `setPage` | `before`, `after`: only the changed page fields (title, tags, and view) | The current values equal `before` |
| `insertBlocks` | `blocks`: whole blocks as in `page.json` | The IDs are unused |
| `deleteBlocks` | `blocks`: whole blocks. `strokes`: the blob range holding every stroke of any deleted ink block | Each block exists and equals its stored copy |
| `moveBlock` | `block`, `before`, `after` (each an order key and a frame), `stamps` | The current placement equals `before`, and the block is not locked |
| `patchBlock` | `block`, `before`, `after`: JSON merge patches (Request for Comments (RFC) 7396) over `lock`, `data`, and `fallback`. `stamps` | The current values at every patched path equal `before` |
| `editText` | `block`, `splices` (each with `at`, a UTF-8 byte offset, and the text deleted and inserted), `stamps` | `at` falls on a character boundary, and the text there equals the deleted text |
| `addStrokes` | `records`: a blob range | The stroke IDs are unused, and their ink blocks exist |
| `removeStrokes` | `records`: a blob range of the whole strokes | Each stroke exists and equals its stored copy |
| `setStrokeProps` | `items`: each a stroke ID with `before` and `after` style, transform, and ink block | The current values equal `before` |
| `addAsset` | `asset`: the whole table entry, with its ID | The ID is unused, and the file exists with the stated size |
| `removeAsset` | `asset`: the whole table entry | No block refers to the asset |

`stamps` holds the block's `modified` time before and after the change, so undo restores it exactly. A blob range `[a, b]` means stroke records `a` to `b − 1`.

The other records:

| Kind | JSON | Blob |
|---|---|---|
| `SaveBegin` | `{"revision": <R'>, "throughSeq": <N>}`, written and flushed just before `page.json` is replaced (step S6) | None |
| `InkProgress` | `{"stroke": <stroke ID>}`, a copy of a stroke still being drawn | One stroke record with the points so far |
| `TreeIntent` | `{"intent": <ID>, "op": <name>, ...}`: the change (`createPage`, `createSection`, `movePage`, `duplicatePage`, `movePageToNotebook`, `moveSectionToNotebook`, `deleteToTrash`, `restore`, or `purge`), the IDs and folders it touches, and the steps already done | None |
| `TreeDone` | `{"intent": <ID>}` | None |
| `Closed` | `{"revision": <R>, "boot": <boot identifier>}`: the page was closed after a final save that was not confirmed (section 20.9) | None |

A later `addStrokes` with the same stroke ID replaces an `InkProgress` record.

### 20.8 Timing against the one-second budget

| Stage | Bound |
|---|---|
| Text edit to the core | At most 300 ms. The interface sends changed text 150 ms after typing pauses, and at least every 300 ms while typing continues |
| Stroke to the core | At pen-up. A stroke still being drawn after 500 ms also sends an `InkProgress` record every 500 ms |
| Moves and other gestures | At the end of the gesture. Gestures longer than 500 ms send an interim change every 500 ms |
| Core to journal file | Under 5 ms. The record is then in the operating system's cache and survives an app crash |
| Journal file to disk | A flush within 200 ms of the first unflushed record (group commit). A flush takes 1 to 30 ms on a solid-state drive (SSD), and up to 100 ms on a slow disk |
| Worst case, power cut | About 300 + 200 + 100 = 600 ms for text, and about 800 ms for a stroke |
| Worst case, app crash | About 300 ms for text, and 500 ms for a stroke |

`SaveBegin` and `TreeIntent` records are flushed at once, and so is every journal when a page closes, the app exits, or the system suspends. When the system shuts down, a writer flushes its journals before it starts any saves, because that is the fastest way to a safe state.

A writer also saves a page when it has been dirty for 10 seconds, or when its records since the last save pass 4 MiB. This bounds both the journal's size and the time recovery takes.

### 20.9 Rotation and deletion

Only the thread that appends to a journal rotates it, so no record can land in a generation that is about to go away.

Rotation follows a confirmed save of revision `R'` that covers the records up to sequence number `N`. It happens only if the current generation `g` is larger than 1 MiB. The thread then does these steps, with no appends in between:

1. Create generation `g + 1` with `create_durable`. Its base is `R'`, its anchor is `N`, and it holds the gzip of the `page.json` bytes just written.
2. Copy into it every record of generation `g` with a sequence number above `N`.
3. Send new records to generation `g + 1`.
4. Delete every generation older than `g`. Generation `g` stays until the next rotation, as a second safeguard.

An unconfirmed save never rotates or deletes a generation. When a page closes, its final save decides what happens:

- After a confirmed final save, the writer deletes all the page's generations.
- After an unconfirmed final save, it appends a `Closed` record and keeps the generations. They are deleted once `page.json` is read back with that revision in a later boot of the operating system. After a reboot, whatever the file holds is on disk. If a power cut lost the save, the read-back shows the older revision, and recovery replays the journal.

The same rule applies when recovery finds nothing to replay. It deletes the generations only if the newest boot identifier they record, in a header or a `Closed` record, differs from the current one. Otherwise they stay until a confirmed save.

A tree journal starts a new generation, and deletes the old one, once every intent in it is done and it is larger than 64 KiB.

On a clean exit, every page closes as above, and `session.json` is marked stopped.

### 20.10 Recovery

Recovery runs before a notebook's first page opens. At start-up, the writer recovers the notebook that holds the start page first and the others in the background. It takes each notebook's lock first. For each page with journal generations:

1. If another running process holds a generation's lock, skip the page.
2. If any generation has a journal version above the reader's, leave that page's files alone. Open the page read-only with "Unsaved changes from a newer version of OpenNote are waiting. Open that version to recover them."
3. Read each generation's header and records, up to the end rule in section 20.6. A generation whose header fails its CRC-32 is kept in `recovery/` and skipped.
4. Load `page.json`. The result is the page, missing, damaged, newer, or unavailable (offline or not downloaded).
5. Find the anchor: the latest generation whose base is the revision on disk, or the latest `SaveBegin` record for that revision. The anchor's sequence number is that generation's anchor, or that record's `throughSeq`.
6. If the page loaded and an anchor exists, collect the `Txn` and `InkProgress` records after the anchor, from that generation and later ones. Drop duplicates by sequence number (they must be identical bytes), and stop at the first gap. Apply each transaction with its checks. Turn each `InkProgress` stroke that never got its final `addStrokes` into a normal stroke. Save the page normally, with a history version whose reason is `recovered`, then close it as section 20.9 describes.
7. Otherwise, rebuild this device's version from the oldest readable generation's base snapshot and every record after it. Then:
   - If the page on disk is this version or one of its ancestors, save the rebuilt page. Nothing is lost.
   - If the page on disk is a different version, keep both. Copy the disk version to `.conflicts/<its revision ID>.json`, save the rebuilt page, and show the conflict (section 14.1).
   - If the page on disk is damaged, move it to `.damaged/`, then save the rebuilt page.
   - If the page is missing, look for its folder by ID in other sections and in Trash, and recover it there. If it is nowhere, create it again where the journal says, and tell the person the page was restored from unsaved changes.
   - If the page is newer or unavailable, wait. The generations stay.
8. Roll forward every tree intent without a `TreeDone` record. Then run the scan (section 18.3).

### 20.11 Replay rules and notices

Replay never guesses. If an operation's check fails, replay stops at that operation. The writer saves what applied before it. The rest goes to `recovery/<page ID>-<time>.json` as readable JSON, with "Some changes couldn't be applied automatically. They are saved in a recovery file." This should never happen, and OpenNote's crash tests treat it as a failure.

Recovery can run again safely. Generations are deleted only after the recovered page is saved and confirmed, so a crash during recovery simply repeats it.

When recovery ends, the person sees a quiet notice, such as "OpenNote closed unexpectedly. Your notes were restored," or "Changes up to 2:03 PM were recovered." Undo history is not recovered.

### 20.12 When the journal can't help

| Situation | What the writer does |
|---|---|
| The journal cannot be written, for example because the system drive is full | It saves each changed page 1 second after every change, even during continuous typing, and shows "OpenNote can't protect unsaved changes right now, because it can't write to its app data folder." |
| The notebook is not available at start-up | The journals stay. The app lists them, as in "Unsaved changes are waiting for Biology. Connect the drive that holds it." After 90 days it offers to export the rebuilt pages to a new notebook |
| A journal from a newer app version | It is neither replayed nor deleted (section 20.10) |
| A damaged record in the middle of a file | Recovery stops there, and the records after it go to `recovery/` for diagnosis |

## 21. Security considerations

Notebooks can come from other people, so readers must treat every file as untrusted:

- Build paths only from IDs and checked asset names (section 2.10). Never follow links or junctions inside a notebook, and never read or write outside it.
- Check every limit in section 16 before allocating memory. Never trust a count in a file before checking it against the bytes that are really there. Cap the size of every gzip stream you decompress.
- Reject JSON with duplicate keys or deep nesting.
- Show Markdown only through the dialect in section 7. Treat HTML other than the allowed tags as text, never open links with unknown schemes, and do not load remote images without the person's consent.
- Never keep plain text of an encrypted section outside it: no readable copies, index entries, thumbnails, or cache entries (section 5.7).
- Never use a computer name or account name as a default device label (section 5.3).

## Appendix A: Constants

| Constant | Value | Section |
|---|---|---|
| Autosave after the last change | 1 s | 20.8 |
| Longest time a page stays dirty while editing continues | 10 s | 20.8 |
| Journal records since the last save that force a save | 4 MiB | 20.8 |
| Generation size before rotation | 1 MiB | 20.9 |
| Text sent to the core: after a pause, and at most | 150 ms, 300 ms | 20.8 |
| Progress of a stroke being drawn | From 500 ms, every 500 ms | 20.8 |
| Journal group commit | 200 ms | 20.8 |
| Busy retries | 5 ms, doubling to 640 ms (about 1.3 s) | 17.6 |
| Save retries | 1, 2, 5, 10, and 30 s, then every 30 s | 17.6 |
| Blocked saves: next try | On request, on focus, and every 5 min | 17.6 |
| Disk-full check | Every 30 s | 17.6 |
| Conflict-copy checks after a save | 5 s and 60 s | 17.9 |
| History versions while editing | Every 10 min | 13.2 |
| History per page | 50 MiB | 13.3 |
| Trash retention | 30 days | 12.4 |
| Wait before unreferenced segments and assets are deleted | 30 days | 19 |
| Temporary files and partial copies | 24 h | 19 |
| Tree-file conflict copies | 30 days | 14.3 |
| Damaged files | 90 days | 19 |
| Unavailable page entries | 30 days | 18.3 |
| "Some parts haven't arrived" notice | 10 min | 14.5 |
| Offer to export waiting journals | 90 days | 20.12 |
| Minor compaction | More than 8 segments | 8.4 |
| Major compaction | More than half the ink bytes dead, or more than 16 segments | 8.4 |
| Revision ancestors kept | 32 | 5.3 |
| Order key length before new keys | 64 characters | 2.8 |
| `index.md` rewrites | At most every 5 s | 11.4 |
| Migration backup sets per notebook | 3 | 15.4 |
| Notebook folder path before a warning | 90 characters | 3.5 |

## Appendix B: Test vectors and fixtures

### B.1 The CRC-32 check value

The CRC-32 of the 9 ASCII bytes `123456789` is `cbf43926`.

### B.2 A segment file

This 176-byte file holds the stroke from section 9.7. Its segment ID is `01m3sa8yempcnn2qgrtvppsafr`, its page ID is `01m3sa12426sg32pmtyffjaqcf`, and its stroke ID is `01m3sa8wb93eknedj0qexh7af2`.

```text
0000  89 4f 4e 4b 0d 0a 1a 0a 01 00 00 00 01 00 00 00   magic, version 1, flags 0, 1 record
0010  01 a0 f2 a4 79 d4 b3 2b 51 5e 18 d6 ed 6c a9 f8   segment ID
0020  01 a0 f2 a0 88 82 36 60 31 5a 9a f3 df 25 5d 8f   page ID
0030  d4 79 a4 f2 a0 01 00 00 00 00 00 00 a6 bd a9 4b   created 1790777260500, reserved, header CRC-32
0040  4a 6c 22 87 01 00 00 00 5c 00 00 00 01 a0 f2 a4   record CRC-32 87226c4a, kind 1, body length 92, stroke ID
0050  71 69 1b a7 57 36 40 bb bb 13 a9 e2 01 a0 f2 a0   stroke ID (end), ink block ID
0060  88 82 57 bc 45 6f 79 f8 fd d2 c3 b2 69 71 a4 f2   ink block ID (end), start time
0070  a0 01 00 00 00 01 05 00 2b 25 21 ff 00 00 00 40   start 1790777258345, pen, Ink, flags 0x0005, color, width 2
0080  80 02 00 00 00 05 00 00 d0 02 00 00 a0 05 00 00   bounding box: 640, 1280, 720, 1440
0090  03 00 00 00 80 0a 80 14 80 80 02 00 40 80 01 bc   3 points, point data
00a0  14 2a 60 c0 01 dc 1e 29 a0 a2 45 c4 4f 4e 4b 45   point data (end), footer CRC-32 c445a2a0, ONKE
```

### B.3 A journal record

A `SaveBegin` record with sequence number 1044, for revision `01m3sa8yf8bryf28a7sjgb7mmc`, covering records through 1043. Its JSON is `{"revision":"01m3sa8yf8bryf28a7sjgb7mmc","throughSeq":1043}`, which is 59 bytes, and its CRC-32 is `55725d23`.

```text
0000  23 5d 72 55 3b 00 00 00 14 04 00 00 00 00 00 00   CRC-32, payload length 59, sequence 1044
0010  02 00 00 00 3b 00 00 00 7b 22 72 65 76 69 73 69   kind 2, flags 0, JSON length 59, {"revisi
0020  6f 6e 22 3a 22 30 31 6d 33 73 61 38 79 66 38 62   on":"01m3sa8yf8b
0030  72 79 66 32 38 61 37 73 6a 67 62 37 6d 6d 63 22   ryf28a7sjgb7mmc"
0040  2c 22 74 68 72 6f 75 67 68 53 65 71 22 3a 31 30   ,"throughSeq":10
0050  34 33 7d                                          43}
```

### B.4 A readable copy

The `page.md` in section 11.1 is exact. Its checksum, `d69a2039`, is the CRC-32 of the file with the checksum written as `00000000`.

### B.5 Escaping

| Text | Written as |
|---|---|
| `5 * 3 = 15` | `5 \* 3 = 15` |
| `a == b` | `a \=\= b` |
| `Costs $5` | `Costs \$5` |
| `#biology and C#` | `\#biology and C#` |
| `snake_case and _draft` | `snake_case and \_draft` |
| `[draft]` | `\[draft\]` |
| `AT&T and &amp;` | `AT&T and \&amp;` |
| `x < y` | `x \< y` |
| `~5 minutes` | `\~5 minutes` |
| `{note}` | `\{note}` |
| `1. Not a list`, as a paragraph line | `1\. Not a list` |
| `- not a bullet`, as a paragraph line | `\- not a bullet` |
| A paragraph line that starts with a space | `&#32;` and then the rest of the line |

### B.6 Fixtures

The folder `docs/format/fixtures/` holds files that every implementation tests against:

| Folder | Contents |
|---|---|
| `notebooks/v1/` | A small notebook written by the version 1 writer, never changed after release. Each later version adds its own folder |
| `ink/` | Segment files with their decoded strokes as JSON, including damaged files and their expected reports |
| `journal/` | Journal generations with the pages recovery must produce |
| `markdown/escape/` and `markdown/documents/` | The conformance fixtures of section 7.8 |
| `readable/` | Pages with their exact `page.md`, `ink.svg`, and `index.md` |
| `reading-order/` | Pages with the reading order of section 6.2 that a reader must find |

The folder `docs/format/tools/` holds `read_opennote.py`, a reference reader written with only the Python standard library. It turns a notebook into Markdown and SVG files, and its test runs it against the fixtures. It shows that this specification is enough to read a notebook without OpenNote's code.

## Appendix C: Change log

| Version | Date | Changes |
|---|---|---|
| 1 | 2026 | First version |
