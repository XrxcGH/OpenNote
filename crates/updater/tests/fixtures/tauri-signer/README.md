# Signature format fixture

These files pin the signature format that the release workflow's signing tool writes (ARCHITECTURE.md section 18.12). The updater's checks are tested against them, as well as against signatures the tests make themselves.

| File | What it is |
|---|---|
| `payload.txt` | A small file to sign |
| `payload.txt.sig` | Its signature, as `tauri signer sign` wrote it: the base64 text of a minisign signature |
| `fixture.pub` | The public key, as `tauri signer generate` wrote it: the base64 text of a minisign public key |

They were made once, on 2026-09-30, with the pinned `@tauri-apps/cli` 2.12.0, from the repository root:

```sh
printf 'OpenNote update signature format fixture.\n' > payload.txt
npx tauri signer generate --ci -p "" -w ./fixture.key
npx tauri signer sign --app-version 0.0.2-fixture -f ./fixture.key -p "" ./payload.txt
```

The private key, `fixture.key`, was deleted right after signing and was never committed. Nothing else can be signed with this key. A final newline was added to `payload.txt.sig` and to `fixture.pub`, which `fixture.key.pub` was renamed to, because the repository's text checks require one. The updater trims it.

What the fixture shows, and `tests/verify.rs` asserts:

- The signature is prehashed: its algorithm bytes are `ED`, so the updater verifies it while streaming the file, and `ALLOW_LEGACY` in `src/verify.rs` is false.
- The trusted comment reads `timestamp:<seconds>\tfile:<basename>\tversion:<version>`, here `timestamp:1790782933\tfile:payload.txt\tversion:0.0.2-fixture`.
- The signature verifies against the public key.

If the pinned Tauri CLI changes its format, make the fixture again with the new version, and update the test and `ALLOW_LEGACY` to match.
