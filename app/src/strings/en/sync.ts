// Optional end-to-end-encrypted sync (ADR 0049): Settings > Sync, its setup steps, the title bar notice, and the
// commands. Every error says what happened and what to do, calmly.

export const sync = {
  section: 'Sync',
  beta: 'Beta',
  intro:
    'Keep your notebooks the same on all your devices. Sync uses a folder or a WebDAV server you already have, such ' +
    'as a folder that OneDrive, Dropbox, iCloud Drive, or Syncthing syncs, or a Nextcloud server. Everything is ' +
    'encrypted on this device before it leaves, and only your devices hold the key.',
  offNotice: 'Sync is off. Nothing leaves this device until you set it up.',
  offlineNotice: 'Work offline is on, so sync waits until you go back online.',
  setUp: 'Set up sync',
  join: 'Join a sync from another device',
  switchLabel: 'Sync this device',
  switchHelp: 'Turn this off to pause sync. Your notes stay here, and sync picks up where it left off.',
  syncNow: 'Sync now',
  preview: 'Preview changes',
  where: 'Syncs with {place}',
  whereFolder: 'the folder {path}',
  whereServer: 'the server {url}',
  fingerprint: 'Sync code {code}. Your other devices show the same code when they join the same sync.',
  lastSync: 'Last synced {when}.',
  never: 'Not synced yet.',
  turnOff: 'Turn off sync on this device',
  turnOffTitle: 'Turn off sync on this device?',
  turnOffBody:
    'Your notes stay on this device, and your other devices keep syncing. To sync this device again later, join with ' +
    'your passphrase.',
  turnOffConfirm: 'Turn off',
  trust: 'Trust the storage as it is',
  trustTitle: 'Trust the storage as it is?',
  trustBody:
    'Only do this if you restored the sync folder or server from a backup on purpose. This device then syncs from ' +
    'what is there now, and keeps its own newer files.',
  trustConfirm: 'Trust it',
  state: {
    off: 'Off',
    synced: 'Synced',
    syncing: 'Syncing…',
    paused: 'Paused',
    offline: 'Waiting while you work offline',
    waiting: 'Waiting to sync',
    error: 'Needs your attention',
  },
  chip: {
    synced: 'Synced',
    syncing: 'Syncing…',
    paused: 'Sync paused',
    offline: 'Sync waiting',
    waiting: 'Sync waiting',
    error: 'Sync stopped',
    title: 'Sync',
    label: 'Sync: {state}. Open sync settings',
  },
  conflicts:
    // checks-disable-next-line length: one plural message; splitting it would lose its typed placeholders
    '{count, plural, one {One page was changed on two devices at once. Both versions are kept, and the page shows them to compare.} other {# pages were changed on two devices at once. Both versions are kept, and each page shows them to compare.}}',
  summary: {
    title: 'What the next sync does',
    nothing: 'Everything is already the same here and in storage.',
    upload: '{count, plural, one {Sends # file} other {Sends # files}} ({size}).',
    download: '{count, plural, one {Brings in # file} other {Brings in # files}} ({size}).',
    delete:
      // checks-disable-next-line length: one plural message; splitting it would lose its typed placeholders
      '{count, plural, one {Removes # file deleted on another device} other {Removes # files deleted on another device}}.',
    conflicts:
      // checks-disable-next-line length: one plural message; splitting it would lose its typed placeholders
      '{count, plural, one {Keeps both versions of # file changed in two places} other {Keeps both versions of # files changed in two places}}.',
  },
  done: {
    synced: 'Sync finished.',
    paused: 'Sync is paused.',
    resumed: 'Sync is on again.',
    removed: 'The device was removed from sync.',
    off: 'Sync is off on this device.',
    trusted: 'This device now trusts the storage as it is.',
    passphrase: 'The passphrase changed. Use the new one when another device joins.',
  },
  passphrase: {
    open: 'Change passphrase',
    title: 'Change passphrase',
    help:
      'Your devices keep syncing with their own keys. A device that joins later uses the new passphrase. Your ' +
      'recovery key stays the same.',
    recovery: 'Recovery key',
    recoveryHelp: 'The 13 groups of characters you saved when you set sync up.',
    new: 'New passphrase',
    save: 'Change passphrase',
    cancel: 'Cancel',
  },
  devices: {
    title: 'Devices',
    help: 'Every device that syncs. Removing one stops it from unlocking sync with its own key.',
    thisDevice: '{name} (this device)',
    added: 'Joined {when}',
    lastSync: 'Last synced {when}',
    neverSynced: "Hasn't synced yet",
    quiet: "Hasn't synced in {days} days. Storage cleanup waits for it; if it won't sync again, remove it.",
    remove: 'Remove {name}',
    removeQuiet: 'Remove {name}, which has stopped syncing',
    removeTitle: 'Remove {name} from sync?',
    removeBody:
      'It stops syncing and keeps the notes it has. If it was lost or stolen, it can still read what was synced; to ' +
      'lock it out of new changes, set sync up again in a new place.',
    removeConfirm: 'Remove',
    add: 'Add a device',
    codeTitle: 'Add a device',
    codeHelp:
      'On the other device, open Settings, then Sync, choose Join a sync, and scan this code or type it. It works ' +
      'once, for 24 hours.',
    codeLabel: 'Pairing code',
    qrLabel: 'QR code of the pairing code',
    copy: 'Copy the code',
    copied: 'The pairing code was copied.',
    close: 'Done',
  },
  explainer: {
    title: 'What is encrypted',
    item1:
      'Every page, picture, recording, and file is encrypted on this device with XChaCha20-Poly1305 before it is ' +
      'sent.',
    item2:
      'File names, notebook and page titles, and how your notebooks are organized are encrypted too. The folder or ' +
      'server sees only sealed blobs with random names, their rough sizes, and when they change.',
    item3:
      'Your passphrase never leaves this device. It unlocks the key through Argon2id, which makes guessing it slow.',
    item4:
      'Each device keeps its own key in Windows Credential Manager. OpenNote has no server and no copy of any key.',
    item5:
      'Password-protected sections stay sealed with their own password. Sync copies them as they are and never opens ' +
      'them.',
    item6: 'If you forget the passphrase, the recovery key is the only way back in. Nobody else can recover it.',
  },
  unfinished:
    "Setup didn't finish, because the recovery key wasn't checked, so sync hasn't started. Start again to get a new recovery key.",
  startAgain: 'Start again',
  wizard: {
    title: 'Set up sync',
    joinTitle: 'Join a sync',
    step: 'Step {step} of {count}',
    back: 'Back',
    next: 'Next',
    cancel: 'Cancel',
    finish: 'Finish',
    whereLabel: 'Where should sync keep its data?',
    folder: 'A folder',
    folderHelp: 'A folder that OneDrive, Dropbox, iCloud Drive, or Syncthing syncs, a network share, or a USB drive.',
    webdav: 'A WebDAV server',
    webdavHelp: 'Nextcloud, ownCloud, a NAS, or another server that speaks WebDAV.',
    folderPath: 'Folder',
    folderPathHelp: 'For example C:\\Users\\Sam\\OneDrive\\OpenNote Sync. Use an empty folder just for sync.',
    url: 'Server address',
    urlHelp: 'It starts with https://.',
    username: 'User name',
    password: 'Password or app password',
    passwordHelp: 'Kept in Windows Credential Manager on this device.',
    deviceName: 'Name for this device',
    deviceNameDefault: 'This PC',
    passphrase: 'Passphrase',
    passphraseHelp: 'At least 10 characters. A few unrelated words are easy to remember and hard to guess.',
    confirm: 'Type the passphrase again',
    mismatch: 'The two passphrases differ. Type them again.',
    tooShort: 'Use at least 10 characters.',
    needPlace: 'Fill in where sync keeps its data.',
    howLabel: 'How do you want to join?',
    byCode: 'With a pairing code',
    byCodeHelp: 'Make one on a device that already syncs: Settings, Sync, Add a device.',
    byPassphrase: 'With the passphrase',
    byRecovery: 'With the recovery key',
    code: 'Pairing code',
    recoveryKey: 'Recovery key',
    working: 'Setting up…',
    recoveryTitle: 'Save your recovery key',
    recoveryHelp:
      'This key is shown only once. If you forget your passphrase, it is the only way to unlock sync. Write it down ' +
      'or print it, and keep it somewhere safe, away from this device.',
    recoveryLabel: 'Recovery key',
    copyKey: 'Copy the recovery key',
    copiedKey: 'The recovery key was copied. Paste it somewhere safe, then clear your clipboard.',
    checkTitle: 'Check that you saved it',
    checkHelp: 'Type group {first} and group {second} of the recovery key.',
    groupLabel: 'Group {number}',
    checkWrong: 'That doesn\u2019t match. Look at the key you saved and try again.',
    ready: 'Sync is set up. The first sync starts now.',
    joined: 'This device joined sync. The first sync starts now.',
  },
  errors: {
    wrongSecret: 'That didn\u2019t unlock sync. Check the passphrase or key and try again.',
    noVault: 'There is no OpenNote sync in this place yet. Set sync up first, or choose the place you used before.',
    vaultExists: 'This place already holds OpenNote sync. Join it with your passphrase or a pairing code instead.',
    tampered:
      'A file in the sync storage was changed outside OpenNote, so sync is paused to keep your notes safe. Your ' +
      'notes here are unchanged.',
    rollback:
      'The sync storage holds older changes than this device has already seen, so sync is paused. If you restored it ' +
      'from a backup on purpose, choose Trust the storage as it is.',
    incomplete: 'Some changes from another device haven\u2019t arrived yet. OpenNote tries again shortly.',
    removed:
      'This device was removed from sync. Your notes here are kept. To sync again, turn sync off here and join again.',
    pairingExpired: 'That pairing code didn\u2019t work. Check it for typos, or make a new code on your other device.',
    clockAhead:
      'That pairing code has expired by another device’s clock, which is ahead of this one. Check the date and ' +
      'time on each device, then make a new code.',
    storage: 'The sync storage couldn\u2019t be reached. Check the folder or server, then choose Sync now.',
    local: 'A file in your notes folder couldn\u2019t be read or written. Close other apps using it, then try again.',
    weakPassphrase: 'Choose a passphrase of at least 10 characters. A few unrelated words work well.',
    newer: 'This sync was set up by a newer OpenNote. Update OpenNote on this device, then try again.',
    interrupted: 'Sync stopped before it finished. Nothing was lost; it continues next time.',
    paused: 'Sync is paused. Turn on Sync this device to sync again.',
    offline: 'Work offline is on, so sync waits. Turn it off to sync.',
    unknown: 'Sync didn\u2019t finish. Try again in a moment.',
  },
  commands: {
    now: 'Sync now',
    nowKeywords: 'sync synchronize upload download devices encrypted',
    pause: 'Pause sync',
    pauseKeywords: 'sync pause resume stop devices',
    preview: 'Preview sync changes',
    previewKeywords: 'sync preview dry run changes what will change',
    open: 'Sync settings',
    openKeywords: 'sync set up devices encryption passphrase recovery key pairing',
    changePassphrase: 'Change sync passphrase',
    changePassphraseKeywords: 'sync passphrase password change recovery key',
    notSetUp: 'Sync isn\u2019t set up yet. Set it up in Settings, then Sync.',
  },
} as const;
