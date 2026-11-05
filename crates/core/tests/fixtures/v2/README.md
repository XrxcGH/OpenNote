# Format version 2 migration fixtures

Each `<kind>.v1.json` is a version 1 file from the corpus in `docs/format/fixtures/nb/v1`. Its `<kind>.v2.json` is the expected result of the migration from version 1 to 2 in memory: the identity, with only `formatVersion` changed (spec 15.3, `R-VER-6`).

A version 2 writer saves each `<kind>.v1.json` back byte for byte, because the file uses nothing newer (`R-VER-1`, `R-VER-8`).

`page-font-span.v1.json` is a version 1 page whose text holds a font tag of version 2. `page-font-span.saved.json` is that page as a version 2 writer saves it: `formatVersion` 2, `minReaderVersion` 1, and no `minWriterVersion`, which equals `formatVersion` (`R-VER-2`, `R-STAMP-8`).

The test is `crates/core/tests/format_v2.rs`.
