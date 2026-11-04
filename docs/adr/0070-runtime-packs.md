# ADR 0070: In-app language runtimes, bundled, or downloaded as packs

- Status: Proposed
- Date: 2026-11-01

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
- Harder: pack versions must be bumped deliberately with new checksums; jsDelivr availability matters for first downloads (a mirror on the project's own release assets is a fallback the owner may choose, PLAN.md D3).
- Follow-up: `kind: "runtime"` in the catalog and in Settings, then Code, then Downloads; the `opennote-pack:` handler that serves only verified files with `application/wasm`; the CSP change and its test; notices for MPL-2.0 (Pyodide, with the source link), ISC and LLVM's license.
- Revisit when WebAssembly toolchains for Java, C# or Go become small enough for a pack.
