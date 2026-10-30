// The Settings page and its General and About sections.
// Every interface string is a full sentence here, never joined from pieces (ARCHITECTURE.md section 19).

export const settings = {
  title: 'Settings',
  back: 'Back to notes',
  backToSections: 'Back to settings',
  nav: 'Settings sections',
  sections: {
    general: 'General',
    appearance: 'Appearance',
    editing: 'Editing',
    language: 'Language',
    updates: 'Updates',
    shortcuts: 'Shortcuts',
    about: 'About',
  },
  general: {
    folderTitle: 'Notes folder',
    folderNone: "You haven't chosen a notes folder yet.",
    openFolder: 'Open folder',
    openFolderFailed: "Couldn't open the notes folder.",
    appTitle: 'Where OpenNote lives',
    appDev: 'This is a development build, so it runs from the build folder.',
    appHome: 'OpenNote is in your user programs folder, so it can update itself.',
    appElsewhere: 'OpenNote runs from {path}. Move it to your user programs folder so it can update itself.',
    addToStart: 'Add OpenNote to the Start menu',
    moveFailed: "Couldn't move OpenNote. Try again, or move it yourself.",
    startupTitle: 'Start-up',
    openLastPage: 'Open the last page at start-up',
    openLastPageHelp: 'When this is off, OpenNote opens your notebooks without a page.',
  },
  about: {
    details: 'About OpenNote',
    version: 'Version',
    architecture: 'Architecture',
    channel: 'Channel',
    webview: 'WebView2 version',
    license: 'License',
    licenseValue: 'Apache License 2.0',
    notReported: 'Not reported',
    notices: 'Open-source notices',
    noticesLabel: 'Copyright lines and license text of the bundled fonts',
    logFolder: 'Open the log folder',
    logFolderFailed: "Couldn't open the log folder.",
    goBack: 'Go back to version {version}',
    goBackTitle: 'Go back to version {version}?',
    goBackBody: 'OpenNote restarts with the earlier version. Your notes and settings stay as they are.',
    goBackConfirm: 'Go back',
    goBackFailed: "Couldn't go back to the earlier version.",
    snapshot: 'Notes in this version are a preview. They stay in a temporary file until storage arrives.',
    experimental: 'Experimental features',
    experimentalHelp: "These features aren't finished. Turn one on to try it, and expect problems.",
    channels: { dev: 'Development', nightly: 'Nightly', beta: 'Beta', stable: 'Stable' },
    architectures: { x64: 'x64', x86: 'x86', arm64: 'ARM64' },
    system: 'System',
    systems: { windows: 'Windows', macos: 'macOS', linux: 'Linux' },
    webviewOther: 'Web view',
    webviews: { windows: 'WebView2', macos: 'WebKit (WKWebView)', linux: 'WebKitGTK' },
    limitsTitle: 'What works differently on {system}',
    limitsIntro: 'Everything else works as it does on Windows. Your notes stay on this computer either way.',
    limits: {
      textInPictures:
        "Text in pictures and scanned pages isn't found by search yet, because it needs Windows' text recognition.",
      handwriting:
        "Handwriting doesn't turn into text yet, because it needs Windows Ink Analysis. Your ink is kept as drawn.",
      readAloud:
        "Read aloud has no voices yet, because it uses the voices Windows has. Copy the text to your system's reader instead.",
      hello: 'Protected sections open with their password. Windows Hello is a Windows feature.',
      pdf: "Saving a page as PDF and printing aren't here yet. Export the page as Word or HTML, then print that.",
      systemAudio:
        'Recording what the computer plays may not start, because the system has no loopback device. Record the microphone instead.',
      shareTarget:
        'Sharing to OpenNote from other apps is a Windows feature. Drag files or paste them into a page instead.',
      windowTools: 'Docking to a screen edge, Snap Layouts, and the custom title bar are Windows features.',
      updates:
        "OpenNote doesn't install updates itself on a Mac yet. Download the new dmg and drag OpenNote to Applications.",
      commandLine:
        "The opennote command-line tool isn't included yet. Build it from the source with cargo build -p opennote-cli.",
      penPressure:
        'Pen pressure depends on the desktop: some Linux setups report none, and strokes then have one width.',
    },
  },
} as const;
