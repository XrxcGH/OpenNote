# Code studio performance

The code studio has one budget for each thing a person can feel: opening it, typing, the completion list, the marks, starting a run, compiling C and C++, and memory. The budgets come from the code studio design (section 15). This page lists them, says how each is measured, and records the latest results. The code is in `tests/perf/codeStudio`.

## How to run it

- **Node gates.** `npm run perf:code-studio`. It bundles the studio's own modules the way the app bundles them and times them in a plain Node process, because the test runner's module loader makes parsers several times slower than the app. Pass `--only id,id` for some gates, `--skip-packs` to skip the Pyodide and clang gates (they load about 100 MB of WebAssembly), and `--machine "name"` to label the run.
- **Browser gates.** `npm run perf:code-studio:browser`. It builds the test app and drives it in Playwright (preview port 5691 by default, `OPENNOTE_CODE_PERF_PORT` changes it). `OPENNOTE_CODE_PERF_THROTTLE=4` slows the CPU, to stand in for the 4-core reference profile on a faster machine. It leaves `tests/perf/codeStudio/results/browser.json`, which the Node run reads for the table.
- **Model gates.** `npm run perf:code-studio:model`, with `OPENNOTE_LLM_MODEL` (one `.gguf` file) or `OPENNOTE_LLM_MODELS` (a folder with the files below) and the language model program built with its `llama` feature (`OPENNOTE_LLM_HOST` or `--host`). Without a model file the table says "not measured". Nothing is downloaded.
- **The table.** Every run prints the budget table, writes it to `results/code-studio.md`, and adds it to the job summary on Actions. The exit code is 1 when a gate failed. A gate that was not measured is listed as "not measured" and never hides.

## The nightly job

The `code-studio-perf` job in `.github/workflows/nightly.yml` runs the check that every gate can fail, the browser gates, the Node gates, and the model benchmark, on `ubuntu-latest` (4 cores). It keeps the JSON results for 90 days. A failure opens or updates the nightly issue. A hosted runner catches large regressions. The numbers that count are the reference laptop's.

## Every gate can fail

`npm run test:perf-code-studio` runs each Node gate for real with a delay injected into every timed section (`OPENNOTE_PERF_INJECT_MS`, optionally `OPENNOTE_PERF_INJECT_ONLY=id,id`) and asserts that the gate fails and shows the delay. The browser gates add the same delay to their measure. The model benchmark is tested against a stand-in program that speaks the same line protocol, with and without the delay. The same test checks that the table, this page, and the nightly job list every gate.

## Gates

