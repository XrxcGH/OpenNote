# Release scripts

These scripts make everything a release needs apart from the exes. That is the signatures, the update manifest, the release notes, the software bill of materials, the winget files, and the release checklist. [The release workflow](../../../.github/workflows/release.yml) runs them, and each one also runs by hand. The maintainer's guide is [docs/RELEASING.md](../../../docs/RELEASING.md).

## Contents

- [How the scripts fit together](#how-the-scripts-fit-together)
- [The scripts](#the-scripts)
- [Running them by hand](#running-them-by-hand)
- [Public API](#public-api)
- [Tests](#tests)
- [What the interface will need](#what-the-interface-will-need)

## How the scripts fit together

A release goes through these steps, in this order:

1. `check-version.ts` stops the release when the tag and the version files differ.
2. `checklist.ts` checks section 10 of the development plan.
3. The build job makes the three exes. `check-release-exe.ts` checks each one.
4. `sbom.ts` lists what is built into the exes.
5. `check-downloads.ts` checks that the package job got exactly the files the build and sbom jobs made.
6. `notes.ts` writes the release notes.
7. `sign.ts` signs each exe for the updater.
8. `write-manifest.ts` writes `latest.json`, or `beta.json` for a prerelease.
9. `checksums.ts` writes `SHA256SUMS.txt`.
10. `verify.ts` checks the finished folder the way a running copy of the app will.
11. `winget.ts` writes the winget files for a stable release.

The workflow publishes only after step 10 passes. A dry run does steps 1 to 11 with a throwaway signing key and publishes nothing.

## The scripts

| Script | What it does |
|---|---|
| `minisign.ts` | Verifies minisign signatures with Node's crypto, using the same rules as the updater in `crates/updater` |
| `pe.ts` | Tells whether an exe has an Authenticode signature, and asks Windows whether it is valid |
| `sign.ts` | Signs the exes with the Tauri command-line tool, with the real key or a throwaway one |
| `verify.ts` | Checks a release folder: manifest, sizes, hashes, signatures, and the version each signature names |
| `notes.ts` | Writes the release page and the short notes for the update notice |
| `versions.ts` | Compares semantic versions |
| `sbom.ts` | Writes a CycloneDX bill of materials. Its helpers are `sbom-imports.ts`, `sbom-npm.ts`, and `sbom-cargo.ts` |
| `winget.ts` | Writes the three winget manifest files from the release manifest and `app/winget.json` |
| `check-downloads.ts` | Checks the files the package job downloaded against the hashes the build and sbom jobs reported, and refuses any other file |
| `checksums.ts` | Writes `SHA256SUMS.txt` |
| `checklist.ts` | Answers each item of the release checklist. Its helpers are `checklist-doc.ts` and `checklist-signoff.ts` |
| `test-support.ts` | Test helpers: a throwaway signing key and a sample release folder |

The scripts have no dependencies of their own. They use Node 22.18 or newer, which runs TypeScript files directly, and the tools that `npm ci` installs.

## Running them by hand

The npm script `release:check` runs the checklist. Run the others with `node`, from the repository root:

```sh
npm run release:check -- --report
node app/scripts/release/notes.ts v1.0.0 --markdown notes.md --plain notes.txt
node app/scripts/release/sbom.ts 1.0.0 sbom.cdx.json
node app/scripts/release/sign.ts dist-release v1.0.0 --dry-run --pubkey-out dry-run/update.pub
node app/scripts/release/verify.ts dist-release v1.0.0 --pubkey dry-run/update.pub
```

`sign.ts` without `--dry-run` needs the `TAURI_SIGNING_PRIVATE_KEY` environment variable, and stops without it. A dry run ignores that variable and the password variable, so a real key in your shell is never used by mistake.

## Public API

Every function is pure unless its description says it reads files or runs a program.

- `minisign.ts`: `parsePublicKey(text)`, `parseSignature(text)`, `verify(data, signature, key)`, `verifyWithAny(data, signature, keys)`, `trustedFields(comment)`, `onlyField(comment, name)`. Both parsers take the base64 form that `tauri signer` writes or the plain minisign text.
- `pe.ts`: `hasAuthenticode(exe)` and `windowsSignatureStatus(path)`, which runs PowerShell on Windows.
- `sign.ts`: `signRelease({ dir, tag, env, dryRun, pubkeyOut, tauri })`. The `tauri` option replaces the command-line tool in tests.
- `verify.ts`: `verifyRelease({ dir, tag, keys, requireAuthenticode })` returns a list of problems, and nothing when all is well. `keysIn(dir)` reads the committed update keys, and `manifestName(version)` picks `latest.json` or `beta.json`.
- `notes.ts`: `markdownNotes(input)`, `plainNotes(input)`, `changelogSection(text, version)`, `changesBetween(previous, ref)`, `previousTag(tags, tag)`.
- `sbom.ts`: `buildSbom(input)` and `readInput(version, serial, timestamp)`, which runs `cargo metadata`.
- `winget.ts`: `wingetFiles(config, manifest, tag)` returns the file paths and their text. `configProblems(config)` checks `app/winget.json`.
- `check-downloads.ts`: `downloadProblems(dir, expected, options)` reads the folder and returns a list of problems, and nothing when all is well. `expectedFrom(env)` reads the hashes from `BUILD_SHA256` and `SBOM_SHA256`.
- `checklist.ts`: `evaluate(items, context)`, `textReport(results)`, `markdownReport(results, version)`, and `verdict(results, requireAll)`.

## Tests

Run them with `npm test`, or `npx vitest run --project unit scripts/release` from the `app` folder. Some tests use real tools. One signs and verifies a release with the Tauri command-line tool. One runs `git` in a temporary repository. One compares a signature made by the Tauri tool with our verifier. A test also reads the real checklist, and fails if an item has no check. Set `WINGET_VALIDATE=1` to run `winget validate` on the generated files.

## What the interface will need

Nothing in the app calls these scripts. When the interface is wired up, these are the pieces it reads:

- **Update notice.** The `notes` field of the manifest is plain text, at most 8 lines and 4096 bytes. The updater passes it on as `Offer.notes`. Show it as text, not Markdown, and show at most 8 lines.
- **What's new.** After an update, the app can show the same notes again. It can read the `notes` it saved with the offer, or the changelog entry for its version.
- **Open-source licenses.** The `OpenNote.sbom.cdx.json` file in each release lists every package with its license. A licenses screen in Settings, then About, can bundle or fetch it.
- **Going back.** The previous exe is kept by the updater. Nothing here changes that.

A copy installed with winget is a portable package, so it updates itself and winget does not know. See [the winget section of RELEASING.md](../../../docs/RELEASING.md#winget).
