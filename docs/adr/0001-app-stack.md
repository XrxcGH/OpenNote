# ADR 0001: App stack

- Status: Accepted, pending the Phase 1 ink latency spike
- Date: 2026-09-30

## Context

OpenNote ships on Windows first. Later it must run on macOS, Linux, iOS, and Android, on screens from phones to wide monitors. The app stack decides how much code carries over to each platform, and it's the hardest choice to undo. The [research](../../RESEARCH.md#11-cross-platform--multi-screen-implications) compares the options, and the [development plan](../../DEVELOPMENT.md#2-technology-choices) lists the chosen tools.

The stack must provide:

- One codebase for the interface and the core logic on every platform, so a port means new adapters, not a rewrite
- A small download and low memory use: one `OpenNote.exe` of about 15 to 30 MB, and under 400 MB of memory with a 1,000-page notebook open
- Pen input with pressure and tilt, drawn within 25 ms end to end, as the [performance budgets](../../BRAND.md#10-comfort-and-performance-budgets) require
- A shared, portable core for the document model, storage, search, audio, and import, which the research suggests writing in Rust or C++
- A large pool of contributors and ready-made components, such as a rich text editor

## Decision

We will build OpenNote with:

- Tauri 2 as the app shell, using Microsoft Edge WebView2 on Windows
- Rust library crates for the core logic
- TypeScript, React, and Vite for the interface, with ink drawn straight to a canvas outside React to stay fast

Platform-specific features, such as pen input, audio capture, and optical character recognition (OCR), sit behind small Rust or TypeScript interfaces.

The decision stands only if ink passes the Phase 1 latency spike. If ink in WebView2 misses the 25 ms budget and can't be fixed, a new architecture decision record (ADR) switches the interface to Flutter before Phase 2. Each spike's result is recorded in an ADR, as [Phase 1](../../DEVELOPMENT.md#phase-1-spikes) requires.

## Options considered

| Option | For | Against |
|---|---|---|
| Tauri 2, Rust core, and a React interface (chosen) | Small installs and low memory. One codebase for desktop and mobile. The Rust core runs everywhere. The web offers the most contributors and components. | Ink runs in a web canvas, so latency needs care. Mobile support in Tauri 2 is newer. Each platform has its own web engine to test. |
| Flutter | One interface codebase for every target. Its custom canvas gives good ink latency, and Saber shows it works for handwritten notes. | Desktop feels less native. Fewer contributors know Dart, and there are fewer rich text and chart components. |
| Electron | Mature, with the same Chromium engine everywhere and a huge ecosystem | Each app bundles Chromium and Node.js, so downloads are large and memory use is high. Mobile needs a second app, as Joplin does with React Native. |
| WinUI 3 | The best pen input on Windows | Windows only, so every other platform would need a rewrite. The research advises against it for this reason. |
| Qt with C++ and QML | Mature, with very good ink latency on every target | Licensing and the mobile experience are harder. Fewer contributors know C++ and QML. |

## Consequences

- One Rust core and one interface serve every platform. Porting means writing new adapters for pen, audio, and OCR.
- The exe stays small because it uses the WebView2 that ships with Windows 10 and 11, instead of bundling a browser.
- Contributors need two toolchains, Node.js 22.18 or newer and stable Rust. On Windows, Rust also needs the Microsoft C++ Build Tools, as [CONTRIBUTING.md](../../CONTRIBUTING.md#set-up-on-windows) explains.
- Ink is the main risk. The Phase 1 spike measures pen-to-screen time with a Surface Pen and a Wacom tablet, using a 240 frames per second camera.
- Tauri uses WebKit on macOS and Linux, so later ports need their own ink and layout testing.

### Flutter fallback

If the spike fails, only the interface moves to Flutter. The plan for a Rust core stays, and Flutter would call it through a bridge such as flutter_rust_bridge. The design tokens in `brand/tokens.json`, the CHECKS gate, and the Rust lint and test steps in CI carry over. The token generator, the interface build, and the release workflow would need to change.

The switch would happen before Phase 2, while the interface is still an empty window and throwaway spikes, so little work would be lost. A new ADR would supersede this one and record the measurements.
