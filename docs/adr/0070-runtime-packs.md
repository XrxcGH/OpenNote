# ADR 0070: In-app language runtimes, bundled, or downloaded as packs

- Status: Accepted (code D1, D2, D3, and D8 as recommended)
- Date: 2026-11-01, accepted 2026-11-07

## Context

Major languages must run offline, in the existing sandbox (one worker per run, `lockDown()`, limits from the page). Runtimes differ by two orders of magnitude in size (measured, gzip): MicroPython 192 KB, QuickJS 231 KB, wasmoon (Lua) 111 KB, SQLite 408 KB, Sucrase 47 KB, Pyodide (CPython 3.14.2) 6.3 MB, ruby.wasm 9.0 MB, webR 12.3 MB, clang, and lld 27 MB. Licenses differ too: MIT, Apache-2.0, ISC, and MPL-2.0 can ship with an Apache-2.0 app; `@php-wasm/web` is GPL-2.0-or-later and R is GPL-2 or GPL-3. The app already downloads models with consent, an exact size, a SHA-256 pinned in the signed app and resumable transfers, and blocks downloads in Work offline and safe mode (`app/src-tauri/src/intel/models.rs`). Workers load their files over `connect-src`, which today allows `'self'`, `ipc:` and `opennote-asset:` (`app/src-tauri/tauri.conf.json`).

## Decision

We will bundle the small runtimes (MicroPython, QuickJS, Sucrase for TypeScript, SQLite, wasmoon, the WASI shim) as lazy assets. The large ones (Pyodide, clang, ruby.wasm, webR, and the code tools pack of ADR 0074) come as **packs**. A pack is a catalog entry of kind `runtime`, downloaded only after a dialog that shows its size. Its URL is pinned to an exact version on `cdn.jsdelivr.net/npm/<package>@<version>/`, and the app checks its size and SHA-256. Workers read packs through a new read-only scheme, `opennote-pack:` (`http://opennote-pack.localhost` on Windows), added to `connect-src`. Pyodide packages are packs too, with the SHA-256 from Pyodide's lock file. We will not bundle GPL code: PHP runs only through an installed toolchain (ADR 0071), and R through webR is a pack only if the owner accepts it as a separate program downloaded on request. The HTML preview of R3 adds `about:srcdoc` to `frame-src` for a sandboxed iframe without `allow-same-origin`.

## Options considered

| Option | For | Against |
|---|---|---|
| Bundle small, download large with consent (chosen) | Installer grows about 1 MB; full Python and C++ are one click away; same trust model as models | First use of full Python or C++ needs a connection once |
| Bundle everything | Works on first launch offline | About 60 MB more installer; GPL questions for R |
| Load runtimes from a CDN at run time | Tiny installer | Breaks "works offline" and "nothing leaves the device without the person's action" |
| Only MicroPython and QuickJS | Nothing new | Does not meet the owner's request for major languages |

## Consequences

- Easier: adding a runtime is a catalog entry plus a worker adapter with the same escape tests.
- Harder: pack versions must be bumped deliberately with new checksums; jsDelivr availability matters for first downloads. Code D3 chose jsDelivr only, pinned exactly; a mirror on the project's own release assets is added only if failures appear.
- Follow-up: `kind: "runtime"` in the catalog and in Settings, then Code, then Downloads; the `opennote-pack:` handler that serves only verified files with `application/wasm`; the CSP change and its test; notices for MPL-2.0 (Pyodide, with the source link), ISC and LLVM's license.
- Revisit when WebAssembly toolchains for Java, C# or Go become small enough for a pack.

## Implementation (code:L18)

- Catalog: `app/src-tauri/src/packs/catalog.rs` lists Pyodide 314.0.7 (5 files, 13,531,207 B), YoWASP Clang 22.0.0-git20542-10 (6 files, 105,495,211 B) and ruby.wasm 2.10.1 (`ruby+stdlib.wasm`, 30,635,497 B). Each file has its exact size and SHA-256, measured from the pinned jsDelivr version and equal to the SHA-256 jsDelivr publishes. webR is left out (code D4: installed R only). The code tools pack joins with ADR 0074.
- Pyodide packages: `generate-pyodide.mjs` reads Pyodide's lock file and writes `pyodide-packages.json`, 357 packs named `pyodide:<name>`. The SHA-256 is the lock file's. The lock file has no size, and the CDN sends no `Content-Length`, so the script downloads each file once, counts its bytes, and checks the SHA-256 before it writes the size. Dependencies use the lock file's normalized names.
- Downloads: packs are model specs of kind `runtime`, downloaded by the model downloader into this device's `packs` folder, with resume, the exact size as a cap, the SHA-256, cancel, and a refusal while Work offline or safe mode is on. The refusal reads "Work offline is on. Turn it off to download this pack." Commands: `packs_list`, `packs_download`, `packs_cancel`, `packs_remove`.
- Resume and jsDelivr: jsDelivr counts a range in compressed bytes, so it answers 416, or 206 from another byte, for most range requests. The HTTP source checks `Content-Range` and asks again from the start when a range answer can't be trusted. A broken range never corrupts a file; on jsDelivr, a stopped download usually starts over.
- Scheme: `opennote-pack` serves a file only when the catalog names its exact path, the file lies inside the packs folder after links are resolved, and its bytes match the size and SHA-256 when they are sent. It is read-only (GET and HEAD), sends `application/wasm` for `.wasm`, `nosniff`, and `no-store`.
- Interface: the Models panel (Settings, then On-device intelligence) has a Code group. It lists the packs and the code models of `catalog::CODE`, which code:L13a fills. `openCodeDownloads` opens it, so Settings, then Code, then Downloads links there.
- Open: loading pack JavaScript (`pyodide.mjs`, `bundle.js`) from a worker needs `script-src` for `opennote-pack:`, or a CSP on the worker response. The runtime lanes that load it change the CSP and its pinned test.
