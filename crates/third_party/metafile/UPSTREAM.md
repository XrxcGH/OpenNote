# Upstream

This crate is vendored from `crates/metafile` in https://github.com/storytold/deckcraft at commit
`9859da39255c0262cd592bb57101d7f2fa961f72` (v0.7.0), which carries "DeckCraft metafiles (ported from WordCraft)".
Copyright (c) 2026 ArtCraft Team and the DeckCraft contributors. Licensed under the MIT License or the Apache
License 2.0, at your option; OpenNote elects the Apache License 2.0 (`LICENSE-APACHE` in this folder).

Changes made here:

- `Cargo.toml`: renamed, workspace inheritance replaced by explicit versions, lints dropped.
- `src/svg.rs`: new. Writes a `Picture` as an SVG document.
- `src/lib.rs`: declares `svg`.
