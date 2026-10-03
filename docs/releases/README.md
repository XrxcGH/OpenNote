# Release sign-offs

This folder holds one sign-off file for each release, named for its version, such as `1.0.0.signoff.json`. A sign-off file records the [release checklist](../DEVELOPMENT.md#10-release-checklist) items that only a person can check. The release workflow reads it, so it must be committed before the release is tagged.

## Creating one

Run this from the repository root:

```sh
npm run release:check -- --init
```

It writes a blank file for the version in the version files. Every entry starts empty, and an empty entry counts as not signed off. Fill in an entry only when you have checked the item yourself.

## What goes in it

Each entry has the name of the person who checked, and the day they checked it as `YYYY-MM-DD`. The day can't be in the future. Notes are optional.

| Entry | The checklist item |
|---|---|
| `budgets` | Every budget in BRAND.md section 10 passes on the reference laptop |
| `accessibility` | The keyboard and screen reader checklist passes |
| `pen` | Manual pen testing passes on at least two devices from the matrix |
| `upgrade` | Upgrading from the previous release keeps all notes and settings |
| `format` | File format changes include a tested migration and an updated specification |
| `updates` | Updating from each of the last three versions works, and so does going back |
| `docs` | The documentation is updated. The changelog is checked by the script |

The `pen` entry also lists the devices, at least two different ones. Each device has a `type` from the first column of the [device test matrix](../DEVELOPMENT.md#7-device-test-matrix) and a `name`:

```json
{
  "by": "Eric Dean",
  "date": "2026-10-20",
  "notes": "Tested with the Surface Pen and a Wacom Intuos.",
  "devices": [
    { "type": "Pen tablet PC", "name": "Surface Laptop Studio 2" },
    { "type": "Drawing tablet", "name": "Wacom Intuos" }
  ]
}
```

## Checking it

`npm run release:check` shows which items pass, which still need a sign-off, and why. The code that reads these files is in [app/scripts/release](../../app/scripts/release/README.md).
