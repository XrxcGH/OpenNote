// Players and live embeds on a page: the commands, the link question, the block, and the captions.

export const accountsMedia = {
  commands: {
    insert: 'Insert video, podcast, or embed from link',
    insertKeywords:
      'youtube vimeo podcast spotify apple video player desmos geogebra figma miro lucidchart embed link live',
    captions: 'Add captions as a transcript',
    captionsKeywords: 'youtube vimeo captions subtitles transcript video',
    slash: 'Video or embed from a link',
  },
  ask: {
    title: 'Insert from a link',
    description:
      'Paste the address of a YouTube or Vimeo video, a podcast episode, or a Desmos, GeoGebra, Figma, Miro, or Lucidchart page.',
    label: 'Link',
    help: 'Only these sites are shown on a page. Anything else stays a normal link.',
    confirm: 'Insert',
    unknown: 'That link is not one of the sites that can be shown on a page. It was left as it is.',
    liveOff: 'Live embeds are turned off.',
    nothing: 'Open a page first.',
  },
  block: {
    labelPlayer: '{provider}: {title}',
    labelLive: '{provider} embed: {title}',
    play: 'Play',
    playNamed: 'Play {title}',
    loadLive: 'Show the live view',
    loadLiveNamed: 'Show the live view of {title}',
    open: 'Open the link',
    openNamed: 'Open {title} in the browser',
    savedPicture: 'Saved picture of {title}',
    noPicture: '{provider}',
    offlineNote: 'You are working offline. This is the saved picture. The link opens when you are back online.',
    stampNote: 'Notes you type while this plays are time-stamped. Alt+click a note to jump back to its moment.',
    noStampNote: 'This site does not tell OpenNote where the playhead is, so notes are not time-stamped.',
    frameTitle: '{title}, {provider}',
    unavailable: 'This embed can’t be shown. Its link is unchanged.',
    fallbackProvider: '{provider}',
  },
  transcript: {
    summary: 'Transcript, {count, plural, one {# line} other {# lines}}',
    show: 'Show the transcript',
    hide: 'Hide the transcript',
    lineAt: 'Jump to {time}: {text}',
    language: 'Language: {language}',
  },
  captions: {
    pick: 'Which video?',
    pickDescription: 'The captions become the transcript of the video you choose.',
    pickConfirm: 'Add captions',
    working: 'Reading the captions…',
    done: 'Added {count, plural, one {# caption line} other {# caption lines}} to “{title}”.',
    none: 'This video has no captions that OpenNote can read.',
    noVideos: 'This page has no YouTube or Vimeo video. Insert one from a link first.',
    notOwner:
      'YouTube lets only the owner of a video read its captions. This video’s captions can’t be read with your account.',
    needsConnect: 'Connect {service} in Settings, then Connectors, to read captions.',
    wrongSite: 'Captions can be read for YouTube and Vimeo videos.',
  },
} as const;
