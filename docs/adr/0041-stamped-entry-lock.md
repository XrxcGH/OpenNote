# ADR 0041: Stamped entry lock lives in the page view, and the core enforces it

- Status: Proposed
- Date: 2026-10-15

## Context

Lab notebooks and records need "Lock entry" (A2-17, docs/FEATURES.md "Lock entry"): a page becomes read-only and carries the date and time it was locked, who locked it, and a hash of what it held. Unlocking is deliberate and leaves a trace in page history. The lock only prevents edits in OpenNote; anyone with the files can change them, and the PC's clock can be wrong, so this is not a tamper-proof seal. The note format (spec) should not need a new version for it, and older builds must keep the record when they save the page.

## Decision

The lock is a member of the page view in `page.json`, `view.entryLock`. It is an object with three members:

- `lockedAt`: RFC 3339, from the core's clock.
- `by`: a name of up to 200 characters, which the interface sends. It is the device's name in OpenNote.
- `hash`: `sha256:` and the hex SHA-256 of the page's content, each part labeled, and length-prefixed. The parts are the title, the Markdown of each text block in page order, the hash of each file, and the IDs of the live strokes.

The interface sets the lock with the ordinary `SetPage` edit and a merge patch on the view. The core replaces `lockedAt` and `hash` with its own, so the stamp can't name another moment or another content. While `view.entryLock` is an object, the core's resolver refuses every edit and every stroke with the read-only reason `lockedEntry`. The one exception is a `SetPage` whose view patch is exactly `{"entryLock": null}`.

Unlocking asks for a reason. The interface first names the current version in page history "Locked entry" with the lock's date. Then it names the version after the unlock "Unlocked: <reason>". Named versions are never pruned. A locked page shows a calm stamp banner and opens read-only. The layout "Lab notebook" offers Lock entry in its page menu as well as the palette.

Unknown view members already round-trip through `PageView.extra`, so older builds keep the record and the format version stays.

## Options considered

| Option | For | Against |
|---|---|---|
| `view.entryLock`, enforced by the core (chosen) | No format version change; round-trips in older builds; one place refuses edits for every client, including the local API | Older builds don't enforce it, though they keep it |
| A new top-level `lock` member in `page.json` with a spec change | Clearer in the spec | Needs a format version and a migration for one feature |
| Interface-only read-only state | Smallest change | Any other client, or a script through the API, could still edit a locked entry |
| Signing the hash with a per-device key | Shows who locked it | Needs key storage and a recovery story, and still isn't tamper-proof against the person who holds the key |

## Consequences

A locked entry can't be edited by mistake in this build, by the interface or the API. The stamp is honest about what it is: the help and the banner say the lock is not tamper-proof. A page edited outside OpenNote while locked keeps its lock, and its hash no longer matches its content; a later build can compare them and say so. Undo can't remove a lock, because the lock refuses every edit but its own removal, which the person picks from the banner or the palette.
