# Sync (Beta)

Sync keeps your notebooks the same on all your devices. It is off until you set it up, and it needs no OpenNote account or server: it keeps its data in a folder or on a WebDAV server you already have. Everything is encrypted on your device before it leaves.

## Set up sync

1. Open Settings, then Sync, and choose **Set up sync**.
2. Choose where sync keeps its data:
   - **A folder**: one that OneDrive, Dropbox, iCloud Drive, or Syncthing already syncs, a network share, or a USB drive. Use an empty folder just for sync. The service that syncs the folder only ever sees encrypted files.
   - **A WebDAV server**, such as Nextcloud, ownCloud, or a NAS. The address must start with `https://`. The password is kept in Windows Credential Manager.
3. Choose a passphrase of at least 10 characters, and type it twice. A few unrelated words are easy to remember and hard to guess.
4. Save the **recovery key**. It is shown once. If you forget your passphrase, it is the only way to unlock sync, and nobody else can recover it. Write it down or print it, and keep it away from this device. To finish, type two of its groups back.

The first sync starts at once. After that, OpenNote syncs every few minutes while it is open, and whenever you choose **Sync now**.

## Add another device

On a device that already syncs, open Settings, then Sync, and choose **Add a device**. It shows a pairing code, as a QR code and as text. On the new device, choose **Join a sync from another device**, pick the same folder or server, and type the code. The code works once, for 24 hours. You can also join with the passphrase or the recovery key.

To change the passphrase, open Settings, then Sync, and choose **Change passphrase**, or run Change sync passphrase from the command palette. Type your recovery key and the new passphrase twice. Your devices keep syncing; a device that joins later uses the new passphrase.

Both devices show the same **sync code**, such as `K7Q2-M9XA`, when they joined the same sync.

## What is encrypted

- Every page, picture, recording, and file is encrypted with XChaCha20-Poly1305 before it is sent.
- File names, notebook and page titles, and how your notebooks are organized are encrypted too. The folder or server sees only blobs with random names, their rough sizes, how many there are, and when they change. It can tell how many devices sync, but not which.
- Your passphrase never leaves your device. It unlocks the key through Argon2id, which makes guessing it slow.
- Each device keeps its own key in Windows Credential Manager, so background sync never asks for the passphrase. OpenNote has no copy of any key.
- Password-protected sections stay sealed with their own password. Sync copies them as they are, and never opens them.
- Nothing is sent anywhere else, and sync sends no usage data.

## When two devices change the same page

Sync never throws away text.

- **A page.** If the same page changed on two devices before they synced, both versions are kept. The page shows "This page was also changed on another device. Compare the versions," and you choose which to keep, or keep both as separate pages. The time each device's clock gave the save decides which version opens as the page, so if one device's clock is wrong, check both versions before you choose.
- **Section and notebook lists** merge on their own.
- **An ordinary file** changed on two devices keeps both copies, one named `(conflicted copy)`. Two files whose names differ only in capital letters, such as `Todo.txt` and `todo.txt`, can't sit side by side in a Windows folder, so the second becomes a `(conflicted copy)` too.
- **A password-protected section** changed on two devices keeps both versions, and shows "This protected section was changed on two devices." Choose Switch to the other version to look at it; the one you had is kept, so you can switch back. Then remove the version you don't want.
- **A delete.** An edit always wins over a delete made on a device that hadn't seen it.

## Pause, preview, and Work offline

- Turn off **Sync this device** to pause. Your notes stay, and sync picks up where it left off.
- **Preview changes** lists what the next sync would send, bring in, remove, and keep side by side, without changing anything.
- While Work offline is on, sync waits.
- The title bar says how sync is doing: Synced, Syncing, Sync paused, Sync waiting, or Sync stopped. Choose it to open Settings, then Sync.

## If sync stops

| What you see | What to do |
|---|---|
| A file in the sync storage was changed outside OpenNote | Something changed an encrypted file. Sync pauses so nothing wrong is written to your notes. Check the folder or server, restore it from its own history if you can, then choose Sync now |
| The storage holds older changes than this device has already seen | The folder or server went back in time, for example after a restore. If you restored it on purpose, choose **Trust the storage as it is** |
| Some changes from another device haven't arrived yet | The service that syncs the folder is still copying files. OpenNote tries again |
| This device was removed from sync | Another device removed this one. Your notes here are kept. Turn sync off here, then join again |
| The sync storage couldn't be reached | Check that the folder exists, or that the server is up and the password is right |

A sync that stops partway, because the PC slept or the app closed, loses nothing. It continues next time, without sending again what already arrived.

## Remove a device or turn sync off

In the device list, choose **Remove** next to a device. It stops syncing and keeps the notes it has. If a device was lost or stolen, know that a device that kept a copy of the key can still read what was synced. To lock it out of new changes, turn sync off on every device and set it up again in a new folder or server.

**Turn off sync on this device** forgets this device's key. Your notes stay here, and your other devices keep syncing.

Sync is in Beta. Keep your usual backups while you try it.
