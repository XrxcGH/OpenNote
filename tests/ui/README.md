# Interface tests

Playwright tests of the production interface in a real browser. They run against `vite build --mode test`, which uses the web platform. See [playwright.config.ts](playwright.config.ts) for the projects.

## Contents

- [Layout](#layout)
- [Screen states](#screen-states)
- [The screenshot matrix](#the-screenshot-matrix)
- [Narrowing a run](#narrowing-a-run)
- [Baselines](#baselines)
- [What later phases add](#what-later-phases-add)

## Layout

| Folder | What it holds |
|---|---|
| `behavior/` | Specs for what the interface does. |
| `a11y/` | Axe and keyboard checks. `screens.spec.ts` visits every screen state, and `gallery.spec.ts` every gallery entry. |
| `visual/` | Screenshot specs: `matrix.spec.ts` for screens and `gallery.spec.ts` for components. |
| `screens/` | The screen states, one file for each area. |
| `perf/` | Timing specs. They are never retried. |

## Screen states

A screen state is a name, a description, and the way to bring the page into it: a path, a fixture, boot overrides, and an optional `prepare` step, such as opening a menu. A package lists its states in `screens/<area>.ts` with `defineScreens`. `loadScreens` in `screens.ts` finds every file, so no package edits a shared list, and it throws when two states share an id.

## The screenshot matrix

`matrix.ts` plans it. Every screen state is taken at each of four size classes (compact 400 wide, medium 720, expanded 1024, wide 1440) and in both themes, so one state gives eight pictures. A state may narrow itself with `sizes` or `themes`. A picture is named `<id>.<size>.<theme>`, for example `settings.general.compact.dark`, and that name is also its baseline's file name.

`matrix.ts` has no Playwright code, so `matrix.test.ts` checks the plan with plain Node: `npm run test:matrix`, which `npm test` runs too. `visual/matrix.spec.ts` takes the pictures.

## Narrowing a run

While a screen is being built, three variables narrow a run:

```sh
OPENNOTE_MATRIX_SCREENS=settings.,palette.commands OPENNOTE_MATRIX_SIZES=compact,wide OPENNOTE_MATRIX_THEMES=dark \
  npx playwright test --config tests/ui/playwright.config.ts visual/matrix
```

Screens are ids, or prefixes that end in a dot. A size or theme that does not exist is an error, so a typo never hides a screen.

## Baselines

Baselines come only from the `update-screenshots` workflow, so every one is taken on the same runner and browser as the checks that compare against it. The first 149 were taken by hand on a Windows laptop for the beta, so the workflow replaces them on its next run. Seven cells whose pictures changed between runs, in the context menu and rename error states, Settings about at medium size, and Privacy at compact size in the dark theme, have none yet. Until a picture has a baseline, a normal run skips it and says why, so a package that adds a screen is not blocked by a missing image. An update run never skips.

## What later phases add

Each phase adds `screens/<area>.ts` for its screens, and `app/src/dev/gallery/entries/<area>.gallery.tsx` for its components (see the [gallery's README](../../app/src/dev/gallery/README.md)). The screens for Privacy, Help and the self-check, the consent screen, crash report review, Send feedback, and safe start are in `screens/hardening.ts` (see [the diagnostics feature](../../app/src/features/diagnostics/README.md)).
