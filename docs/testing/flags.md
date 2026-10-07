# Flag check

Flags keep unfinished features out of the build people receive. A flag that nothing reads looks like a feature but does nothing, so a test fails when one appears. The test is `app/src/app/flagUsage.test.ts`. It runs with the unit tests in CI.

## What it checks

- Every flag id named in a `FlagId` union has a definition in a `flags.ts` file. An id with no definition is always off, with no one the wiser.
- Every registered flag is read somewhere in the app source or in the Rust source. A read is the id in quotes, such as `isEnabled('page.images')` or `flag: 'page.images'`. A file that builds ids from a prefix, as `tools.${tool}` does, also counts when it names the suffix.
- Each flag is registered once.

## When it fails

- Read the flag where the feature starts: a command's `flag`, a registry item's `flag`, `useFlag`, or `isEnabled`.
- If the feature is not built yet, remove the flag and its `FlagId` until it is, or add it to `WAITING` in the test with the reason. The list is the honest record of what is promised and not built.
- Never leave a flag unread to hide a feature. A feature that is not ready stays hidden, not shown disabled.

## Flags that wait for their feature

`WAITING` in the test holds them. Today they are the per-user Installed apps entry, resuming an update download, deck import and export, exam countdowns, the timetable, Open with OpenNote for single files, Share as a file, the local API, the dictionary tool window, and display-size image renditions.

`page.imageRenditions` waits for spike S3. The flag stays off in every channel. The ADR on paste and images says it turns on only if that spike shows images above their share of memory.

## Flags removed

`settings.penAndInk` and `settings.privacyAndAi` were removed because the pen settings (Pen and touch, under `ink.palm`) and the Privacy section (under `privacy.panel`) are built under their own flags. Four ink flags that were never built (`ink.delegatedTrail`, `ink.nativeTrail`, `ink.openSnapshot`, and `dev.penRecorder`) have no id either.
