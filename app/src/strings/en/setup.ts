// First-run setup (ARCHITECTURE.md section 17).
// Every interface string is a full sentence here, never joined from pieces (ARCHITECTURE.md section 19).

export const setup = {
  title: 'Set up OpenNote',
  progress: 'Step {step} of {count}',
  // checks-disable-next-line ui-voice: the rule reads each placeholder as a capitalized name
  announceStep: 'Step {step} of {count}, {title}.',
  actions: {
    back: 'Back',
    continue: 'Continue',
    getStarted: 'Get started',
    finish: 'Start taking notes',
    working: 'Setting up',
  },
  errors: {
    finish: "Couldn't finish setting up. Your choices are saved, so you can try again.",
    move: "Couldn't move OpenNote, so it stays where it is. You can try again in Settings.",
  },
  steps: {
    welcome: 'Welcome to OpenNote',
    look: 'Choose your look',
    storage: 'Where to keep things',
  },
  welcome: {
    body: 'OpenNote is a notebook for typing, handwriting, and recording, and your notes stay in files you own.',
    next: 'Setup takes about a minute. You can change every choice later in Settings.',
  },
  look: {
    subtitle: 'Change it any time with the moon button in the title bar, or press {shortcut}.',
    subtitleNoShortcut: 'Change it any time with the moon button in the title bar.',
    preselectedLight: 'Preselected because Windows is set to Light.',
    preselectedDark: 'Preselected because Windows is set to Dark.',
  },
  storage: {
    subtitle: 'Your notes are plain files you own. Updates never touch them.',
    notes: {
      label: 'Your notes',
      change: 'Change folder',
      checking: 'Checking the folder.',
      willCreate: 'OpenNote will create this folder.',
      ok: 'OpenNote can save notes in this folder.',
      hasLibrary: 'This folder has {count, plural, one {# notebook} other {# notebooks}}. OpenNote will open them.',
      notWritable: "OpenNote can't save in this folder. Choose another one.",
      insideAppFolder:
        'This folder is inside the OpenNote app folder, where an update could replace it. Choose another one.',
      notAbsolute: 'Choose a folder on this PC by its full path, such as C:\\Users\\you\\Documents\\OpenNote.',
    },
    app: {
      label: 'The app',
      move: 'Add OpenNote to the Start menu (recommended)',
      moveDetail: 'Moves OpenNote to your user folder. No administrator rights needed.',
      keep: 'Keep it where it is',
      keepDetail: '{path}',
      keepDetailReadOnly: "{path} OpenNote can't update itself in this folder.",
      inPlace: 'OpenNote already runs from your user folder, so there is nothing to move.',
      development: 'This is a development build, so it stays where it is.',
    },
    notebook: {
      label: 'Your first notebook',
      name: 'Notebook name',
      nameHelp: 'Quick notes is the first section, with an empty page ready to write on.',
      defaultName: 'My notebook',
      emptyName: 'Give the notebook a name.',
      color: 'Notebook color',
      colors: {
        fern: 'Fern',
        brick: 'Brick',
        indigo: 'Indigo',
        plum: 'Plum',
        amber: 'Amber',
      },
      firstSection: 'Quick notes',
    },
  },
} as const;
