// The update chip, its popover, the Updates section, the update commands, and the update notices.
// Every interface string is a full sentence here, never joined from pieces (ARCHITECTURE.md section 19).

export const updates = {
  chip: {
    ready: 'Update ready',
    available: 'Update available',
  },
  size: '{size} MB',
  details: {
    readyTitle: 'Version {version} is ready',
    readyBody: 'Downloaded and checked. Restarting takes about 2 seconds.',
    availableTitle: 'Version {version} is available',
    availableBody: "It's a {size} download.",
    waitingForUnmetered: "It downloads when you're on a network without a data limit.",
    downloadingTitle: 'Downloading version {version}',
    downloadProgress: 'Download progress',
    verifyingTitle: 'Checking version {version}',
    verifyingBody: 'Making sure the download is complete and signed by OpenNote.',
    applyingTitle: 'Installing version {version}',
    notes: 'Release notes',
  },
  blocked: {
    unsavedChanges: 'Finish saving your changes first.',
    recording: 'Finish the recording first.',
  },
  actions: {
    restart: 'Restart to update',
    whatsNew: "What's new",
    later: 'Later',
    download: 'Download',
    skip: 'Skip this version',
    check: 'Check for updates',
    checking: 'Checking…',
    installSkipped: 'Install it',
    goBack: 'Go back to version {version}',
    moveApp: 'Add OpenNote to the Start menu',
    openDownloads: 'Open the download page',
  },
  announce: {
    readyAuto: 'Update ready. It installs when you close OpenNote, or choose Restart to update.',
    readyAsk: 'Update ready. Restart OpenNote to install it.',
  },
  status: {
    devBuild: 'Updates are off in development builds.',
    noKey:
      'Updates are off in this copy of OpenNote, because it was built without an update key. ' +
      'Download new versions from the download page.',
    notWritable:
      "OpenNote can't update itself in this folder. " +
      'Add it to the Start menu, which moves it to your user folder, or download the new version.',
    manualMode: 'OpenNote checks for updates only when you ask.',
    idle: 'OpenNote checks for updates in the background.',
    checking: 'Checking for updates…',
    upToDate: 'OpenNote is up to date.',
    lastCheck: 'Last checked {date} at {time}.',
    retryAt: 'OpenNote tries again at {time}.',
  },
  errors: {
    offline: "Couldn't check for updates, because you're offline.",
    unreachable: "Couldn't reach the update server.",
    verifyFailed: "The update didn't pass its safety checks, so it wasn't installed.",
    diskFull: "There isn't enough free disk space for the update.",
    swapFailed: "Couldn't install the update. OpenNote will try again later.",
    unknown: "Couldn't update OpenNote.",
  },
  section: {
    title: 'Updates',
    version: 'OpenNote {version}',
    status: 'Update status',
    installLabel: 'How to install updates',
    installAuto: 'Install updates automatically (recommended)',
    installAutoHelp: 'Updates download in the background and install when you close OpenNote.',
    installAsk: 'Ask before installing',
    installAskHelp: 'OpenNote checks for updates and asks before downloading one.',
    installManual: 'Only check when I ask',
    installManualHelp: 'OpenNote never checks by itself.',
    channelLabel: 'Update channel',
    channelStable: 'Stable',
    channelStableHelp: 'Tested releases.',
    channelBeta: 'Beta',
    channelBetaHelp: 'Early versions, every two weeks. You also get newer stable versions.',
    skipped: 'Version {version} is skipped.',
    previous: 'The previous version is kept, so you can go back to it.',
    safety: 'Updates never change your notes or settings. A backup is made before any file conversion.',
  },
  goBack: {
    title: 'Go back to version {version}?',
    body:
      'OpenNote restarts. Your notes and settings stay as they are, ' +
      'and notes saved by the newer version open read-only.',
    confirm: 'Go back',
  },
  notices: {
    updated: 'OpenNote is updated to version {to}.',
    rolledBack:
      "OpenNote {from} didn't start correctly, so you're back on {to}. Your notes and settings weren't changed.",
    report: 'Report the problem',
    rollbackUnavailable: "OpenNote {from} isn't starting correctly, and the previous version is missing.",
    downloadPrevious: 'Download OpenNote {version}',
  },
  commands: {
    check: 'Check for updates',
    restart: 'Restart to update',
    goBack: 'Go back to the previous version',
    download: 'Download the update',
    skip: 'Skip this update',
    unskip: 'Install the skipped update',
    whatsNew: 'Open the release notes',
    report: 'Report a problem with an update',
    moveApp: 'Add OpenNote to the Start menu',
  },
} as const;
