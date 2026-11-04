# ADR 0072: Code completion and fixes with on-device code models only

- Status: Proposed
- Date: 2026-11-01

## Context

The owner wants completion of "the next most realistic thing a person would type", accepted with Ctrl+Tab while Tab only indents (owner decision of 2026-11-01; DESIGN 5.3.1), and help with fixing bugs. Copilot-style completion sends code to a server; OpenNote's rule is that nothing leaves the device without the person's action. The on-device stack has llama.cpp in its own process (`crates/llm-host`), but it only applies a chat template to a system and a user message, starts a new context per request, cannot stream or be canceled, and runs one request at a time (`app/src-tauri/src/intel/llm.rs`). The catalog has two general chat models, Qwen2.5 0.5B and 1.5B Instruct. Fill-in-the-middle (FIM) completion needs a raw prompt, stop strings, cancellation on every keystroke, and KV-cache reuse to be fast enough on a CPU. The 32-bit and ARM64 builds have no llama.cpp.

## Decision

We will compute every code completion, explanation, and fix on the device. Without a model, completion and fixes come from rules (DESIGN.md sections 7.1 and 10.2). The person can download a model after the existing consent dialog. Completion then uses Qwen2.5-Coder-0.5B base Q8_0 (531,068,128 B, Apache-2.0) by default, or the 1.5B base Q8_0 (1,646,573,056 B) for better results. Explanations and fixes use Qwen2.5-Coder-1.5B-Instruct Q4_K_M (1,117,320,768 B, Apache-2.0). Each model is pinned by repository commit and SHA-256. We will extend the host protocol with `Complete` (raw prompt, stop strings, time limit, cache reuse), `Cancel` and streamed `Partial` answers, and run code models in a second host process so completion never waits behind Ask. The cloud choice (`intel/cloud`) never applies to code. We accept only models whose licenses carry no use restrictions (Apache-2.0 or MIT).

## Options considered

| Option | For | Against |
|---|---|---|
| On-device rules plus optional on-device code models (chosen) | Private, offline, works on every build without a model | Smaller models suggest less than cloud services; needs host changes |
| A cloud completion service with the person's key | Strongest suggestions | Sends code off the device continuously; breaks offline; against the privacy rule |
| Reuse the general Qwen2.5 Instruct models | No new download | Not trained for FIM; worse at code |
| Larger models (Qwen2.5-Coder-3B, StarCoder2-3B, Mellum-4B) | Better suggestions | Qwen's 3B license is not Apache-2.0; StarCoder2's OpenRAIL-M has use restrictions; 4 GB is too much for the 8 GB reference laptop |

## Consequences

- Easier: completion and fixes keep working offline and on every build; the person sees which engine wrote a suggestion.
- Harder: llm-host gains streaming, cancellation, and cache management; two host processes can hold two models in memory, so the code host is reaped after 120 s idle like today's.
- Follow-up: protocol and host tests. Fill-in-the-middle prompts pass through without the chat template, cancel acts within one token, and cache reuse decodes only the tail.
- Follow-up: latency gates on the 4-core reference laptop (P50 at most 500 ms to ghost text with the 0.5B model), catalog entries of kind `code`, and a help page that states the privacy position.
- Revisit when a better Apache-2.0 code model of similar size appears, or if measured latency misses the gate (then the 0.5B becomes the only completion model and the 1.5B is for help only).
