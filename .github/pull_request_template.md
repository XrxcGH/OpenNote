## Summary

<!-- What does this pull request change, and why? Link the issue it closes, for example "Closes #42". -->

## Phase

<!--
Name the branch this pull request targets and the phase items it covers, from
https://github.com/XrxcGH/OpenNote/blob/main/DEVELOPMENT.md#5-phases
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

<!-- Check each item that applies. If one doesn't apply, leave it unchecked, and say why below it. -->

- [ ] CHECKS passes on every changed file: `npm run checks`.
- [ ] Lint, format, and type checks pass: `npm run lint`, `npm run format:check`, and `npm run typecheck`. Rust changes also pass `cargo fmt --all --check` and `cargo clippy --workspace --all-targets`.
- [ ] Tests are added or updated, and `npm test` passes. Rust changes also pass `cargo test --workspace`. A bug fix adds a test that fails without the fix.
- [ ] Documentation is updated for anything this change affects.
- [ ] Visual changes include screenshots of the light and dark themes.
- [ ] UI code uses design tokens only, with no raw colors, fonts, font sizes, motion, or layers.
