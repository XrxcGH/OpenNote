# ADR 0088: The symbol dialog searches a subset of Unicode names generated at build time

- Status: Accepted
- Date: 2026-11-01

## Context

Word, Docs, OneNote, and Pages have a symbol dialog with search by name. OpenNote has only the 47 AutoCorrect entries. The Unicode Character Database (Unicode-3.0 license, allowed by `deny.toml`) has every name, but the full name list is about 2 MB.

## Decision

A build script generates a JSON of the blocks people use for symbols: punctuation, Latin-1 and Latin Extended letters with diacritics, Greek, Cyrillic, currency, letterlike symbols, number forms, arrows, mathematical operators, technical symbols, box drawing, geometric shapes, miscellaneous symbols, dingbats, and emoji. Each entry is a code point, its name, and its block. The JSON ships as a lazy chunk (budget 80 KB gzip) that loads when the dialog opens. Characters outside the subset can still be entered by code with Alt+X.

## Options considered

| Option | For | Against |
|---|---|---|
| Build-time subset (chosen) | Small, offline, searchable | A script to keep current with Unicode releases |
| The full database | Every character | About 10 times the size |
| `unicode_names2` on the Rust side | No build script | About 450 KB in the binary for everyone; a bridge call per search |

## Consequences

`app/scripts/unicode/` holds the generator and a pinned copy of the source data with its license. A test checks that the chunk stays under budget and that the data covers the code points named in the help.

The pinned source is `app/scripts/unicode/ucd-subset.txt`, one `code;NAME` line per assigned character in the subset's ranges, taken from Unicode 16.0 through the Unicode data that ships with Python (`extract-names.py`, run only to move the pin). `generate.ts` turns it into `app/src/features/page/symbols/symbolData.json`, about 150 KB raw and 34 KB gzip. The dialog imports the JSON dynamically, so it is its own chunk, and `app/bundle-budget.json` caps the group at 80 KB. The license text is beside the data (`LICENSE-UNICODE.txt`). A plain space is left out of the list, and the nonbreaking space and hyphens have their own commands.
