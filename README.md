# OpenNote

![OpenNote: writing, drawing, and recording in one open-source notebook](brand/social-preview.png)

An open-source note-taking application for Windows combining your favorite writing, drawing, and recording features for professional and personal applications. Windows comes first; macOS, Linux, iOS, and Android follow.

OpenNote is in early development. Phase 0 (the project foundation) is complete; see [DEVELOPMENT.md](DEVELOPMENT.md) for the plan.

## Documents

| Document | What it covers |
|---|---|
| [RESEARCH.md](RESEARCH.md) | Popular and rising note apps, the features people love, and the gaps OpenNote can fill |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Step-by-step plan for the Windows prototype, with tests and release gates |
| [BRAND.md](BRAND.md) | Colors, type, layout, motion, accessibility, and performance budgets |
| [Screens](docs/design/SCREENS.md) | Wireframes of each major screen, with sizes and keep-out zones |
| [FEATURES.md](FEATURES.md) | Feature spec: Office and Google, handwriting, transcripts, study tools, and more |
| [CHECKS.md](CHECKS.md) | The quality gate every file change must pass |

## Getting started

On Windows, install Node.js 22.18 or newer, Rust (through rustup), and the Microsoft C++ Build Tools. Then run:

```sh
npm install && npm start
```

That opens the OpenNote window in development mode. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full setup, scripts, and workflow.

## Contributing

```sh
npm run setup-hooks   # run CHECKS before every commit
npm run checks        # check your changes
npm test              # unit tests
```

CHECKS, lint, type-checks, tests, and a Windows build run in continuous integration on every push and pull request. OpenNote is licensed under the [Apache License 2.0](LICENSE).
