# ADR 0080: The Rust side lists the device's fonts with fontdb, and the list never leaves the device

- Status: Proposed
- Date: 2026-11-01

## Context

A font picker must list installed fonts, as Word, OneNote, and Pages do. The app today offers 6 names in the styles dialog and "never lists installed fonts" (`app/src/features/page/styles/styleVars.ts`). Matching Word's line spacing also needs each font's metrics (OS/2 `usWinAscent` and `usWinDescent`), and exports need to know whether a font allows embedding (OS/2 `fsType`). The app runs on Windows (WebView2), macOS (WKWebView), and Linux (WebKitGTK) (ADR 0055).

## Decision

We will add the `fontdb` crate (MIT, with `ttf-parser`, MIT or Apache-2.0) to the app shell and expose one bridge command, `fonts_list`. It returns families with their faces, monospace flag, generic class, embedding permission, and metrics. The result is cached for the session. The interface never calls the Local Font Access API. The font list is kept out of logs, diagnostics, crash reports, and every network request.

## Options considered

| Option | For | Against |
|---|---|---|
| `fontdb` on the Rust side (chosen) | Same code on every OS; gives metrics and file paths; small, pure Rust; licenses allowed by `deny.toml` | A new dependency to keep current; scanning takes tens of milliseconds |
| Local Font Access API (`queryLocalFonts`) | No Rust code | WebView2 shows a permission prompt; WKWebView and WebKitGTK lack it; no `fsType` |
| Native APIs per OS (DirectWrite through the existing `windows` crate, Core Text, fontconfig) | No new crate on Windows | Three implementations to test, and fontconfig adds a C dependency |
| A fixed list of common fonts | No scanning | Not what the owner asked for |

## Consequences

`app/src-tauri/Cargo.toml` and `Cargo.lock` gain the crate, and `THIRD_PARTY_NOTICES.md` its notice. A benchmark holds the first call under 150 ms for 1,000 families on the reference laptop. Revisit if `fontdb` stops being maintained.

## Implementation notes

`fonts_list` takes an optional `refresh` flag and returns families sorted by name. Each family has a generic class (from `OS/2` `sFamilyClass`, then PANOSE) and a monospace flag; each face has its weight, style, stretch, `fsType` permission, units per em, `usWinAscent`, `usWinDescent`, `sTypoLineGap`, x-height, and cap height. A face installed twice counts once. The module writes no log line. Tests build small TrueType files from the OpenType table layouts, because the shipped fonts are woff2 and `fontdb` reads only TrueType and OpenType.
