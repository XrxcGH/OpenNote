# Third-party notices

OpenNote is Apache-2.0 (see [LICENSE](LICENSE)). The release also lists every npm package and Rust crate that is built into the exes in its software bill of materials, `OpenNote.sbom.cdx.json`. This file names the code that OpenNote depends on by a pinned source revision rather than a registry release, and code copied into this repository, and keeps the notices that code asks to be kept. Copied code also keeps its original notices beside it.

| Component | Used for | Source and revision | License |
|---|---|---|---|
| `craft-print` | Sending a PDF to the system's printers: the in-process Windows XPS path and CUPS. Used by the `opennote-print` crate. | `https://github.com/storytold/craft-libs`, commit `8f5a2831614e632f91ad367f7af2a6e5b61b9529` | MIT OR Apache-2.0. OpenNote elects Apache-2.0. |
| `craft-winprint-gdi` (a dependency of `craft-print`) | Windows driver settings and printable geometry | `https://github.com/storytold/winprint.rs`, commit `417ac3c4d14d3da5485a99c7d5ce8f05664ec312` | MIT OR Apache-2.0. OpenNote elects Apache-2.0. |
| `winprint` (a dependency of `craft-print`) | Listing Windows printers and drawing a PDF into a print job | `https://github.com/storytold/winprint.rs`, commit `5f80b9baf6b58937c401656634e42d33f00ddf49`, a fork of `ArcticLampyrid/winprint.rs` | BSD-3-Clause. The notice is below. |
| Metafile reader (WMF, EMF, EMF+) | Drawing the WMF and EMF pictures in imported Office files. Vendored in `crates/third_party/metafile`, with its license text (`LICENSE-APACHE`, `NOTICE.upstream`); changes are listed in `UPSTREAM.md`, and `src/svg.rs` is new. | `crates/metafile` of `https://github.com/storytold/deckcraft`, commit `9859da39`. Copyright (c) 2026 ArtCraft Team and the DeckCraft contributors. | MIT OR Apache-2.0. OpenNote elects Apache-2.0. |

No code from the printing projects is copied into this repository: Cargo fetches each one at the commit above, and a change to a commit is a reviewed change to this file. The metafile reader is the one copied component.

## craft-libs

The text of craft-libs' own NOTICE file, which Apache-2.0 section 4(d) asks to be carried with a redistributed work:

```text
craft-libs
Copyright (c) 2026 ArtCraft Team and the craft-libs contributors.
Licensed under the MIT License or the Apache License, Version 2.0, at your option
(LICENSE-MIT, LICENSE-APACHE).

The PDF spooler in crates/print is extracted from:
- PdfCraft, crates/print/src/spool.rs, windows_print.ps1 and spooler tests,
  revision 33c14e07cfd742a82bf03baa6b103c01008fa68c.
  https://github.com/storytold/pdfcraft
  Copyright (c) 2026 ArtCraft Team and the PdfCraft contributors.
  Licensed MIT OR Apache-2.0. PDF composition and application code are not copied.

The Windows printer duplex-capability query and parser additionally draw on PdfCraft,
crates/print/src/spool.rs, revision fb97ce958dfe92b6762ce40615c7836551710139 (PR #1154), under the same licenses above.

The native Windows backend (crates/print/src/windows.rs, ticket.rs and the printer-list and
Windows spooler tests) is ported from PdfCraft's native printing work, which carries the
approach of PdfCraft PR #599 (Win32 printer list, Windows.Data.Pdf into the XPS print API, the
PrintTicket and its driver-paper preference):
- PdfCraft, crates/print/src/spool/windows.rs, spool.rs and tests.rs, branch
  claude/native-windows-print-826c99 of PR #1132, revision a435117 (jcl-bit/printcraft).
  https://github.com/storytold/pdfcraft
  Copyright (c) 2026 ArtCraft Team and the PdfCraft contributors.
  Licensed MIT OR Apache-2.0.
```

That file also names craft-libs' other parts (color management, the PDF writer, the PDF reader with its vendored crates and fonts, and the icons). OpenNote depends on the `craft-print` crate only, so none of those is built into OpenNote.

## winprint

The fork's `LICENSE.md` is the upstream BSD-3-Clause text unchanged, with the one copyright line below. No source file in the fork has its own copyright or license header, and its README says it retains the upstream notices, so there are no other copyright holders to name. The `pdfium` feature of `winprint` (it downloads PDFium when the crate is built) is off: `craft-print` turns default features off, and nothing in OpenNote enables it. No PDFium is downloaded or bundled.

```text
BSD 3-Clause License

Copyright (c) 2021 - 2024, alampy.com

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Other crates the print path adds

`cargo metadata` on the new entries in `Cargo.lock` (72 crates over the previous beta lock) shows only permissive licenses: MIT, Apache-2.0, ISC, BSD-3-Clause, Zlib, BSL-1.0, and CDLA-Permissive-2.0 (the root certificate list in `webpki-root-certs`). None is copyleft. The `cargo deny` check in CI (see `deny.toml`) keeps it that way.

- Built into the Windows app, on top of what was already there: `winsafe`, `roxmltree`, `xml`, `strum` and `strum_macros`, `fmt-derive` and `fmt-derive-proc`, and `windows-core` and `windows-implement`. All are MIT or MIT OR Apache-2.0.
- Used only while `winprint` builds, never linked into OpenNote: `reqwest` and its TLS stack (`rustls`, `aws-lc-rs`, `aws-lc-sys`, `ring`, `webpki-root-certs`, `quinn`, and others), the `sigstore-*` crates and their X.509 helpers, and `tar`. They exist for the optional PDFium download, which is off. Building them needs CMake, which is why [CONTRIBUTING.md](CONTRIBUTING.md) lists it.
