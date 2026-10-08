// Share a page to Slack or Teams: the commands, the questions, and what is said when it is done.

export const accountsShare = {
  commands: {
    slack: 'Share page to Slack',
    teams: 'Share page to Teams',
    keywords: 'share post send message channel slack teams chat colleagues',
  },
  channel: {
    title: 'Which channel?',
    description: 'The page is posted as you, to the channel you choose.',
    confirm: 'Next',
    none: 'No channels were found. Join one in {service}, then try again.',
    teamsTitle: 'Which team?',
    teamsChannelTitle: 'Which channel in {team}?',
  },
  kind: {
    title: 'What should be posted?',
    description: 'A PDF or a picture is a copy of the page as it is now. A link opens the page in OpenNote.',
    confirm: 'Post',
    pdf: 'PDF',
    pdfDetail: 'The whole page as a file',
    png: 'Picture',
    pngDetail: 'The page, or the lasso selection, as an image',
    link: 'Link',
    linkDetail: 'A link that opens in OpenNote. Only people with OpenNote and this notebook can follow it.',
  },
  message: {
    link: '{title}: {link}',
    file: '{title}',
  },
  working: 'Posting to {channel}…',
  done: 'Posted “{title}” to {channel}.',
  nothing: 'There is no page to share. Open a page, then try again.',
  failedRender: 'The page could not be made into a file, so nothing was posted.',
} as const;
