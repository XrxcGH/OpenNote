// The audio lane's later features (quality of life after Phase 9): the Recording section of Settings, splitting and
// enhancing a recording, the storage list, the meeting prompt, snapping the screen, files dropped on a page, export,
// and the transcripts, speakers, recap, action items and chapters. One owner, so parallel work never edits it.

export const audioMore = {
  settings: {
    title: 'Recording',
    intro: 'Choices for recording on this PC. Recordings stay in your notes, on this device.',
    microphone: 'Microphone',
    defaultMicrophone: 'The default microphone',
    systemAudio: 'Record the PC’s sound too',
    systemAudioHelp: 'For meetings: the other people’s voices come through the speakers.',
    quality: 'Compress saved recordings to',
    qualitySmaller: 'Smaller: about half the size',
    qualitySmallest: 'Smallest: about a third of the size',
    qualityHelp: 'New recordings are always saved at full quality. This is what Compress uses later.',
    meeting: 'Offer to record when another app uses the microphone',
    meetingHelp:
      'OpenNote sees which app is using the microphone, never what is said. It never records on its own: it only asks.',
    storage: 'Manage recordings',
    storageHelp: 'See how much space each recording takes, compress it, or remove its audio.',
  },
} as const;
