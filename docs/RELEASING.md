# Releasing OpenNote

This guide is for maintainers. It covers the one-time setup, version numbers, cutting a release, checking it, and undoing a bad one. The reasons behind this process are in [section 9 of the development plan](../DEVELOPMENT.md#9-distribution-and-updates). A build ships to beta or stable only after it passes the [release checklist](../DEVELOPMENT.md#10-release-checklist).

## Contents

- [One-time setup](#one-time-setup)
- [Versioning](#versioning)
- [Cutting a release](#cutting-a-release)
- [What the release workflow does](#what-the-release-workflow-does)
- [Verifying a release](#verifying-a-release)
- [When the release workflow fails](#when-the-release-workflow-fails)
- [Rolling back a bad release](#rolling-back-a-bad-release)

## One-time setup

Do these steps once per repository, before the first release that people will update from.

### Create the update signing key

The update key pair proves that an update came from OpenNote. The release workflow signs each `OpenNote.exe` with the private key. From Phase 2, the app checks that signature with the public key built into it.

1. Install the project tools with `npm install`. The Tauri command-line tool comes with them.
2. Generate the key pair:

   ```sh
   npx tauri signer generate -w ~/.tauri/opennote.key
   ```

   On Windows, write the path as `$HOME\.tauri\opennote.key` in PowerShell, or `%USERPROFILE%\.tauri\opennote.key` in Command Prompt. Otherwise the key can land in a folder named `~` inside the repository.
3. Choose a strong password when asked. The command writes the private key to `opennote.key` and the public key to `opennote.key.pub`.

Look after both files:

- Never commit the private key. The `.gitignore` file skips `*.key` files, but keep the key outside the repository anyway.
- Save the private key and its password in a password manager, with an offline backup. If either is lost, copies already installed can't accept any later update.
- Keep the public key. Phase 2 adds it to the app's updater config. It isn't secret.

If the private key leaks, generate a new pair. Ship one last release signed with the old key that carries the new public key. Then replace both secrets, so later releases are signed with the new key.

### Add the repository secrets

On GitHub, open the repository's Settings, then Secrets and variables, then Actions. Add two repository secrets:

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | The whole contents of `opennote.key`, a single line of text |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password you chose |

Open the key file in Notepad, select all, and copy it. Paste it exactly, with no space or line break before or after it, or the signing step fails with "failed to decode base64 secret key".

With the GitHub CLI, you can run `gh secret set TAURI_SIGNING_PRIVATE_KEY` instead, and paste the value when asked. Do the same for the password.

Only the "Sign the update" step of the release workflow receives these secrets. Without `TAURI_SIGNING_PRIVATE_KEY`, that step fails and the release stops, so a release is never published unsigned.

### Add code signing later

Code signing is optional and isn't configured yet. An Authenticode certificate, such as one from Azure Trusted Signing, names the publisher to Windows. Without it, SmartScreen warns people about an unknown app when they first run it.

This is separate from the update key. The update key convinces the app, and the certificate convinces Windows. The release checklist requires both before the first beta or stable release.

When you add it, sign the exe in a new step of the publish job, before "Sign the update". That keeps the certificate secrets out of the build job. Code signing changes the file, so the update signature and the hash must be made afterward.

## Versioning

OpenNote follows [semantic versioning](https://semver.org/): major.minor.patch.

| Change | Bump | Example |
|---|---|---|
| Fixes only | Patch | 0.4.0 to 0.4.1 |
| New features | Minor | 0.4.1 to 0.5.0 |
| Changes that break compatibility, such as a note format older versions can't read | Major | 1.4.0 to 2.0.0 |
| A beta before a release | Prerelease suffix | 0.5.0-beta.1, then 0.5.0-beta.2, then 0.5.0 |

Before 1.0.0, a minor version may also contain breaking changes.

The version lives in three files, and they must always match:

| File | Field |
|---|---|
| `package.json` | `"version"` |
| `app/src-tauri/Cargo.toml` | `version`, under `[package]` |
| `app/src-tauri/tauri.conf.json` | `"version"` |

To bump it, edit `app/src-tauri/Cargo.toml` and `app/src-tauri/tauri.conf.json` by hand. The `Cargo.toml` at the repository root has no version, so leave it alone. Then run these commands from the repository root:

```sh
npm version 0.5.0 --no-git-tag-version   # updates package.json and package-lock.json
cargo update --workspace                 # updates Cargo.lock to match Cargo.toml
```

Commit all five files together. The tag must be the same version with a `v` in front, such as `v0.5.0`. If the tag and the files differed, the app would report one version while the manifest announced another, so the updater would offer the same update again and again.

The release workflow prevents this with [check-version.ts](../app/scripts/check-version.ts). Its `version` job stops the release in seconds, before CI and the build run, when any of the three files doesn't match the tag. The unit tests in `npm test` also fail when the three files disagree with each other, so most mistakes show up in the pull request.

## Cutting a release

1. Check the [release checklist](../DEVELOPMENT.md#10-release-checklist). Every item must pass for a beta or stable release. Until the beta channel opens in Phase 13, releases are test builds, and some items, such as code signing, can't pass yet.
2. Bump the version on your branch, such as `phase-2`. Open a pull request to `main`. Merge it with a merge commit once CI passes and a reviewer approves.
3. Tag the merge commit on `main`, and push only that tag:

   ```sh
   git switch main
   git pull
   git tag -a v0.5.0 -m "OpenNote 0.5.0"
   git push origin v0.5.0
   ```

4. Open the Actions tab on GitHub, and watch the release run.

Avoid `git push --tags`. It pushes every local tag, and each new `v` tag can start its own release.

### Prereleases

A tag with a hyphen, such as `v0.5.0-beta.1`, makes a prerelease. The workflow marks the GitHub Release as a prerelease, and writes `beta.json` instead of `latest.json`. Stable copies read only `latest.json`, so they never see beta builds. Put the same version, such as `0.5.0-beta.1`, in the three version files.

## What the release workflow does

Pushing a tag that starts with `v` runs [release.yml](../.github/workflows/release.yml). It has four jobs: `version`, `ci`, `build`, and `publish`. Each job starts only when the one before it succeeds, and nothing is published until the last step of the publish job.

Each job gets only the permissions it needs, and no checkout keeps a GitHub token on disk. The version, build, and publish jobs pin their actions to full commit SHAs, with the version in a comment. Change the SHA and its comment together when you update an action. The actions in `ci.yml` use version tags instead.

### The version job

This job runs on `ubuntu-latest` and takes a few seconds. It checks that the tag, without its `v`, matches the version in all three version files, using [check-version.ts](../app/scripts/check-version.ts). If not, the release stops before CI runs. Like the jobs after it, except publish, it has read-only access and no secrets.

### The ci job

This job runs [ci.yml](../.github/workflows/ci.yml) on the tagged commit, so a release gets the same checks as a push to `main`:

- On Ubuntu and Windows: the design token check, type checks, lint, the format check, the unit tests, and CHECKS on all files.
- On Windows: rustfmt, Clippy, the Rust tests, and a debug build of the app.

The job can only read the repository, and it gets no secrets.

### The build job

This job runs on `windows-latest`. It can only read the repository, and it gets no secrets.

1. Check out the full history, and set up Node.js 22.
2. Set up stable Rust, and install the project tools with `npm ci`. There is no Rust build cache, so every release builds from a clean start.
3. Build with `npx tauri build --no-bundle`. This runs `npm run app:build` for the design tokens and the interface. It then compiles the Rust app in release mode into one exe, with no installer.
4. Copy `target/release/opennote.exe` to `dist-release/OpenNote.exe`, and keep it as a workflow artifact for one day.

### The publish job

This job runs on `windows-latest`. It's the only job that can write to the repository, and the only one that gets the signing secrets. It builds nothing and runs no install scripts, so the Tauri command-line tool is the only project dependency that runs next to the key.

1. Check out the repository, set up Node.js 22, and install the project tools with `npm ci --ignore-scripts`.
2. Download `OpenNote.exe` into `dist-release`.
3. Sign the update with `npx tauri signer sign --app-version`, followed by the tag without its `v`. This writes `OpenNote.exe.sig`. The version goes into the signature's trusted comment, which the signature covers, so nobody can change it without the private key. Only this step gets the two secrets. If `TAURI_SIGNING_PRIVATE_KEY` isn't set, it fails with an error.
4. Write the update manifest with [write-manifest.ts](../app/scripts/write-manifest.ts). It writes `latest.json`, or `beta.json` for a tag with a hyphen. The script stops if `OpenNote.exe.sig` is missing or empty, or if the signed version differs from the tag.
5. Publish a GitHub Release named after the tag, with every file in `dist-release`. Tags with a hyphen become prereleases. GitHub generates the release notes from the merged pull requests.

### The update manifest

The manifest holds these fields:

| Field | Contents |
|---|---|
| `version` | The tag without the leading `v` |
| `channel` | `stable`, or `beta` for a version with a hyphen |
| `notes` | For now, "OpenNote v0.5.0". The script uses a `RELEASE_NOTES` environment variable instead when it's set, but the workflow doesn't set one yet. |
| `pub_date` | When the manifest was written, just before the release was published |
| `url` | The download link for `OpenNote.exe` in this release |
| `size` | The size of the exe in bytes |
| `sha256` | The SHA-256 hash of the exe, in lowercase hexadecimal |
| `signature` | The contents of `OpenNote.exe.sig`. Its trusted comment names the same version as `version`. |

## Verifying a release

The release and its manifest go live as soon as the workflow finishes, with no draft step. Check the result right away, before you announce it:

1. Open the [releases page](https://github.com/XrxcGH/OpenNote/releases). The new release should list `OpenNote.exe`, `OpenNote.exe.sig`, and `latest.json` or `beta.json`. A beta should carry the Pre-release label.
2. Open the manifest. Its `version` should match the tag.
3. Download the release files into an empty folder with `gh release download v0.5.0`, or from the release page. In PowerShell, compare the hash, and show the signature's trusted comment:

   ```powershell
   $manifest = Get-Content .\latest.json -Raw | ConvertFrom-Json
   (Get-FileHash .\OpenNote.exe -Algorithm SHA256).Hash -eq $manifest.sha256
   [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($manifest.signature))
   ```

   Use `beta.json` for a beta. The hash test should print `True`. The `-eq` test ignores letter case, so the uppercase hash from `Get-FileHash` still matches. The last command prints the signature, and its `trusted comment` line should end with `version:0.5.0`. On macOS or Linux, compare the output of `shasum -a 256 OpenNote.exe` by eye, and read the signature with `base64 --decode < OpenNote.exe.sig`.
4. For a stable release, open the [latest manifest](https://github.com/XrxcGH/OpenNote/releases/latest/download/latest.json). The app's updater reads this address, so it should show the new version.
5. Run `OpenNote.exe` on Windows 10 or 11, ideally on a clean machine such as Windows Sandbox, which needs Windows Pro or Enterprise. The window should open and work. Until code signing is set up, Edge may warn that the file "isn't commonly downloaded", so choose Keep. SmartScreen may then show "Windows protected your PC". Select More info, then Run anyway.
6. Edit the release notes on GitHub. The generated notes list pull requests, so rewrite them for people who use the app.

## When the release workflow fails

If anything fails before the "Publish the release" step, nothing is published. The run's page shows which job and step failed. Common causes:

- The `ci` job fails when a check or test fails on the tagged commit. Fix the code.
- The `version` job fails when the tag doesn't match the three version files. Delete the tag, fix the files, and tag again.
- The "Sign the update" step fails when `TAURI_SIGNING_PRIVATE_KEY` isn't set, or when the key or password is wrong. Correct the secret as described in [Add the repository secrets](#add-the-repository-secrets).

For a one-off failure, such as a network error, or after you correct a secret, use "Re-run failed jobs" on the run's page. A re-run reads the secrets again. The publish job downloads the exe that the build job kept, and that copy expires after one day. If the download step fails, use "Re-run all jobs" instead.

If the code or the version files need a fix, merge the fix to `main` first. Then delete the tag, and tag the fixed commit with the same version:

```sh
git push origin --delete v0.5.0
git tag -d v0.5.0
git switch main
git pull
git tag -a v0.5.0 -m "OpenNote 0.5.0"
git push origin v0.5.0
```

If the publish step failed partway, delete the partial release on GitHub before you tag again. Only reuse a version when no complete release was published under it.

## Rolling back a bad release

The app never installs an older version on its own. Copies that already have the bad version keep it until a newer one comes out. So a rollback has two parts: stop the bad version from spreading, then publish a fix.

1. Stop the spread. On the release page, choose Edit, select "Set as a pre-release", and save. You can also run `gh release edit v0.5.0 --prerelease`. If the release must disappear completely, delete it with `gh release delete v0.5.0` instead. Keep the tag, so nobody reuses that version by mistake.
2. For a stable release, open the [latest manifest](https://github.com/XrxcGH/OpenNote/releases/latest/download/latest.json). It should show the previous version again. If not, edit the previous release, and select "Set as the latest release".
3. Fix the problem on a branch, and merge it to `main`. Bump the patch version, such as 0.5.0 to 0.5.1, then tag and push as usual. Every copy on 0.5.0 updates to 0.5.1.
4. Tell people what happened in the new release notes. If the bad version crashes, point them to the previous release to download by hand.

A bad beta is already a prerelease, and stable copies never see it. Publish the next beta with the fix, such as `v0.5.0-beta.2`.

Never move the tag of a published release, and never publish a rebuilt exe under the same version. Copies that installed the bad build would never be offered the fix, because the version number didn't change.

Once the updater from [section 9](../DEVELOPMENT.md#9-distribution-and-updates) ships, people can also go back to the previous version from Settings. The app does this by itself if a new version crashes twice in a row at start-up.
