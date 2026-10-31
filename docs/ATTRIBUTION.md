# Attribution

This table names the author, source, and license of every picture, font, sound, model, and other non-code file in the repository, and of every vendored third-party crate. It does not list npm or Cargo dependencies; their licenses come from their own manifests.

A check keeps the table honest. `node checks/attribution.ts` (and `npm test`) fails when a tracked asset has no row, when a row matches no file, or when a vendored crate under `crates/third_party/` has no license file. Add the row in the same commit as the file.

## Contents

- [How to add a row](#how-to-add-a-row)
- [Assets](#assets)
- [Vendored code](#vendored-code)
- [File format descriptions](#file-format-descriptions)

## How to add a row

1. Put the path or a glob in backticks in the first column. `*` matches inside a folder and `**` matches across folders.
2. Name the author, the source (a link, or "this repository"), and the license.
3. For code copied from another project, keep its copyright and license text beside it in `crates/third_party/<name>/`, and add a row under [Vendored code](#vendored-code). Upstream projects that offer a choice of licenses are used under Apache-2.0.
4. Never add the name or logo of another product. Trademarks are not covered by a code license.

## Assets

| Path                                                  | Author                                         | Source                                                                                                                | License     |
| ----------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------- |
| `brand/**`                                            | OpenNote contributors                          | This repository (the app icon, logo mark, and social preview)                                                         | Apache-2.0  |
| `app/src-tauri/icons/**`                              | OpenNote contributors                          | Rendered from `brand/app-icon.svg`                                                                                    | Apache-2.0  |
| `docs/design/images/**`                               | OpenNote contributors                          | This repository (design mockups drawn as SVG)                                                                         | Apache-2.0  |
| `docs/screens/**`                                     | OpenNote contributors                          | Captured from OpenNote by the screenshot job                                                                          | Apache-2.0  |
| `docs/format/fixtures/**`                             | OpenNote contributors                          | This repository (sample notebooks for the file format specification)                                                  | Apache-2.0  |
| `tests/ui/visual/__screenshots__/**`                  | OpenNote contributors                          | Baselines captured from OpenNote by the visual tests                                                                  | Apache-2.0  |
| `tests/fixtures/**`                                   | OpenNote contributors                          | This repository (test inputs made for the tests)                                                                      | Apache-2.0  |
| `app/src-tauri/src/images/fixtures/**`                | OpenNote contributors                          | This repository (tiny generated images for the image conversion tests)                                                | Apache-2.0  |
| `crates/core/fuzz/seeds/**`                           | OpenNote contributors                          | This repository (seed inputs for the fuzz targets)                                                                    | Apache-2.0  |
| `crates/intel/tests/fixtures/speech/*.wav`            | OpenNote contributors                          | This repository (short clips of sentences written for the speech tests, spoken by the Windows David and Zira voices)  | Apache-2.0  |
| `crates/intel-engines/tests/fixtures/**/*.onnx`       | OpenNote contributors                          | This repository (tiny models with made-up weights, written by `make_fixtures.py` beside them)                         | Apache-2.0  |
| `crates/interop/tests/data/slides/*.svg`              | OpenNote contributors                          | This repository (golden drawings of invented slides, written by the slide drawing tests)                              | Apache-2.0  |
| `crates/interop/tests/corpus/**`                      | OpenNote contributors                          | This repository (small samples written to resemble other apps' exports, with invented content)                        | Apache-2.0  |
| `app/src/theme/fonts/**`                              | The Atkinson Hyperlegible Next Project Authors | OpenNote Sans: Atkinson Hyperlegible Next with an open zero, built by `brand/fonts/open-zero.py` from the npm package | SIL OFL 1.1 |
| `npm:@fontsource-variable/atkinson-hyperlegible-next` | The Atkinson Hyperlegible Next Project Authors | https://github.com/googlefonts/atkinson-hyperlegible-next, bundled from the npm package                               | SIL OFL 1.1 |
| `npm:@fontsource/atkinson-hyperlegible-mono`          | The Atkinson Hyperlegible Mono Project Authors | https://github.com/googlefonts/atkinson-hyperlegible-next-mono, bundled from the npm package                          | SIL OFL 1.1 |
| `npm:@fontsource-variable/literata`                   | The Literata Project Authors                   | https://github.com/googlefonts/literata, bundled from the npm package                                                 | SIL OFL 1.1 |

Fonts reach the app through npm, so their rows start with `npm:` and name the package. The check compares them with the `@fontsource` packages in `package.json`. The copyright lines and the license text ship in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md), which the app shows under Settings, then About.

## Vendored code

A crate copied into `crates/third_party/<name>/` gets a row here with its upstream address, revision, and license, and keeps its own license files.

| Path                             | Author                                       | Source                                                                                                                | License                                  |
| -------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `crates/third_party/metafile/**` | ArtCraft Team and the DeckCraft contributors | https://github.com/storytold/deckcraft, `crates/metafile` at commit 9859da39255c0262cd592bb57101d7f2fa961f72 (v0.7.0) | MIT OR Apache-2.0, used under Apache-2.0 |

## File format descriptions

The Goodnotes, Notability, and Samsung Notes importers were written from public descriptions of those formats, and no code was read or copied. [ADR 0053](adr/0053-notes-app-import.md#decision) lists the sources, under "Clean-room", and says what each one gave.

## Tools that are built but not shipped

The cross-check job ([CHECKS.md](CHECKS.md#cross-checks)) builds `wordcraft-cli`, `gridcraft-cli`, `deckcraft-cli`, and `pdfcraft-cli` from the revisions in `tests/crosscheck/pins.json`. They are MIT OR Apache-2.0, used here under Apache-2.0. They run in continuous integration only; nothing from them is copied into the repository or shipped.

| Path | Author | Source | License |
| ---- | ------ | ------ | ------- |
