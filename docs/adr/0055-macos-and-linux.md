# ADR 0055: macOS and Linux builds degrade feature by feature and say what they lack

- Status: Proposed
- Date: 2026-10-29

## Context

OpenNote was built for Windows first (ADR 0012 and DEVELOPMENT.md). The owner asked for macOS and Linux builds, `OpenNote_macOS.dmg` and `OpenNote_Linux.AppImage`, next to the Windows exes, in the release naming of `app/release-files.json`. Tauri 2 runs on both, with WKWebView on macOS and WebKitGTK on Linux. But much of the shell talks to Windows directly. It uses the PDF printing of WebView2, Windows.Media.Ocr, Ink Analysis, the speech synthesizer, and Windows Hello. It also uses the common item dialogs, `ShellExecuteW`, the app-bar dock, Snap Layouts, the MSIX share target, known folders, and the exe swap of the updater. Nobody on the project has a Mac to test on, so every Mac change is checked only by GitHub's macOS runners.

## Decision

- **One codebase, gated by `cfg`.** Windows code stays where it is, behind `#[cfg(windows)]`. Each command that had a not-implemented stub off Windows either gets a real macOS and Linux path or keeps a stub, and the app lists what the stub means. No feature flag: a system either has a feature or it doesn't.
- **Real paths where the system has one.** File and folder pickers and the Save dialog use the Tauri dialog plugin, from Rust only, with no capability for the page. It shows NSOpenPanel and NSSavePanel on macOS, and the chooser of GTK or of the desktop portal on Linux. Opening a file, an address, or a folder uses `open` on macOS and `xdg-open` on Linux, with the target as one argument, so no file name can run a command. Recording and playback use the Core Audio and ALSA hosts of cpal, which the media crate already used for WASAPI.
- **Folders.** macOS keeps everything in `~/Library/Application Support/OpenNote`, this Mac's files in its `Device` folder, and nothing in Caches, which macOS may empty. Linux follows `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_DOCUMENTS_DIR` from `user-dirs.dirs`, and ignores relative values as the XDG specification says.
- **The interface knows the system.** The boot payload gains `system` (`windows`, `macos`, or `linux`). On macOS, the Ctrl of a chord is Command, so the command registry (ADR 0046) needs no second set of keys. Chords read as `⇧⌘D`, aria-keyshortcuts names Meta, and Control is left to text editing. The custom title bar is Windows-only: macOS keeps its traffic lights and Linux the frame of its window manager.
- **The menu bar on macOS.** A Mac app keeps its commands in the menu bar, so the main window builds one from the command registry (`app/src/commands/appMenu.ts`). It has one menu per command category, in the order of the shortcut list. Each item has its title and its first chord as the key equivalent, with Command for Ctrl, so the menu prints `⇧⌘D` as `formatChord` does. The shell (`shellqol/app_menu.rs`) wraps them in the app menu (About, Settings, Services, Hide, Quit), Edit with the system's Undo, Cut, Copy, Paste, and Select All, and Window, and sends a pick back as the command's id, which runs through `executeCommand`. The page hears a key first, so a pick that echoes a key press of its own chord is skipped, and macOS's own keys and keys without Command get no key equivalent. The menu follows the shortcut set, rebinding, and flags. Windows and Linux keep no menu bar.
- **The app says what is missing.** Settings, then About names the system and lists each feature that needs Windows, with what to do instead. The command "Show what works on this computer" opens that list. The intelligence settings already name a missing engine (`IntelError::Unsupported`), and the updater gives its own reason.
- **Bundles.** `tauri.macos.conf.json` makes one universal app for macOS 11 and later with the hardened runtime, the microphone entitlement, and Info.plist usage strings. It is not sandboxed, because notebooks are folders the person picks anywhere. `tauri.linux.conf.json` makes an AppImage that carries GStreamer, which WebKitGTK needs for media. Both use the identifier `org.opennote.OpenNote`, since one that ends in `.app` clashes with bundle names on macOS. Windows keeps `org.opennote.app`, so nothing moves there.
- **Releases.** The release build matrix gains `universal-apple-darwin` on `macos-latest` and `x86_64-unknown-linux-gnu` on `ubuntu-22.04`, the oldest glibc the AppImage supports. Both stay unsigned until the owner adds the Apple Developer ID, notarization, and GPG secrets that RELEASING.md lists. The update signature, the manifest, the checksums, and the release check cover all five files. CI checks and tests the whole workspace on both systems, and the nightly run builds both bundles.
- **Updates.** The manifest lists `darwin-universal` and `linux-x86_64`. On Linux the updater replaces the AppImage that `APPIMAGE` names, by renaming the new file over it. On macOS it doesn't install: a Mac app is a signed bundle, and swapping its binary would break the signature, so the updater says to install the new dmg until a bundle swap is tested on real Macs.

