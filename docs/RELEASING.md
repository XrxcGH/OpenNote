# Releasing OpenNote

This guide is for maintainers. It covers the one-time setup, version numbers, cutting a release, checking it, and undoing a bad one. The reasons behind this process are in [section 9 of the development plan](DEVELOPMENT.md#9-distribution-and-updates). A build ships to beta or stable only after it passes the [release checklist](DEVELOPMENT.md#10-release-checklist).

## Contents

- [One-time setup](#one-time-setup)
- [Versioning](#versioning)
- [Cutting a release](#cutting-a-release)
- [Trying a release with a dry run](#trying-a-release-with-a-dry-run)
- [Release files](#release-files)
- [What the release workflow does](#what-the-release-workflow-does)
- [Verifying a release](#verifying-a-release)
- [winget](#winget)
- [When the release workflow fails](#when-the-release-workflow-fails)
- [Rolling back a bad release](#rolling-back-a-bad-release)

## One-time setup

Do these steps once per repository, before the first release that people will update from.

### Create the update signing key

The update key pair proves that an update came from OpenNote. The release workflow signs each release exe with the private key. From Phase 2, the app checks that signature with the public key built into it.

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
- Keep the public key. It isn't secret. Commit it as `app/src-tauri/keys/update.pub`, and the build embeds it. Until it is there, every build keeps the updater off, and Settings, then Updates, says why.

If the private key leaks, generate a new pair. Ship one last release signed with the old key that carries the new public key. Then replace both secrets, so later releases are signed with the new key.

### Add the release environment and its secrets

GitHub runs the workflow file of the pushed ref, not the reviewed one on `main`. A repository secret reaches any workflow that asks for it, so anyone who can push a branch or a tag could read it. The signing secrets therefore live in an environment that only `v` tags may use, and only after a maintainer approves.

1. On GitHub, open the repository's Settings, then Environments, and choose New environment. Name it `release`.
2. Under Deployment protection rules, select Required reviewers, and add yourself and any other maintainer. Leave "Prevent self-review" off if you release alone. Clear "Allow administrators to bypass configured protection rules".
3. Choose Selected branches and tags under Deployment branches and tags. Add a rule of type Tag, with the pattern `v*`. Add no branch rule.
4. Under Environment secrets, add the two secrets:

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | The whole contents of `opennote.key`, a single line of text |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password you chose |

Open the key file in Notepad, select all, and copy it. Paste it exactly, with no space or line break before or after it, or the signing step fails with "failed to decode base64 secret key".

With the GitHub CLI, you can run `gh secret set TAURI_SIGNING_PRIVATE_KEY --env release` instead, and paste the value when asked. Do the same for the password. If the secrets were added as repository secrets before, delete those with `gh secret delete TAURI_SIGNING_PRIVATE_KEY` and `gh secret delete TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, so only the environment holds them.

Only the package and publish jobs use the `release` environment, and only for a pushed tag. Each waits for a reviewer's approval. Only the "Sign the updates" step of the package job receives the secrets, and that job can only read the repository. Without `TAURI_SIGNING_PRIVATE_KEY`, the step fails and the release stops, so a release is never published unsigned. A dry run uses no environment and never sees these secrets.

### Limit who can push version tags

Branch protection on `main` doesn't cover tags. Open Settings, then Rules, then Rulesets, and choose New ruleset, then New tag ruleset. Name it `Version tags`, set Enforcement status to Active, and add the target pattern `v*`. Select Restrict creations, Restrict updates, and Restrict deletions. Under Bypass list, add only the Repository admin role, or the maintainers who cut releases.

The release workflow also stops a pushed tag whose commit isn't on `main`, before CI runs.

### Create the beta channel

Copies on the Beta channel read their manifest from one fixed address, `https://github.com/XrxcGH/OpenNote/releases/download/channel-manifests/beta.json`, not from each beta's own release. The address is `BETA_MANIFEST_URL` in `crates/updater/src/config.rs`. The publish job uploads each beta's `beta.json` there. Create the prerelease that holds it once, before the first beta:

```sh
git switch main
git pull
gh release create channel-manifests --target main --prerelease --latest=false --title "Channel manifests" --notes "Holds beta.json for the updater's Beta channel. Don't download from here."
```

It must stay a prerelease, so GitHub never shows it as the latest release, and stable copies never read it. Don't delete it or its tag. The tag doesn't start with `v`, so it never starts a release run. Until it exists, a beta's run stops before it publishes anything, and its error names this section. Test builds never update it.

### Add code signing later

Code signing isn't configured yet. An Authenticode certificate, such as one from Azure Trusted Signing, names the publisher to Windows. Without it, SmartScreen warns people about an unknown app when they first run it.

A release needs it. The package job checks for an Authenticode signature on every exe, and stops a release without one. A test build, such as the tag `v0.3.0-test.1`, skips that check, and so does a dry run.

This is separate from the update key. The update key convinces the app, and the certificate convinces Windows. The release checklist requires both before the first beta or stable release.

When you add it:

1. Add the signing credentials as secrets of the `release` environment, such as the Azure Trusted Signing account, profile, and client credentials. Never add them as repository secrets.
2. Add a signing step to the package job in `.github/workflows/release.yml`, where a comment marks the spot, before "Sign the updates". Use the provider's official action, pinned to a full commit SHA with a version comment, and pass the secrets only to that step. It signs the three exes in `dist-release` in place. Give it the condition `github.event_name == 'push'`, so a dry run skips it.
3. Add the step only once the certificate exists, and make it fail the release if signing fails. Don't add a placeholder or a condition that skips it for a release: a release must never look signed when it isn't. GitHub also doesn't allow the `secrets` context in a step's `if:` condition. The check at the end of the package job fails the release if an exe has no Authenticode signature, or if Windows doesn't accept the certificate.

Keep every existing hardening property of release.yml: least permissions, `persist-credentials: false`, and secrets only in the step that needs them. Code signing changes the files, so the update signatures and hashes must be made afterward (they already are, in "Sign the updates").

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

1. Work through the [release checklist](DEVELOPMENT.md#10-release-checklist). Every item must pass for a beta or stable release. Run `npm run release:check` to see which items pass, which need your sign-off, and which can't be checked yet.
2. Record the items that need a person in `docs/releases/<version>.signoff.json`. Run `npm run release:check -- --init` to create a blank file, then fill in who checked each item and when. Pen testing also lists the devices, at least two, from the [device test matrix](DEVELOPMENT.md#7-device-test-matrix).
3. Add an entry for the version to [CHANGELOG.md](../CHANGELOG.md), such as `## [0.5.0] - 2026-10-14`. Write it for the people who use the app. It becomes the top of the release notes, and the update notice in the app shows its bullet points.
4. Bump the version on your branch, such as `phase-2`. Open a pull request to `main`. Merge it with a merge commit once CI passes and a reviewer approves.
5. Tag the merge commit on `main`, and push only that tag:

   ```sh
   git switch main
   git pull
   git tag -a v0.5.0 -m "OpenNote 0.5.0"
   git push origin v0.5.0
   ```

6. Open the Actions tab on GitHub, and watch the release run. The run checks the checklist first. If a sign-off is missing, the run stops before it builds anything, and its summary says what is left.
7. The run waits twice for a reviewer of the `release` environment. Choose Review deployments, then Approve and deploy. Approve the package job, which signs, once the builds pass. Approve the publish job after you read the package job's summary, which lists the files that will go live.

Avoid `git push --tags`. It pushes every local tag, and each new `v` tag can start its own release.

### Prereleases

A tag with a hyphen, such as `v0.5.0-beta.1`, makes a prerelease. The workflow marks the GitHub Release as a prerelease, and writes `beta.json` instead of `latest.json`. Stable copies read only `latest.json`, so they never see beta builds. Put the same version, such as `0.5.0-beta.1`, in the three version files.

After it publishes a beta, the workflow also replaces `beta.json` in the [beta channel](#create-the-beta-channel) prerelease, which Beta copies read. They also read `latest.json`, and take whichever version is newer. The beta channel always holds the beta published last, so publish betas in version order. A beta of an older line, such as `0.4.2-beta.1` after `0.5.0-beta.1`, takes the channel back to that line.

### Test builds

A tag with `-test` in it, such as `v0.5.0-test.1`, is a test build. It is a prerelease like a beta. The workflow only reports the release checklist for it, so a missing sign-off does not stop it, and it doesn't need code signing.

A test build never updates the beta channel, so no copy is offered it. `0.5.0-test.1` sorts above every `0.5.0-beta.N`, so copies that installed it would refuse the later betas. Use it to try the release workflow end to end on real GitHub, and to download and run the signed exes, before the checklist can pass. Don't announce a test build or put it in winget.

## Trying a release with a dry run

A dry run builds and packages everything and publishes nothing. Use it to test a change to the release workflow or the release scripts, or to see what a release would contain.

1. On GitHub, open the Actions tab, choose the "release" workflow, and choose "Run workflow". The button appears once the workflow file is on the default branch. From the command line, run `gh workflow run release.yml --ref <branch>`.
2. The run uses the version in the three version files as its tag, such as `v0.5.0`. It runs the checklist in report mode, CI, and the three builds.
3. It signs the exes with a key made for that run, which is deleted at the end. The real signing secrets are never used, and the publish job doesn't run.
4. It checks the result the way the app will, against the throwaway key. The run summary lists the files.
5. The run keeps a `release-files` artifact for seven days. It holds the exes, the signatures, the manifest, the notes, the bill of materials, the checksums, and the throwaway public key. A `winget-manifests` artifact holds the winget files.

The throwaway signatures are valid only for that run's key, so no copy of the app accepts them.

## Release files

Each release ships one exe for each Windows architecture: 64-bit x64, 32-bit x86, and 64-bit Arm (ARM64).

| File | For | Rust target | Updater key |
|---|---|---|---|
| `OpenNote_Windows64.exe` | 64-bit Windows, on most PCs | `x86_64-pc-windows-msvc` | `windows-x86_64` |
| `OpenNote_Windows32.exe` | 32-bit Windows | `i686-pc-windows-msvc` | `windows-i686` |
| `OpenNote_WindowsARM64.exe` | Windows on ARM64 PCs, such as Snapdragon laptops | `aarch64-pc-windows-msvc` | `windows-aarch64` |

Next to each exe is its update signature, with `.sig` added to the name, such as `OpenNote_Windows64.exe.sig`. The release also holds one manifest, `latest.json`, or `beta.json` for a prerelease. Two more files help people check what they downloaded: `SHA256SUMS.txt` lists the hash of every file, and `OpenNote.sbom.cdx.json` is the software bill of materials, a list of everything built into the exes.

Each name starts with `OpenNote_`, followed by the operating system and, where needed, the architecture. Later, macOS and Linux builds will ship as `OpenNote_macOS.dmg` and `OpenNote_Linux.AppImage`.

The table lives in [app/release-files.json](../app/release-files.json). [write-manifest.ts](../app/scripts/write-manifest.ts) reads it. The updater in `crates/updater` compiles in the same rows, so each build knows the one file it may update to. The build matrix in [release.yml](../.github/workflows/release.yml) lists the same targets and names. A unit test fails if the matrix differs from the table, and a Rust test fails if the updater's rows do. To add a file, change all three.

## What the release workflow does

Pushing a tag that starts with `v` runs [release.yml](../.github/workflows/release.yml). Running it by hand is a [dry run](#trying-a-release-with-a-dry-run). The workflow has seven jobs: `version`, `checklist`, `ci`, `build`, `sbom`, `package`, and `publish`. The build job runs three times side by side, once for each exe. Each job starts only when the ones it needs succeed, and nothing is published until the last step of the publish job.

Each job gets only the permissions it needs, and no checkout keeps a GitHub token on disk. Every action is pinned to a full commit SHA, with the version in a comment. That includes the actions in `ci.yml`, because the release run runs its jobs too, and any job of a run can upload artifacts to it. Change the SHA and its comment together when you update an action. A test, [workflow.test.ts](../app/scripts/release/workflow.test.ts), fails if a secret, a permission, or a pin moves where it shouldn't.

The scripts that the jobs run are described in [their README](../app/scripts/release/README.md).

### The version job

This job runs on `ubuntu-latest` and takes a few seconds. Like most jobs, it has read-only access and no secrets. For a pushed tag, it first checks that the tagged commit is on `main`, and stops the release if not.

It works out the tag, which is the pushed tag, or the version in the version files for a dry run. It checks that the tag, without its `v`, matches the version in all three version files, using [check-version.ts](../app/scripts/check-version.ts). If not, the release stops before CI runs. It also decides whether the checklist is enforced: it is for a pushed tag, unless the tag is a [test build](#test-builds).

### The checklist job

This job runs [checklist.ts](../app/scripts/release/checklist.ts) on the tagged commit. It answers each item of the [release checklist](DEVELOPMENT.md#10-release-checklist). It runs CHECKS. It asks GitHub whether CI and the nightly run passed, and whether any `data-loss`, `crash`, or `security` issue is open. It reads the sign-off file for the items that need a person.

It reads the list of items from the development plan, so a new item fails the job until the script has a check for it. For a release, any item that fails or has no sign-off stops the run, before the build starts. For a dry run or a test build, the job only reports. It writes the table to the run summary either way.

The item about code signing can't be answered yet at this point, because the exes don't exist. The package job answers it later.

### The ci job

This job runs [ci.yml](../.github/workflows/ci.yml) on the tagged commit, so a release gets the same checks as a push to `main`:

- On Ubuntu and Windows: the design token check, type checks, lint, the format check, the unit tests, and CHECKS on all files.
- On Windows: rustfmt, Clippy, the Rust tests, and a debug build of the app.

The job can only read the repository, and it gets no secrets.

### The build job

This job runs three times on `windows-latest`, once for each row of the [release files](#release-files) table. It can only read the repository, and it gets no secrets. The x64 runner also builds the 32-bit and ARM64 exes, with the Microsoft Visual C++ tools it has for them.

1. Check out the full history, and set up Node.js 22. The job uses no npm or Rust cache, because the CI jobs of the same ref can write to those caches.
2. Set up stable Rust with the Rust target for this exe, and install the project tools with `npm ci`. There is no Rust build cache, so every release builds from a clean start.
3. Build with `npx tauri build --no-bundle --target`, followed by the Rust target, such as `aarch64-pc-windows-msvc`. This runs `npm run app:build` for the design tokens and the interface. It then compiles the Rust app in release mode into one exe, with no installer.
4. Copy `target/<rust-target>/release/opennote.exe` to `dist-release`, under its release name, such as `OpenNote_WindowsARM64.exe`.
5. Run [check-release-exe.ts](../app/scripts/check-release-exe.ts). It fails for an exe built with the test-endpoints feature, or one that holds an update key that isn't committed in `app/src-tauri/keys`.
6. Report the exe's SHA-256 as an output of the job, such as `sha256-x86_64-pc-windows-msvc`.
7. Keep the exe as a workflow artifact for one day.

If one exe fails to build, the other two still finish, so one run shows every failure. The package job starts only when all three succeed.

### The sbom job

This job lists everything that is built into the exes, as a [CycloneDX](https://cyclonedx.org/) bill of materials, `OpenNote.sbom.cdx.json`. It lists the npm packages that the interface imports, and the Rust crates that the exes need, with their versions, licenses, and hashes. It runs apart from the signing step because `cargo metadata` downloads crate sources. It gets no secrets. It reports the file's SHA-256 as an output, which the package job checks.

### The package job

This job runs on `windows-latest`. It builds nothing and runs no install scripts, so the Tauri command-line tool is the only project dependency that runs next to the signing key. It can only read the repository. It is the only job that gets the signing secrets, and only in the step that signs. For a pushed tag, it runs in the `release` environment, so it waits for a reviewer's approval first.

1. Check out the full history, set up Node.js 22, and install the project tools with `npm ci --ignore-scripts`.
2. Download the three exes and the bill of materials into `dist-release`, each artifact by its exact name.
3. Check the downloads with [check-downloads.ts](../app/scripts/release/check-downloads.ts). This happens before anything is signed. `dist-release` must hold only the three exes and the bill of materials, and each must have the SHA-256 that the build or sbom job reported. Any other job of the run, such as a CI job with a tampered action, can upload an artifact, so this stops a swapped or added file. The step also runs the [check-release-exe.ts](../app/scripts/check-release-exe.ts) checks on each exe again.
4. Write the release notes with [notes.ts](../app/scripts/release/notes.ts). The page text goes in `release-notes.md`, and the short text for the update notice goes in `release-notes.txt`.
5. Sign each exe with [sign.ts](../app/scripts/release/sign.ts), which runs `tauri signer sign --app-version` with the version of the tag. This writes a signature next to each exe, such as `OpenNote_Windows64.exe.sig`. The version goes into each signature's trusted comment, which the signature covers, so nobody can change it without the private key. If `TAURI_SIGNING_PRIVATE_KEY` isn't set, the step fails. A dry run makes a throwaway key here instead.
6. Write the update manifest with [write-manifest.ts](../app/scripts/write-manifest.ts), using the short notes. It stops when an exe or its `.sig` file is missing or empty. It stops when a signed version differs from the tag. It also stops when a signature names another file than its exe.
7. Write `SHA256SUMS.txt`, with the hash of every release file.
8. Check the release with [verify.ts](../app/scripts/release/verify.ts), the way a running copy of the app will. It checks the manifest, then each exe's size, hash, download address, and signature against the update keys committed in `app/src-tauri/keys`. Those are the keys built into the exe, so a wrong secret fails here, before anything is published. For a release, it also requires an Authenticode signature on each exe, and asks Windows whether it is valid.
9. For a stable release, write the winget files with [winget.ts](../app/scripts/release/winget.ts).
10. Keep the release files as a workflow artifact.

### The publish job

This job runs on `ubuntu-latest`, and only for a pushed tag. It runs in the `release` environment, so it waits for a reviewer's approval. It is the only job that can write to the repository. It gets no secrets, checks out nothing, and runs no project code. It downloads the files that the package job kept, and publishes a GitHub Release named after the tag with every file in `dist-release`. The body of the release is `release-notes.md`. Tags with a hyphen become prereleases.

For a beta, but not a test build, it then replaces `beta.json` in the [beta channel](#create-the-beta-channel) prerelease with `gh release upload channel-manifests dist-release/beta.json --clobber`. It checks that this prerelease exists before it publishes anything.

### The release notes

The notes have two forms, both made by `notes.ts` from the changelog entry for the version and the merge commits since the previous release. A stable release looks back to the previous stable release, so it includes the work of its betas.

- **The release page** shows the changelog entry as "What's new", a table that says which file to download, and a collapsed list of every merge since the last release.
- **The update notice** in the app gets the bullet points of the changelog entry as plain sentences, cut to the 8 lines and 4096 bytes the notice can show. Longer notes end with a link to the release page. Without a changelog entry, it uses the merge titles.

### The update manifest

The manifest uses the Tauri updater's format for more than one platform. Each copy of the app reads only the entry for its own updater key, such as `windows-aarch64`. The manifest itself isn't signed. Each exe's signature covers the file and its version, and the updater checks both against the manifest, so a changed manifest can't pass off another file. The updater also refuses a download address that isn't on GitHub. The manifest holds these fields:

| Field | Contents |
|---|---|
| `version` | The tag without the leading `v` |
| `notes` | The short release notes for the update notice |
| `pub_date` | When the manifest was written, just before the release was published |
| `channel` | `stable`, or `beta` for a version with a hyphen |
| `platforms` | One entry for each exe, under its updater key from the [release files](#release-files) table |

Each entry in `platforms` holds these fields:

| Field | Contents |
|---|---|
| `url` | The download link for the exe in this release |
| `signature` | The contents of the exe's `.sig` file. Its trusted comment names the same version as `version`. |
| `size` | The size of the exe in bytes |
| `sha256` | The SHA-256 hash of the exe, in lowercase hexadecimal |

## Verifying a release

The release and its manifest go live as soon as the publish job finishes, with no draft step. Approving the publish job is the last chance to stop it. Check the result right away, before you announce it:

1. Open the [releases page](https://github.com/XrxcGH/OpenNote/releases). The new release should list the three exes from the [release files](#release-files) table, a `.sig` file for each, `latest.json` or `beta.json`, `SHA256SUMS.txt`, and `OpenNote.sbom.cdx.json`. A beta should carry the Pre-release label.
2. Open the manifest. Its `version` should match the tag. Its `platforms` should list `windows-x86_64`, `windows-i686`, and `windows-aarch64`.
3. Download the release files into an empty folder with `gh release download v0.5.0`, or from the release page. If you have the repository, run the same check that the workflow ran, with the update key committed in `app/src-tauri/keys`. It prints nothing but a summary line when the release is fine:

   ```sh
   node app/scripts/release/verify.ts <the folder> v0.5.0
   ```

   Without the repository, check each exe's hash and size in PowerShell, and show its signature's trusted comment:

   ```powershell
   $manifest = Get-Content .\latest.json -Raw | ConvertFrom-Json
   foreach ($platform in $manifest.platforms.PSObject.Properties) {
     $entry = $platform.Value
     $file = Split-Path $entry.url -Leaf
     $hashMatches = (Get-FileHash $file -Algorithm SHA256).Hash -eq $entry.sha256
     $sizeMatches = (Get-Item $file).Length -eq $entry.size
     $signature = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($entry.signature))
     "$file hash: $hashMatches, size: $sizeMatches, $(($signature -split "`n") -match '^trusted comment')"
   }
   ```

   Use `beta.json` for a beta. The loop prints one line for each exe. Each line should show `True` for the hash and the size, and end with `version:0.5.0`. The `-eq` test ignores letter case, so the uppercase hash from `Get-FileHash` still matches. On macOS or Linux, compare the output of `shasum -a 256 OpenNote_*.exe` with the manifest by eye. Read each signature with `base64 --decode`, such as `base64 --decode < OpenNote_Windows64.exe.sig`.
4. For a stable release, open the [latest manifest](https://github.com/XrxcGH/OpenNote/releases/latest/download/latest.json). For a beta, open the [beta manifest](https://github.com/XrxcGH/OpenNote/releases/download/channel-manifests/beta.json). The app's updater reads these addresses, so the one for the release should show the new version.
5. Run each exe on Windows 10 or 11, ideally on a clean machine such as Windows Sandbox, which needs Windows Pro or Enterprise. A 64-bit PC runs both `OpenNote_Windows64.exe` and `OpenNote_Windows32.exe`. Run `OpenNote_WindowsARM64.exe` on an ARM64 PC. The window should open and work. Until code signing is set up, Edge may warn that the file "isn't commonly downloaded", so choose Keep. SmartScreen may then show "Windows protected your PC". Select More info, then Run anyway.
6. Read the release notes on the release page. They come from the changelog entry and the merges since the last release. Edit them on GitHub if they need it. The app's update notice shows the `notes` field of the manifest, which stays as the workflow wrote it, so fix the changelog entry first if the wording is wrong.

## winget

The workflow writes the winget manifest files for every stable release. They are in the `winget-manifests` artifact of the run, kept for 90 days, under `manifests/x/XrxcGH/OpenNote/<version>/`. [winget.ts](../app/scripts/release/winget.ts) makes them from the release manifest, so the addresses and hashes match the update manifest. The package details are in [app/winget.json](../app/winget.json).

Winget packages are not published by the workflow. To list a release:

1. Before the first submission, confirm the `PackageIdentifier` in `app/winget.json`. It is `XrxcGH.OpenNote` now, after the GitHub owner. Once winget has a package under an identifier, it can't change.
2. Check the files: `winget validate --manifest <the version folder>`.
3. Copy the version folder into a fork of [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs), under the same path, and open a pull request. The `wingetcreate submit` command does the same.

Each exe is a portable package, so winget copies it into the person's own folder and adds a command, `opennote`. This works well with the built-in updater, with one catch: winget remembers the version it installed. After the app updates itself, `winget upgrade` can see a difference and try to replace the exe. Winget may refuse, because the file changed since it installed it. People can run `winget upgrade --force`, or leave updates to the app.

## When the release workflow fails

If anything fails before the "Publish the release" step, nothing is published. The run's page shows which job and step failed. Common causes:

- The `ci` job fails when a check or test fails on the tagged commit. Fix the code.
- The `version` job fails when the tag doesn't match the three version files. Delete the tag, fix the files, and tag again. It also fails when the tagged commit isn't on `main`. Delete the tag, merge the work to `main`, and tag the merge commit.
- The package or publish job waits, and never starts, until a reviewer approves the `release` environment. See [Add the release environment and its secrets](#add-the-release-environment-and-its-secrets).
- The `checklist` job fails when an item of the release checklist fails or has no sign-off. The run summary lists each item. Fix the item or record the sign-off. A sign-off file is part of the commit, so tag again after you merge it. A `data-loss`, `crash`, or `security` issue that is still open also fails it.
- The "Sign the updates" step fails when `TAURI_SIGNING_PRIVATE_KEY` isn't set, or when the key or password is wrong. Correct the secret as described in [Add the release environment and its secrets](#add-the-release-environment-and-its-secrets).
- The "Check the release the way the app will" step fails when a signature doesn't verify with the committed update key. That means the secret and `app/src-tauri/keys/update.pub` are from different key pairs. It also fails when an exe has no Authenticode signature. See [Add code signing later](#add-code-signing-later).

For a one-off failure, such as a network error, or after you correct a secret, use "Re-run failed jobs" on the run's page. A re-run reads the secrets again. When only one exe failed to build, it builds just that one again. The package job downloads the exes that the build job kept, and those copies expire after one day. If the download step fails, use "Re-run all jobs" instead.

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

A bad beta is already a prerelease, and stable copies never see it, but Beta copies do. To stop the spread, put the previous beta's manifest back in the [beta channel](#create-the-beta-channel). For a bad `v0.5.0-beta.2`:

```sh
gh release download v0.5.0-beta.1 --pattern beta.json --dir previous-beta
gh release upload channel-manifests previous-beta/beta.json --clobber
```

If there was no previous beta, delete the channel's manifest instead with `gh release delete-asset channel-manifests beta.json`. Beta copies then read only `latest.json`. Then publish the next beta with the fix, such as `v0.5.0-beta.3`, which puts its own manifest in the channel.

Never move the tag of a published release, and never publish a rebuilt exe under the same version. Copies that installed the bad build would never be offered the fix, because the version number didn't change.

Once the updater from [section 9](DEVELOPMENT.md#9-distribution-and-updates) ships, people can also go back to the previous version from Settings. The app does this by itself if a new version crashes twice in a row at start-up.
