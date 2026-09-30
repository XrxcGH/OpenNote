# Update public keys

The app accepts an update only when its signature verifies against a public key from this folder. At build time, `build.rs` reads every `*.pub` file here, decodes it, and embeds the key text in the exe.

Each file is a public key exactly as `tauri signer generate` writes it: the base64 text of a minisign public key. The folder holds public keys only. Private keys never belong in the repository, and the release workflow reads the active one from a secret, as [RELEASING.md](../../../docs/RELEASING.md) explains.

Two keys will live here: `update.pub`, the active key, and `update-backup.pub`, a backup whose private half stays offline. Until the active key arrives, the folder has no keys. Builds then trust no update signature at all, and development builds keep the updater off.
