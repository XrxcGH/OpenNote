# OpenNote on macOS and Linux

OpenNote runs on a Mac and on Linux as well as on Windows. Your notebooks are the same plain folders on every system, so a notes folder you copy or sync from Windows opens as it is.

## Install on a Mac

1. Download `OpenNote_macOS.dmg` from the [releases page](https://github.com/XrxcGH/OpenNote/releases). It runs on macOS 11 or later, on Apple silicon and Intel Macs.
2. Open the dmg, then drag OpenNote to the Applications folder.
3. Open OpenNote from Applications. While the beta is unsigned, macOS says it can't check the app. Open System Settings, then **Privacy & Security**, scroll to the message about OpenNote, and choose **Open Anyway**. You only do this once.
4. The first time you record, macOS asks whether OpenNote may use the microphone. It asks again for the Documents folder if your notes folder is there.

Your settings live in `~/Library/Application Support/OpenNote`, and this Mac's caches, logs, and models in its `Device` folder.

## Install on Linux

1. Download `OpenNote_Linux.AppImage` from the [releases page](https://github.com/XrxcGH/OpenNote/releases). It runs on 64-bit Linux with glibc 2.35 or later, such as Ubuntu 22.04, Fedora 36, or Debian 12.
2. Make it runnable, then start it: `chmod +x OpenNote_Linux.AppImage`, then `./OpenNote_Linux.AppImage`. Many file managers do the same with Properties, then **Allow executing file as program**.
3. Some systems need FUSE to run any AppImage. If it says so, install `libfuse2` (Ubuntu and Debian) or `fuse` (Fedora), or run it with `--appimage-extract-and-run`.

Your settings live in `~/.config/OpenNote`, this computer's files in `~/.local/share/OpenNote`, and new notebooks go in your Documents folder. OpenNote follows `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and the Documents folder your desktop names.

## Updates

- **Linux.** OpenNote updates the AppImage itself, the same way as on Windows, as long as it can write to the AppImage's folder. Every update is checked against its signature first.
- **Mac.** OpenNote checks for updates and downloads the new dmg, checking its signature first. Choose **Open the installer**, then drag OpenNote to Applications again. OpenNote never replaces its own app file, so a signed app stays signed. Your notes and settings stay as they are.

## Read aloud, spell check, PDF, and the command

- **Read aloud** uses the voices installed on the computer: the ones in System Settings on a Mac (`say`), and `espeak-ng` on Linux. The text never leaves the computer.
- **Spell check** uses the Mac's own checker, or `hunspell` on Linux, for every language it has a dictionary for.
- **Save as PDF and Print** work as on Windows. The PDF is made by the system's web view.
- **The opennote command** is part of the app. OpenNote puts it at `~/.local/bin/opennote` each time it starts, as long as **Let apps on this PC connect** is on. On a Mac, add that folder to your PATH if the shell doesn't find it: `echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc`.

## Shortcuts on a Mac

Every shortcut that uses Ctrl on Windows uses Command (⌘) on a Mac: ⌘K opens the command palette, ⌘, opens Settings, and ⌘S saves. Option (⌥) takes the place of Alt. Control is left to text editing, so Control+A still goes to the start of the line. Menus and tooltips show shortcuts the Mac way, such as ⇧⌘D.

## What works differently

Open Settings, then **About**, or press ⌘K (Ctrl+K on Linux) and choose **Show what works on this computer**. The list names each feature that still needs Windows, and what to do instead:

- Text in pictures and scanned pages is read on the device: by Apple's Vision on a Mac, and by Tesseract on Linux once you install the tesseract-ocr package and a language pack, such as tesseract-ocr-eng.
- Handwriting turns into text on the device too. A Mac reads it with Vision. On Linux, Tesseract reads it, best when the letters are neat and printed. Your ink is kept as drawn either way.
- On Linux, read aloud needs `espeak-ng` and spell check needs `hunspell` with a dictionary. Install them with your package manager, for example `sudo apt install espeak-ng hunspell hunspell-en-us`. A Mac has both built in.
- Protected sections open with their password. Windows Hello, docking to a screen edge, Snap Layouts, and Share to OpenNote are Windows features.
- Recording what the computer plays may not start, because the system has no loopback device. The microphone works.
- Sync keys and connector sign-ins are kept in the Keychain on a Mac. On Linux they are kept in the system keyring (GNOME Keyring or KWallet); without one running, sync can't be set up and sign-ins last until OpenNote closes.
- On Linux, pen pressure depends on the desktop. Some setups report none, and strokes then have one width.

Everything stays on your computer, as on Windows, unless you turn on a cloud feature.
