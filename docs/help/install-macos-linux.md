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
- **Mac.** OpenNote doesn't install updates itself on a Mac yet. When a new version is out, download its dmg. Then drag OpenNote to Applications again. Your notes and settings stay as they are.

## Shortcuts on a Mac

Every shortcut that uses Ctrl on Windows uses Command (⌘) on a Mac: ⌘K opens the command palette, ⌘, opens Settings, and ⌘S saves. Option (⌥) takes the place of Alt. Control is left to text editing, so Control+A still goes to the start of the line. Menus and tooltips show shortcuts the Mac way, such as ⇧⌘D.

## What works differently

Open Settings, then **About**, or press ⌘K (Ctrl+K on Linux) and choose **Show what works on this computer**. The list names each feature that still needs Windows, and what to do instead:

- Text in pictures and scanned pages isn't searchable, and handwriting doesn't turn into text, because both use recognition that Windows provides. Your ink is kept as drawn.
- Read aloud has no voices, because it uses the voices Windows has.
- Saving a page as PDF and printing aren't here yet. Export as Word or HTML, then print that.
- Protected sections open with their password. Windows Hello, docking to a screen edge, Snap Layouts, and Share to OpenNote are Windows features.
- Recording what the computer plays may not start, because the system has no loopback device. The microphone works.
- Sync can't be set up yet, because each device keeps its key in Windows Credential Manager.
- On Linux, pen pressure depends on the desktop. Some setups report none, and strokes then have one width.

Everything stays on your computer, as on Windows, unless you turn on a cloud feature.
