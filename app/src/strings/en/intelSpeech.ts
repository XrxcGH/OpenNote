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
    help:
      'A new recording or audio file gets a transcript and a summary in the background, on this device. ' +
      'It needs Transcription and a speech model.',
    label: 'Transcript of {name}',
    recording: 'a recording',
    ready: 'The transcript of {name} is ready.',
  },
  cloud: {
    group: 'Where {feature} runs',
    device: 'On this device',
    deviceHelp: 'Nothing leaves this computer.',
    cloud: 'With my own key',
    cloudHelp: {
      transcription: 'Recordings are sent to {host} with your key, and their terms apply.',
      summaries: 'The text being summarized is sent to {host} with your key, and their terms apply.',
    },
    keyLabel: 'Key for {feature}',
    keyHelp: 'Your key is kept in Windows Credential Manager. OpenNote never shows it again.',
    saveKey: 'Save key',
    keySaved: 'A key is saved in Windows Credential Manager.',
    forget: 'Forget the key for {feature}',
    confirmTitle: 'Send this to a cloud service?',
    confirmBody: {
      transcription:
        'The recording’s audio goes to {host} with your key. Nothing else is sent, and Work offline stops it.',
      summaries:
        'The text you summarize goes to {host} with your key. Nothing else is sent, and Work offline stops it.',
    },
    confirm: 'Save key and use it',
    keepOnDevice: 'Keep it on this device',
    badKey: 'That doesn’t look like a key. Paste the whole key, with no spaces.',
    storeFailed: 'Windows Credential Manager couldn’t be used. The feature stays on this device.',
    saved: 'Your key is saved.',
    forgotten: 'The key is gone. The feature runs on this device again.',
    offlineFallback: 'Work offline is on, so this summary was made on this device.',
    failedFallback: 'The cloud service couldn’t be used, so this summary was made on this device.',
    privacyTitle: 'Cloud services with your key',
    privacyNone: 'Every smart feature runs on this device.',
    privacyLine: {
      transcription: 'Transcription sends recordings to {host}.',
      summaries: 'Summaries send the text to {host}.',
    },
    privacyNever: 'Not used',
    recommendedNoSpeech: 'Handwriting recognition, text in images, and summaries, all running on this device.',
    customHelp: 'Pick each feature yourself. Each runs on this device unless you give it your own cloud key.',
    setupPrivacy:
      'The features you gave your own key send their input to that service. ' +
      'Everything else runs on this device, and every feature can be turned off in Settings.',
  },
} as const;
