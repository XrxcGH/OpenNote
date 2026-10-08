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
} as const;
