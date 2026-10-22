// Local videos on a page: the commands, the messages when a file is refused, and the block.

export const video = {
  commands: {
    insert: 'Insert video file',
    insertKeywords: 'video mp4 webm movie clip file local play embed',
    slash: 'Video file',
    captions: 'Add captions to a video',
    captionsKeywords: 'video captions subtitles vtt webvtt',
  },
  insert: {
    nothing: 'Open a page first.',
    needsApp: 'Videos can be added in the OpenNote app.',
    working: 'Adding “{name}”…',
    done: 'Added the video “{name}”.',
    notVideo: '“{name}” is not an MP4 or webm video, so it was not added.',
    tooLarge: '“{name}” is larger than {limit} MB, so it was not added.',
    damaged: '“{name}” does not look like a real video file, so it was not added.',
    failed: '“{name}” could not be added.',
  },
  captions: {
    notCaptions: '“{name}” is not a WebVTT caption file (.vtt), so it was not added.',
    tooLarge: '“{name}” is too large to be a caption file.',
    added: 'Added captions to “{name}”.',
    removed: 'Removed the captions from “{name}”.',
  },
  block: {
    label: 'Video: {name}',
    player: 'Video {name}.',
    playerKeys:
      'Space plays or pauses. Left and right arrows skip 5 seconds. ' +
      'Up and down arrows change the volume. C turns captions on or off. F opens full screen.',
    unavailable: 'This video can’t be shown. The file is unchanged.',
    unreadable: 'This browser can’t play “{name}”.',
    addCaptions: 'Add captions',
    replaceCaptions: 'Replace captions',
    removeCaptions: 'Remove captions',
    captionsLabel: 'Captions',
    hint: 'Space plays or pauses. Arrow keys skip and change the volume. C toggles captions.',
    captionsOn: 'Captions on',
    captionsOff: 'Captions off',
    volume: 'Volume {percent}',
  },
} as const;
