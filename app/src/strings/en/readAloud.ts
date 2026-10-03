// Read aloud and its settings (owner: WP7).
// Each namespace file has one owner, so parallel work never edits the same file.

export const readAloud = {
  commands: {
    toggle: 'Read aloud',
    next: 'Read next paragraph',
    previous: 'Read previous paragraph',
    stop: 'Stop reading aloud',
    keywords: 'read aloud speak speech voice listen text to speech',
  },
  bar: 'Read aloud',
  play: 'Play',
  pause: 'Pause',
  next: 'Next paragraph',
  previous: 'Previous paragraph',
  stop: 'Stop',
  speed: 'Speed',
  rate: '{rate}×',
  voice: 'Voice',
  progress: '{index} of {total}',
  noVoices: 'No voices are installed on Windows.',
  openSpeechSettings: 'Open Windows speech settings',
  unavailable: "Read aloud isn't available here.",
  codeBlock: '{count, plural, one {Code block, # line} other {Code block, # lines}}',
  table: 'Table',
  image: 'Image: {alt}',
  settings: {
    title: 'Read aloud',
    localOnly: 'Only voices installed on Windows read your notes, so the text never leaves this device.',
    readCode: 'Read code aloud',
  },
} as const;
