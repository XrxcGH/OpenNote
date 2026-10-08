// On-device speech and language (the intelligence lane, beta 5): transcription with a downloaded Whisper model,
// automatic transcripts, speakers, dictation, live captions, math recognition, the language model, and translation.
// Each namespace file has one owner, so parallel work never edits the same file.

export const intelSpeech = {
  transcribe: {
    noModel: 'Transcription needs a speech model on this device. Download one in On-device intelligence.',
    getModel: 'Open settings',
    off: 'Transcription is off.',
    canceled: 'The transcript was stopped.',
    failed: 'The transcript couldn’t be made.',
    progress: 'Making the transcript, {percent}% done.',
    stop: 'Stop',
    notMade: 'No transcript was made.',
  },
  auto: {
    switch: 'Make a transcript and summary of every recording',
    help: 'When a recording stops or an audio file is added, its transcript and summary are made in the background, on this device. It needs Transcription and a speech model.',
    label: 'Transcript of {name}',
    recording: 'a recording',
    ready: 'The transcript of {name} is ready.',
  },
} as const;
