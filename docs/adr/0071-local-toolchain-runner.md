# ADR 0071: Running code with the person's installed toolchains

- Status: Proposed
- Date: 2026-11-01

## Context

Java, Kotlin, C#, Go, Rust, Swift, native C, and C++, Bash, PowerShell, Node, Deno, Dart, and PHP have no small offline WebAssembly toolchain, so they can run only through tools the person installed. Running local programs is a new power for the app: nothing in `app/src-tauri` or `crates` creates a Job Object or an AppContainer today, and the `windows` crate features in `app/src-tauri/Cargo.toml` lack `Win32_System_JobObjects` and `Win32_Security_Isolation`. The rules: nothing leaves the device without the person's action, the app works offline, code never runs on page open.

## Decision

We will add a Rust runner (`app/src-tauri/src/coderun/`). It works like this:

- It detects toolchains by fixed version commands.
- It asks for consent once per language on each device. It records the executable's path, size, and modified time, and asks again when they change.
- It runs fixed argument lists without a shell, in a device-local working folder (`%LOCALAPPDATA%\OpenNote\coderun\<project id>\`), with a minimal environment.
- It runs inside a Job Object (kill on close, memory, process count, CPU and wall time, UI limits), and caps output at 1 MiB per stream.
- It runs the program step inside an AppContainer with no capabilities, where the toolchain's files are readable from one, so the program has no network.

Where that is impossible (per-user installs, WSL), the consent screen says the language can reach the internet. OpenNote never changes permissions on the person's folders. On macOS the runner uses a `sandbox-exec` profile, and on Linux bubblewrap when it is installed. The runner also proxies the Debug Adapter Protocol and, later, language servers over stdio for detected adapters.

## Options considered

| Option | For | Against |
|---|---|---|
| A Rust runner with Job Objects, AppContainer and consent (chosen) | Real limits on Windows; honest about network; one place to audit | AppContainer cannot read per-user toolchains; platform-specific code for each OS |
| Start programs with plain `std::process::Command` | Simple | No memory or process limits; a fork bomb or a runaway allocation hurts the computer |
| Windows Sandbox or a virtual machine | Strong isolation | Not on Home editions; slow to start; needs the toolchain inside |
| Only in-app runtimes | No new power | Java, C#, Go and the rest stay unsupported |

## Consequences

- Easier: one consent model and one limits model for every installed language; DAP and LSP reuse the same process plumbing.
- Harder: detection quirks (the Microsoft Store Python aliases, WSL's `bash.exe`, MSVC's environment), first builds that need package caches (C#), and long compiles (Kotlin) must be handled and explained. The runner limits mistakes; it is not a malware sandbox, and the consent screen says the program runs with the person's own tools.
- Follow-up: tests with fake toolchains, a child killed past its memory limit, a process cap that stops a fork bomb, a socket refused inside the AppContainer, path validation shared with ADR 0069; the consent and toolchain screens; help pages per language.
- Revisit if Windows offers a simpler per-process network block, or if people ask to run with network on purpose (then a second, explicit consent).