## What degrades

| Feature | macOS | Linux | Why, and the fallback |
|---|---|---|---|
| Text in pictures (OCR) and handwriting to text | Vision; handwriting read as a picture | Tesseract (installed separately); handwriting read as a picture | Windows uses Windows.Media.Ocr and Ink Analysis. Off Windows the strokes are drawn as a picture and read by the OCR engine. Without Tesseract, Linux keeps ink as drawn, and search covers typed text. |
| Read aloud | None | None | Windows voices. A later engine can use AVSpeechSynthesizer and Speech Dispatcher. |
| PDF export and printing | None | None | The PrintToPdf of WebView2. Export as Word or HTML, then print. `createPDF` in WKWebView and the print operation of WebKitGTK are the follow-up. |
| Windows Hello for protected sections | Password only | Password only | Touch ID through LocalAuthentication is a follow-up. |
| System audio in recordings | May not open | None | Linux has no loopback device, and macOS needs a system tap. The microphone works. |
| Share target, dock to an edge, Snap Layouts, pen settings, custom title bar | None | None | Windows shell features. |
| Self-update | By hand (dmg) | Yes (AppImage) | See Updates above. |
| The `opennote` command-line tool inside the app | None | None | Only the Windows build embeds it. Build it with `cargo build -p opennote-cli`. |
| End-to-end-encrypted sync (ADR 0049) | Keychain | Secret Service, refused only when no keyring runs | The device key lives in the system's credential store. On Linux without GNOME Keyring or KWallet the store is memory only, so setup is refused rather than lose the key at the next start; a keyring started later is used without a restart. |
| Native speech engines (whisper.cpp, ONNX Runtime) | None | None | Only the Windows x64 exe carries them. The pure Rust speech reader runs. |

## Web view differences

- **Pointer events and pen pressure.** On a Mac, the pressure of a drawing tablet arrives through Pointer Events in Safari 13 and later, without tilt on most tablets. WebKitGTK reports pressure only where GTK gets it from the tablet driver (libinput on Wayland, the X input extension on X11). Without it, pressure is 0.5 and strokes have one width. Palm rejection still works, because it reads contact size and timing, not pressure.
- **Touch.** Macs have no touch screens. Trackpad pinch arrives as wheel events with `ctrlKey`, which the page zoom already handles. WebKitGTK sends touch events on touch screens under Wayland and X11.
- **CSS.** `app-region: drag` (the custom title bar) is Chromium-only, and stays off with the native frame. `field-sizing` and the View Transitions API are missing from older WebKit, so macOS 11 and 12 with an older Safari, and older WebKitGTK releases, use the layout without them. The Keyboard API (`getLayoutMap`) is Chromium-only, so a digit chord reads as the digit, not the key printed on a French keyboard.
- **Speech.** `speechSynthesis` exists in WKWebView and not in WebKitGTK. The app doesn't use it.

## Options considered

| Option | For | Against |
|---|---|---|
| `cfg` gates with fallbacks that say what is missing (chosen) | One codebase; Windows is untouched; each gap is listed and named | Some features are missing on day one |
| Hide every feature that needs Windows | A tidy interface | People wouldn't know why a tool they read about is absent |
| Wait until every feature has a Mac and Linux engine | Equal features | No Mac or Linux build for months, and engines nobody can test |
| Electron for the other systems | One Chromium everywhere, so PDF and CSS match | A second shell to keep, a far larger download, and a second security model |

## Consequences

- Each pull request builds and tests on Ubuntu 22.04 and macOS, so Windows-only code that isn't gated fails before it merges.
- Every Mac change is verified only by CI until someone runs the dmg on a real Mac. The owner should do that before the first release that includes it, together with signing and notarization.
- A new Windows feature needs a `cfg(not(windows))` path, and an entry in `app/src/platform/systemSupport.ts` while that path is missing.
