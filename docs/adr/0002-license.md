# ADR 0002: License

- Status: Accepted
- Date: 2026-09-30

## Context

OpenNote needs a license before outside contributions arrive. Changing it later means asking past contributors to agree, so it's hard to reverse. The [development plan](../DEVELOPMENT.md#13-risks) lists the license as a Phase 0 decision.

The license should:

- Let anyone use, change, and share OpenNote for free
- Welcome companies and individuals alike, as users, contributors, and reusers of the code
- Protect users and contributors from patent claims by the people who contribute
- Work with our dependencies, which are mostly under the MIT or Apache 2.0 license
- Allow the app to ship through app stores on every platform, including iOS

## Decision

We will license OpenNote under the Apache License 2.0. The full text is in the [`LICENSE`](../../LICENSE) file at the repository root. The root `package.json` and `app/src-tauri/Cargo.toml` declare `Apache-2.0`, and every new package or crate manifest must do the same.

Under section 5 of the license, contributions are accepted under the same license unless the contributor says otherwise. We don't need a separate contributor agreement for now.

## Options considered

| Option | For | Against |
|---|---|---|
| Apache 2.0 (chosen) | Permissive and familiar to companies. Every contributor grants a patent license, which ends for anyone who sues over patents in the code. Tauri and Rust both offer it. GPL-3.0 projects can reuse the code. | Longer than MIT. Changed files must say that they were changed. GPL-2.0-only code can't be combined with it. |
| MIT | Short, simple, and widely used, including by React and Vite | No explicit patent grant |
| GPL-3.0 | Keeps every copy and derived app open source, and includes a patent grant | Strong copyleft keeps many companies from using or contributing. The Free Software Foundation considers Apple's App Store terms incompatible with the GPL, which would complicate the iOS app. |
| Mozilla Public License (MPL) 2.0 | Changes to our files must stay open, while the code can still be combined with other code. Includes a patent grant. | Less familiar, and the per-file rules are harder for contributors and companies to follow |

## Consequences

- Anyone can use, change, and sell OpenNote or parts of it, including in closed-source products. We accept that a company could ship a closed version, in return for a wider community.
- Contributors grant a patent license for their contributions.
- New dependencies need licenses that work with Apache 2.0, such as `MIT`, `BSD-3-Clause`, `ISC`, or `Apache-2.0`. Libraries under the Mozilla Public License 2.0 are fine when used unchanged. Tauri already pulls in a few, such as `cssparser`.
- Adding a dependency under the GPL, Lesser GPL, or Affero GPL needs an architecture decision record (ADR) first.
- The repository owner can revisit this choice before outside contributions arrive. After that, a change needs agreement from contributors, and a new ADR would supersede this one.