| Gate             | Design | What                                            | Budget  | How it is measured                                                                                                                                          |
| ---------------- | ------ | ----------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| studio-open      | G-U1   | Studio open, first time in a session            | 400 ms  | Browser: from the click on the open command to an editable editor                                                                                           |
| typing-1000      | G-U2   | Typing in a 1,000-line file with diagnostics on | 16 ms   | Browser: key to screen (the key's time stamp to after the next frame), 95th percentile of 100 keys, best of three runs; the file has problem marks          |
| completion-list  | G-C1   | Completion list                                 | 50 ms   | Node: median of 15 cold samples in a 1,000-line Python file, best of three                                                                                  |
| pattern-ghost    | G-C2   | Pattern ghost text                              | 30 ms   | Node: the same, worse of automatic, and explicit                                                                                                            |
| syntax-marks     | G-D2   | Syntax marks after the pause                    | 100 ms  | Node: the layer's pause (50 ms) plus a syntax run on 1,000 lines; the slowest of Python, JavaScript, TypeScript, C, C++, Lua                                |
| checker-marks    | G-D2   | Checker marks after the pause                   | 400 ms  | Node: the layer's pause (300 ms) plus a checker run on 1,000 lines; the slowest language                                                                    |
| run-quickjs      | G-R1   | Run start, JavaScript, and TypeScript           | 300 ms  | Node: a hello program on a loaded QuickJS, Sucrase included                                                                                                 |
| run-micropython  | G-R1   | Run start, Python (MicroPython)                 | 300 ms  | Node: a hello program on a loaded engine                                                                                                                    |
| run-lua          | G-R1   | Run start, Lua                                  | 300 ms  | Node: a hello program on a loaded engine                                                                                                                    |
| run-sql          | G-R1   | Run start, SQL                                  | 300 ms  | Node: a one-statement script on a loaded engine                                                                                                             |
| run-pyodide-warm | G-R2   | Run start, full Python, warm                    | 300 ms  | Node: a hello program on a loaded Pyodide (the npm package stands in for the pack)                                                                          |
| run-pyodide-cold | G-R2   | Run start, full Python, cold                    | 3000 ms | Node: engine load plus the first hello program                                                                                                              |
| compile-c        | G-R4   | C compile, warm                                 | 1500 ms | Node: the compile step of a 200-line file, after the toolchain is loaded (the npm package stands in for the pack)                                           |
| compile-cpp      | G-R4   | C++ compile, warm                               | 1500 ms | Node: the same, with `iostream`, `string`, `vector`, and `algorithm` included                                                                               |
| idle-memory      | G-U3   | Studio idle memory                              | 60 MB   | Browser: the page's JavaScript heap after opening the studio, minus before, after two forced collections (run workers and the pack runtimes are outside it) |

Run starts use a loaded engine, the second run onward, because a warm worker is what the budget names. The Pyodide cold gate is the only one that times a load.

## Models

The code models of the design (section 7.4). The language model program answers once per request, so the first token is timed as a request for one token (the prompt's processing plus one token), over a prompt of about 400 tokens, median of five. The speed is the extra time a 65-token answer takes over the 1-token one, median of three. The speed budgets are set below the design's estimates (about 90 to 110 tokens per second for the 0.5B model and 30 to 35 for the 1.5B on the reference laptop) so a run on the 4-core, 8 GB profile has room.

| Gate                | Model                              | First token budget | Tokens per second, at least |
| ------------------- | ---------------------------------- | ------------------ | --------------------------- |
| model-0.5b          | Qwen2.5-Coder 0.5B Q8_0            | 500 ms             | 30                          |
| model-1.5b          | Qwen2.5-Coder 1.5B Q8_0            | 1200 ms            | 12                          |
| model-1.5b-instruct | Qwen2.5-Coder 1.5B Instruct Q4_K_M | 1200 ms            | 15                          |

## Results

### Surface Laptop Studio 2, busy

Measured on the development laptop while many other builds and tests were running (CPU load was high for the whole session), so every number is slower than a quiet laptop would give. Model files were not on the machine, so the model gates are not measured yet. The reference-laptop run and the 4-core, 8 GB profile are still to be recorded here (release R2).

| Gate                                        | Measured                               | Result                                   |
| ------------------------------------------- | -------------------------------------- | ---------------------------------------- |
| studio-open                                 | 370 ms                                 | pass                                     |
| typing-1000                                 | 22 ms (median 19 ms, script p95 12 ms) | **over the budget** on this busy machine |
| completion-list                             | 0.5 ms                                 | pass                                     |
| pattern-ghost                               | 0.5 ms                                 | pass                                     |
| syntax-marks                                | 59.5 ms                                | pass                                     |
| checker-marks                               | 310.7 ms                               | pass                                     |
| run-quickjs                                 | 1.2 ms                                 | pass                                     |
| run-micropython                             | 1.6 ms                                 | pass                                     |
| run-lua                                     | 0.8 ms                                 | pass                                     |
| run-sql                                     | 0.2 ms                                 | pass                                     |
| run-pyodide-warm                            | 7.3 ms                                 | pass                                     |
| run-pyodide-cold                            | 1379 ms                                | pass                                     |
| compile-c                                   | 77.6 ms                                | pass                                     |
| compile-cpp                                 | 1427 ms                                | pass, within 5% of the budget            |
| idle-memory                                 | 3.5 MB                                 | pass                                     |
| model-0.5b, model-1.5b, model-1.5b-instruct | not measured                           | no model file on the machine             |

What the results say:

- **Typing is the gate to watch.** The key's own script work is 12 ms at the 95th percentile, and the painted time adds the frame. On a busy 120 Hz laptop that is 22 ms. The gate stays at the design's 16 ms. The reference-laptop run decides whether the editor needs work, such as a lighter marks layer while keys are down.
- **C++ compile is close to its budget** because the standard library headers dominate. A run on a slower machine will fail it; that is the gate doing its job, and the answer would be precompiled headers in the toolchain pack.
- **Most Node gates have large room.** Run starts are a few milliseconds; the 300 ms budgets leave room for starting the worker, which this suite does not time.
