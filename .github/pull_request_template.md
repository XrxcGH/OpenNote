## Summary

<!--
What does this pull request change, and why? Link the issue it fixes, for example "Fixes #42".
GitHub closes the issue on merge only when the pull request targets main.
-->

## Phase

<!--
Name the branch this pull request targets and the phase items it covers, from
https://github.com/XrxcGH/OpenNote/blob/main/docs/DEVELOPMENT.md#5-phases
For a fix outside any phase, target main, and write "None" for the phase items.
-->

- Target branch: `phase-N`
- Phase items:

## How it was tested

<!--
List the commands you ran and the manual checks you did.
For UI or ink changes, name the Windows version and the input you tested: mouse, keyboard, touch, or pen.
-->

## Checklist

<!--
Check each item that applies. If one doesn't apply, leave it unchecked, and say why below it.
Run `npm run app:build` before the cargo commands, because the Rust app embeds the built UI.
-->

- [ ] CHECKS passes on every changed file: `npm run checks`.
- [ ] Lint, format, and type checks pass: `npm run lint`, `npm run format:check`, and `npm run typecheck`. Rust changes also pass `cargo fmt --all --check` and `cargo clippy --workspace --all-targets -- -D warnings`.
- [ ] Tests are added or updated, and `npm test` passes. Rust changes also pass `cargo test --workspace`. A bug fix adds a test that fails without the fix.
- [ ] Documentation is updated for anything this change affects.
- [ ] Visual changes include screenshots of the light and dark themes.
- [ ] UI code uses design tokens only, with no raw colors, fonts, font sizes, motion, or layers. To add or change a token, edit `brand/tokens.json`, and run `npm run tokens`.
