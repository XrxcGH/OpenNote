# Share target package

OpenNote ships as one unpackaged exe. Windows lists only apps with a package identity in the share sheet, so
"Share to OpenNote" (flag `integrations.shareTarget`) uses a **sparse package**: a package with no files of its own
that points at the folder with `OpenNote.exe`.

- [`AppxManifest.xml`](AppxManifest.xml): the package, with a share target for text, links, pictures, and files.
- [`../../app/src-tauri/windows-app.manifest`](../../app/src-tauri/windows-app.manifest): the exe's manifest, which
  names the package. `build.rs` fills in its publisher from `OPENNOTE_MSIX_PUBLISHER`.
- [`register-dev.ps1`](register-dev.ps1): registers the package for a development build, in Developer Mode.

How a share reaches a page is in `app/src-tauri/src/share` (the launch reads the share and saves it to the share
inbox) and `app/src/features/integrations/share` (the window adds it to the open page or to Quick notes).

## Trying it while developing

1. Turn on Developer Mode (Settings, System, For developers).
2. Build the app (`npm start` or `cargo build -p opennote`).
3. `pwsh packaging/msix/register-dev.ps1 -ExeFolder <folder with the exe>`
4. Share text, a link, a picture, or a file from another app and pick OpenNote.
5. `pwsh packaging/msix/register-dev.ps1 -Unregister` removes it.

## For a release (the owner's steps)

1. Choose the code-signing certificate. Its subject, such as `CN=Example Publisher`, is the publisher.
2. Set `OPENNOTE_MSIX_PUBLISHER` to that subject for the release build, so the exe names the same publisher.
3. Fill in `PUBLISHER` and `VERSION` in a copy of `AppxManifest.xml`, add the three logos under `Assets`, and pack
   it: `makeappx pack /d <folder> /p OpenNote.ShareTarget.msix /nv`.
4. Sign it: `signtool sign /fd SHA256 /a /f <certificate> OpenNote.ShareTarget.msix`.
5. Setup registers it with `Add-AppxPackage -Path OpenNote.ShareTarget.msix -ExternalLocation <install folder>`.
   That last step waits for the signed package; until then the flag stays on but the share sheet doesn't list
   OpenNote, and nothing else changes.

Nothing in this folder holds a key or a certificate.
