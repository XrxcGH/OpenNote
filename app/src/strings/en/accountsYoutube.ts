// Upload to YouTube: the choice of who can see the video, its name, and what is said while it goes.

export const accountsYoutube = {
  commands: {
    upload: 'Upload the recording to YouTube',
    keywords: 'youtube upload video private unlisted recording lesson',
  },
  menu: { upload: 'Upload to YouTube…' },
  privacy: {
    title: 'Who can see the video?',
    description: 'OpenNote uploads it as private or unlisted. You can make it public yourself in YouTube Studio.',
    confirm: 'Choose',
    private: 'Private',
    privateDetail: 'Only you can see it.',
    unlisted: 'Unlisted',
    unlistedDetail: 'Anyone with the link can see it. It is not listed or searchable.',
  },
  name: {
    title: 'Name the video',
    description: 'This is the title on YouTube. Nothing is sent until you choose Upload.',
    label: 'Title',
    confirm: 'Upload',
  },
  making: 'Making the video…',
  sending: 'Uploading to YouTube…',
  progress: 'Uploading, {percent} percent.',
  donePrivate: 'Uploaded as private. The link is on your clipboard, and the video is in YouTube Studio.',
  doneUnlisted: 'Uploaded as unlisted. The link is on your clipboard.',
  needsVideo: 'Turn on Export as video to upload a recording.',
} as const;
