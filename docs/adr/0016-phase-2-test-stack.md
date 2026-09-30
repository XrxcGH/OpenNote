# ADR 0016: Phase 2 test stack and CI gates

- Status: Proposed
- Date: 2026-09-30

## Context

The Phase 2 exit gate asks for component tests for every control, and for keyboard-only end-to-end (E2E) tests of navigation. It also asks for automated accessibility checks, screenshot tests at each size class in both themes, theme tests, and the start-up and feedback budgets. The overlays use native `<dialog>`, `popover`, `inert`, and CSS anchor positioning, which jsdom doesn't implement.

WebView2 updates itself, including on CI runners. Shared CI runners vary too much for absolute start-up budgets, and no self-hosted runner on the reference laptop exists yet. The updater must be proven with real file swaps on Windows.

The project also doesn't download browsers or drivers during development. Tests use the browsers a machine already has: Microsoft Edge on Windows, and Google Chrome on GitHub's Ubuntu runners.

## Decision

We will test in these layers:

- **Logic:** Vitest 5 (`.test.ts`, in Node or jsdom) on Ubuntu and Windows.
- **Components:** Vitest 5 browser mode through `@vitest/browser-playwright` 5.0.2 (`.test.tsx`), on Ubuntu and Windows. Each test has axe-core 4.13 and a key-table section per component. A coverage test fails when an exported component has no test file.
- **Interface:** Playwright 1.63 against the production build with the web platform. It covers screenshots, axe, focus walks, snapshots of the Accessible Rich Internet Applications (ARIA) tree, geometry, and flash safety. It also covers forced colors, the pseudo-locale, and Event Timing under CPU throttling calibrated to the reference laptop. Screenshot baselines come only from a manual workflow on `windows-latest`.
- **End to end:** WebdriverIO 9.32's `remote()` client with tauri-driver 2.1.0 and a matching msedgedriver, run by `node --test`. Each spec gets a fresh profile, and keyboard-only specs can't use the pointer.
- **Rust:** `cargo test` with proptest, the ts-rs drift check, and the updater's real `self-replace` swap test on Windows on every pull request.

Component and Playwright tests drive installed browsers through Playwright channels, never downloaded ones: `msedge` on Windows, locally and on `windows-latest`, and `chrome` on `ubuntu-latest`. `OPENNOTE_BROWSER_CHANNEL` overrides the choice. CI fetches the msedgedriver that matches the runner's WebView2 Runtime, and installs tauri-driver with `cargo install`; developers who run E2E locally use the same two scripts.

Pull requests gate start-up on regressions against `main`: a median more than 25% and 100 ms slower fails. They gate feedback and frames on calibrated in-page timing. The exit gate's start-up and feedback budgets are proven by a recorded run on the reference laptop until a runner there exists.

Unit and component tests never retry. Playwright and E2E retry once and report flakiness. Performance checks never retry.

## Options considered

| Option | For | Against |
|---|---|---|
| The layered stack above, on installed browsers (chosen) | Every exit-gate item has an automated proof on Windows; overlays tested in a real engine; nothing downloaded | Five required jobs per pull request; Windows runner minutes; Edge updates can move screenshots |
| The same stack on Playwright's downloaded Chromium | Screenshots change only when Playwright does | Downloads a browser on every machine and runner; its engine differs from WebView2 more than Edge does |
| Component tests in jsdom | Fast | Can't prove `<dialog>`, `popover`, `inert`, anchor positioning, or focus behavior |
| WebdriverIO's full runner (`@wdio/cli` and adapters) | Conventions, reporters | Four more development packages for what `remote()` and `node --test` do |
| Absolute start-up budgets on every pull request | Simple rule | Noisy on shared runners; fails for reasons outside the change |
| Storybook for component screenshots | Popular | Heavy; a development-only gallery page does the job |

## Consequences

- Easier: reviewers see proof for each exit-gate item on every pull request, and flaky tests are tracked, not hidden. Contributors run every browser test without downloading anything.
- Harder: pull request time grows to about 12 minutes of wall time across parallel jobs. The msedgedriver must match each runner's WebView2.
- Harder: an Edge update on the runners can change screenshots without a code change. The tolerances absorb small rendering changes, and the manual workflow refreshes the baselines when Edge changes more.
- Follow-up work: the nightly workflow, `docs/perf/phase-2.md`, and the manual checklist file. The nightly workflow covers the full E2E set, the updater E2E, other architectures, and 200% text. It also records performance baselines and runs the frame probe and a canary with the NonVisual Desktop Access (NVDA) screen reader, both non-blocking.
- Revisit when a self-hosted runner on the reference laptop exists, which moves the absolute budgets into nightly CI, as DEVELOPMENT.md section 6 intends. Revisit the browser choice if Edge updates make screenshot baselines churn more than once a month.
