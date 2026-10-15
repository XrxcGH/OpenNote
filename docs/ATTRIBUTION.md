# Attribution

This table names the author, source, and license of every picture, font, sound, model, and other non-code file in the repository, and of every vendored third-party crate. It does not list npm or Cargo dependencies; their licenses come from their own manifests.

A check keeps the table honest. `node checks/attribution.ts` (and `npm test`) fails when a tracked asset has no row, when a row matches no file, or when a vendored crate under `crates/third_party/` has no license file. Add the row in the same commit as the file.

## Contents

- [How to add a row](#how-to-add-a-row)
- [Assets](#assets)
- [Vendored code](#vendored-code)

## How to add a row

1. Put the path or a glob in backticks in the first column. `*` matches inside a folder and `**` matches across folders.
2. Name the author, the source (a link, or "this repository"), and the license.
3. For code copied from another project, keep its copyright and license text beside it in `crates/third_party/<name>/`, and add a row under [Vendored code](#vendored-code). Upstream projects that offer a choice of licenses are used under Apache-2.0.
4. Never add the name or logo of another product. Trademarks are not covered by a code license.

## Assets

| Path | Author | Source | License |
|---|---|---|---|
| `brand/**` | OpenNote contributors | This repository (the app icon, logo mark, and social preview) | Apache-2.0 |
| `app/src-tauri/icons/**` | OpenNote contributors | Rendered from `brand/app-icon.svg` | Apache-2.0 |
| `docs/design/images/**` | OpenNote contributors | This repository (design mockups drawn as SVG) | Apache-2.0 |
| `docs/screens/**` | OpenNote contributors | Captured from OpenNote by the screenshot job | Apache-2.0 |
| `docs/format/fixtures/**` | OpenNote contributors | This repository (sample notebooks for the file format specification) | Apache-2.0 |
| `tests/ui/visual/__screenshots__/**` | OpenNote contributors | Baselines captured from OpenNote by the visual tests | Apache-2.0 |
| `tests/fixtures/**` | OpenNote contributors | This repository (test inputs made for the tests) | Apache-2.0 |
| `app/src-tauri/src/images/fixtures/**` | OpenNote contributors | This repository (tiny generated images for the image conversion tests) | Apache-2.0 |
| `crates/core/fuzz/seeds/**` | OpenNote contributors | This repository (seed inputs for the fuzz targets) | Apache-2.0 |
| `crates/interop/tests/corpus/**` | OpenNote contributors | This repository (small samples written to resemble other apps' exports, with invented content) | Apache-2.0 |

## Vendored code

No third-party code is vendored yet. A crate copied into `crates/third_party/<name>/` gets a row here with its upstream address, revision, and license, and keeps its own license files.
| Path | Author | Source | License |
|---|---|---|---|
