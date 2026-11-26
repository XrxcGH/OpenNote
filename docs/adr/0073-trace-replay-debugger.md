# ADR 0073: Step debugging by recording and replaying, behind one Debug Adapter Protocol contract

- Status: Proposed
- Date: 2026-11-01

## Context

A step debugger normally pauses the program. In-app programs run in a worker that cannot block: the app is not cross-origin isolated (no COOP and COEP headers, and third-party embeds in `frame-src`), so `SharedArrayBuffer` and `Atomics.wait` are not available. JavaScript Promise Integration (JSPI) can suspend WebAssembly in Chromium 137 and later, but not in every webview the app targets (ADR 0055). Pyodide has `sys.settrace`; MicroPython's build does not; QuickJS through quickjs-emscripten exposes no debugger API; wasmoon has `debug.sethook`. Installed toolchains have Debug Adapter Protocol (DAP) adapters: gdb 14 and later, lldb-dap, debugpy, dlv (for Go), netcoredbg, Dart.

## Decision

We will give the debugger UI one contract, a subset of DAP. In-app runtimes implement it by **recording a bounded trace** while the program runs, capped at 20,000 steps or 32 MiB. Python records through `sys.settrace` in Pyodide, JavaScript and TypeScript through acorn-based instrumentation before QuickJS, and Lua through `debug.sethook`. The debugger then **replays** the trace. Breakpoints, conditions, logpoints, watches, step over, into, out, back, and reverse continue are computed on it. Changing a breakpoint re-runs the program with the same seed and stdin. Installed toolchains use their DAP adapters through the runner (ADR 0071). A live pause through JSPI is added later where available. C and C++ in the app have no step debugger.

## Options considered

| Option | For | Against |
|---|---|---|
| Record and replay behind DAP (chosen) | Works in every webview; step back for free; deterministic; one UI for tier 1 and tier 2 | Long programs are recorded only partly; no evaluation in a paused frame until live pause |
| Live pause with SharedArrayBuffer | True pause and debug console | Needs cross-origin isolation, which breaks embeds |
| Live pause with JSPI only | True pause | Not on every platform; the QuickJS and MicroPython builds cannot suspend |
| No in-app debugger | Nothing to build | Misses the owner's request |

## Consequences

- Easier: tier-2 adapters plug into the same panels; tests can assert on traces.
- Harder: instrumentation must map back to source lines (Sucrase keeps lines); previews must be bounded and safe to serialize.
- Follow-up: the trace format and caps, per-runtime recorders with known-answer traces (a recursive factorial's call depths, a loop's variable values), DAP framing tests for tier 2, keyboard and screen reader tests for the panels.
- Revisit when cross-origin isolation becomes possible without breaking embeds, or when JSPI is available on every target.
