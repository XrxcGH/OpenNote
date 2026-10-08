// On-device intelligence (Phase 12): the Settings section, the offer to turn a feature on, copying text from an
// image, handwriting to text, summaries, and the messages for a missing language pack or voice.
// Each namespace file has one owner, so parallel work never edits the same file.

export const intel = {
  settings: {
    title: 'On-device intelligence',
    intro: 'These features read your notes on this computer. Nothing is sent anywhere.',
    introOff: 'Each one stays off until you turn it on.',
    localOnly: 'Runs on this device. Nothing leaves it.',
    ocr: {
      label: 'Text in images',
      help: 'Finds words in pictures and screenshots, so you can copy and search them.',
    },
    handwriting: {
      label: 'Handwriting',
      help: 'Turns handwriting into text you can copy and search, using Windows recognition.',
    },
    readAloud: {
      label: 'Read aloud',
      help: 'Reads a page in a voice installed on Windows, highlighting each word.',
    },
    summaries: {
      label: 'Summaries and keywords',
      help: 'Picks the sentences and keywords that best stand for a page. It writes nothing new.',
    },
    status: {
      off: 'Off',
      ready: 'On and ready',
      checking: 'On, checking this computer',
      unavailable: 'On, but not ready: {reason}',
      loadFailed: "Couldn't load these settings.",
      saveFailed: "Couldn't save that change.",
    },
    needsGeneric: "this computer can't run it.",
    openLanguageSettings: 'Open Windows language settings',
    openSpeechSettings: 'Open Windows speech settings',
  },
  offer: {
    title: 'Turn on {feature}?',
    ocr: 'OpenNote can read the words in this image, using the text recognition built into Windows.',
    handwriting: 'OpenNote can turn this handwriting into text, using Windows recognition.',
    readAloud: 'OpenNote can read this page aloud in a voice installed on Windows.',
    summaries: 'OpenNote can pick the sentences and keywords that best stand for this page.',
    where: 'It runs on this device, and nothing leaves it. You can turn it off in Settings.',
    turnOn: 'Turn on',
    notNow: 'Not now',
  },
  features: {
    ocr: 'text in images',
    handwriting: 'handwriting recognition',
    readAloud: 'read aloud',
    summaries: 'summaries and keywords',
  },
  problems: {
    languageUnavailable: 'Windows has no text recognition language installed.',
    voiceUnavailable: 'Windows has no voice installed.',
    handwritingUnavailable: 'Windows has no handwriting recognition installed.',
    unsupported: "This isn't available on this computer.",
    failed: "Couldn't do that. Try again.",
  },
  commands: {
    copyImageText: 'Copy text from image',
    copyImageTextShort: 'Copy text',
    copyImageTextKeywords: 'ocr recognize picture screenshot extract scan words',
    summarizePage: 'Summarize this page',
    summarizePageKeywords: 'summary keywords key points short',
    handwritingToText: 'Convert handwriting to text',
    handwritingToTextKeywords: 'ink pen recognize write',
  },
  imageText: {
    working: 'Reading the image',
    copied: 'Copied the text.',
    none: 'No text was found in the image.',
    noImage: 'That image is missing.',
  },
  handwriting: {
    working: 'Reading the handwriting',
    inserted: 'Added the text below.',
    none: 'No words were found.',
    undo: 'Undo',
  },
  summary: {
    title: 'Summary',
    description: 'Picked from the page, in its own words.',
    sentences: 'Key sentences',
    keywords: 'Keywords',
    jumpHint: 'Choose a sentence to go to it.',
    shown: 'Showing {count, plural, one {# sentence} other {# sentences}} of {total}.',
    empty: "This page doesn't have enough text to summarize yet.",
    copy: 'Copy summary',
    copied: 'Copied the summary.',
    close: 'Close',
  },
} as const;
