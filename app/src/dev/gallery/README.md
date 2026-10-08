# Component gallery

A page that shows interface components in the states that matter, one address for each, so a screenshot test and an accessibility test can visit every one. It is for development and tests. The shipped app does not include it: the page is built only in test builds (`vite build --mode test`), and the bundle check never sees it.

## Contents

- [What it does](#what-it-does)
- [Public API](#public-api)
- [Adding an entry](#adding-an-entry)
- [Running it](#running-it)
- [How the tests use it](#how-the-tests-use-it)
- [What the UI wiring will need](#what-the-ui-wiring-will-need)

## What it does

- `gallery.html` loads `main.tsx`, which starts none of the app: no platform, no notes, no settings. It reads the theme, the density, and the entry from the address.
- With no entry in the address it shows the list, grouped by heading. With `?entry=<id>` it shows that one entry, in a frame marked `data-gallery-entry`.
- `window.__OPENNOTE_GALLERY__` lists the entries (`id`, `title`, `group`), so a test can walk them without importing app code.

## Public API

| Item | File | Use |
|---|---|---|
| `defineGallery(entries)` | `registry.ts` | Type-checks the list a file exports. |
| `GalleryEntry` | `registry.ts` | `id`, `title`, `group`, an optional `description`, and `render()`. `render` may call hooks. |
| `collectEntries(modules)`, `groupEntries(entries)` | `registry.ts` | Join the lists of every module, sorted. Throws on an id that repeats or is not lowercase words joined by dots. |
| `Gallery`, `galleryHref` | `Gallery.tsx` | The page, and the address of an entry. |
| `entries` | `entries.ts` | Every entry found in `entries/*.gallery.tsx`. |

The address takes three optional parameters: `entry` (an id), `theme` (`light` or `dark`), and `density` (`mouse` or `touch`).

## Adding an entry

Make a file in `entries/` named for your area and ending in `.gallery.tsx`, such as `entries/search.gallery.tsx`. Its default export is a list from `defineGallery`. Nothing else lists it: `import.meta.glob` finds the file, so two packages never edit the same file.

```tsx
import { defineGallery } from '../registry';
import { Button } from '../../../ui';

export default defineGallery([
  {
    id: 'search.result.empty',
    title: 'Search with no results',
    group: 'Search',
    description: 'The message when nothing matches, and the focus it leaves.',
    render: () => <Button>Clear search</Button>,
  },
]);
```

An id names a screenshot baseline and a link, so keep it stable. Text in an entry may be literal, because the lint rule for interface text skips `app/src/dev`.

## Running it

`npm run app:gallery` opens the page in the development server. The tests start it through the test build and `vite preview`.

## How the tests use it

- `tests/ui/a11y/gallery.spec.ts` runs axe on every entry in both themes and both densities. It needs no baselines, so a new entry is checked on the day it is added.
- `tests/ui/visual/gallery.spec.ts` takes a picture of every entry in the same four combinations. An entry with no baseline is skipped and says so, because baselines come only from the `update-screenshots` workflow.
- `Gallery.test.tsx` and `registry.test.ts` check the page and the registry.

## What the UI wiring will need

Nothing in the app imports this folder. Each later phase adds its own `entries/<area>.gallery.tsx` for the components it builds, with one entry for each state that looks different (empty, error, disabled, long text, touch density).
