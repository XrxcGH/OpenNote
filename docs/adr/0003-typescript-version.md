# ADR 0003: TypeScript version

- Status: Accepted
- Date: 2026-09-30

## Context

The interface, the CHECKS quality gate, and the scripts that generate the design tokens and wireframes are written in TypeScript. ESLint lints them through typescript-eslint, which uses the TypeScript compiler to parse the code. CI runs `npm run typecheck` and `npm run lint` on every pull request.

TypeScript 7 is a rewrite of the compiler in Go, and it type-checks much faster. On 2026-09-30, the latest releases are TypeScript 7.0.2 and typescript-eslint 8.71.0. That version of typescript-eslint accepts TypeScript `>=4.8.4 <6.1.0`, so installing TypeScript 7 would break its peer dependency and leave linting unsupported.

## Decision

We will pin TypeScript to 6.0.x with `"typescript": "~6.0.0"` in `package.json`. The tilde allows patch releases, such as 6.0.3, but not 6.1 or 7.0.

We will upgrade to TypeScript 7 once a typescript-eslint release supports it.

## Options considered

| Option | For | Against |
|---|---|---|
| Pin 6.0.x (chosen) | Supported by typescript-eslint 8. Accepts any later 6.0 patch release. | Misses the faster TypeScript 7 compiler for now |
| Caret range `^6.0.0` | Picks up minor releases automatically | A future 6.1 release would fall outside the range typescript-eslint supports |
| TypeScript 7 now | Much faster type checks and editor feedback | typescript-eslint 8 doesn't support it, so the lint step would break |
| TypeScript 7 for type checks, 6.0 for linting | Fast type checks with working lint rules | Two compilers can disagree, and the setup is harder to explain and maintain |

## Consequences

- `package-lock.json` holds the exact version, and `npm update` can only move it to a later 6.0 patch release.
- Node.js runs the CHECKS scripts by stripping types, and Vite does the same for the app. The pin only affects type checking and linting.
- To see which TypeScript versions typescript-eslint supports, run `npm view typescript-eslint peerDependencies`.

### Upgrading to TypeScript 7

When a typescript-eslint release supports TypeScript 7:

1. Update `typescript` and `typescript-eslint` in `package.json`, and run `npm install` to update `package-lock.json`.
2. Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run checks:all`, and fix any new errors.
3. Write a new architecture decision record (ADR) that supersedes this one, and mark this one Superseded.
