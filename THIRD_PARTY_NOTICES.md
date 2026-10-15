# Third-party notices

OpenNote is Apache-2.0 (see [LICENSE](LICENSE)). The release also lists every npm package and Rust crate that is built into the exes in its software bill of materials, `OpenNote.sbom.cdx.json`. This file names the code that OpenNote depends on by a pinned source revision rather than a registry release, and keeps the notices that code asks to be kept.

| Component | Used for | Source and revision | License |
|---|---|---|---|
| `craft-print` | Sending a PDF to the system's printers: the in-process Windows XPS path and CUPS. Used by the `opennote-print` crate. | `https://github.com/storytold/craft-libs`, commit `8f5a2831614e632f91ad367f7af2a6e5b61b9529` | MIT OR Apache-2.0. OpenNote elects Apache-2.0. |
| `craft-winprint-gdi` (a dependency of `craft-print`) | Windows driver settings and printable geometry | `https://github.com/storytold/winprint.rs`, commit `417ac3c4d14d3da5485a99c7d5ce8f05664ec312` | MIT OR Apache-2.0. OpenNote elects Apache-2.0. |
| `winprint` (a dependency of `craft-print`) | Listing Windows printers and drawing a PDF into a print job | `https://github.com/storytold/winprint.rs`, commit `5f80b9baf6b58937c401656634e42d33f00ddf49`, a fork of `ArcticLampyrid/winprint.rs` | BSD-3-Clause. The notice is below. |

No code from these projects is copied into this repository. Cargo fetches each one at the commit above, and a change to a commit is a reviewed change to this file.

## craft-libs

Copyright (c) 2026 ArtCraft Team and the craft-libs contributors. Licensed under the MIT License or the Apache License, Version 2.0, at your option. OpenNote uses it under the Apache License, Version 2.0, the text of which is in [LICENSE](LICENSE).

## winprint

```text
BSD 3-Clause License

Copyright (c) 2021 - 2024, alampy.com

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
