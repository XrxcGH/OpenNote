// The intel lane's later features: handwriting in search, the visual equation editor, speakers, dictation, live
// captions, math from handwriting, the writing and answer models, and translation. One owner, so parallel work never
// edits the same file.

export const intelMore = {
  inkHit: {
    mark: 'Found in your handwriting',
    marked: 'Marked {count} words in your handwriting.',
  },
  dictation: {
    command: 'Dictate',
    commandKeywords: 'dictate speak voice type talk microphone',
    stopCommand: 'Stop dictating',
    needsEditor: 'Click in a text block first, then dictate.',
    listening: 'Listening. Your words are typed at the cursor.',
    hearing: 'Hearing you',
    waiting: 'Starting',
    stop: 'Stop dictating',
    stopped: 'Dictation stopped.',
    failed: 'Dictation stopped: {message}',
    region: 'Dictation',
    privacy: 'The microphone is on. Sound is read on this device and never kept.',
    behind: 'Catching up',
    help: 'Say "period", "comma", "new line", "new paragraph", or "undo that".',
  },
  math: {
    command: 'Convert handwriting to math',
    commandKeywords: 'equation math handwriting ink convert latex fraction',
    working: 'Reading your handwritten math.',
    none: 'No math was found in the selected writing.',
    inserted: 'Added the equation below the page.',
    undo: 'Undo',
    unread: 'Left out {count} symbols that could not be read.',
    penWrite: 'Write with pen',
    penDone: 'Use writing',
    penClear: 'Clear',
    penPad: 'Writing area for math',
    penHelp: 'Write the equation with a pen or finger, then choose Use writing.',
    penNone: 'Nothing could be read. Try writing larger.',
  },
  captions: {
    region: 'Live captions',
    switch: 'Show live captions while recording',
    help: 'Words appear as people speak and go away when the recording ends. They follow your Windows caption settings.',
    position: 'Where captions sit',
    bottom: 'At the bottom',
    top: 'At the top',
    behind: 'Captions are running behind on this computer.',
    waiting: 'Listening for speech',
    off: 'Live captions are off for this recording.',
    failed: 'Live captions stopped: {message}',
    started: 'Live captions are on.',
  },
} as const;
