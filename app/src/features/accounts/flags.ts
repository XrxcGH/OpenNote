// The flags of the account and media features: what a connected account unlocks (sync, share, send, import, meeting
// notes) and the media features that came with them (players, live embeds, a narrated video). Each is on in
// development, nightly, and Beta builds, and off in Stable until it has had its time in Beta. app/flags.ts joins
// this list to the others.
import type { FlagDef, FlagId } from '../../app/flags';

export type AccountsFlagId = Extract<
  FlagId,
  `accounts.${string}` | 'page.mediaEmbeds' | 'page.liveEmbeds' | 'audio.exportVideo'
>;

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const beta = { dev: true, nightly: true, beta: true, stable: false };

const flag = (id: AccountsFlagId, description: string): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled: beta,
});

export const ACCOUNTS_FLAGS: readonly FlagDef[] = [
  flag('accounts.readwise', 'Sync Readwise: bring highlights into a notebook.'),
  flag('accounts.meetings', 'New meeting note from a calendar event or an .ics file.'),
  flag('accounts.share', 'Share a page to Slack or Teams.'),
  flag('accounts.lms', 'Canvas, Moodle, and Classroom courses and assignments, and Submit page as PDF.'),
  flag('accounts.sendTo', 'Send to Google Drive or OneDrive, and Update the copy.'),
  flag('accounts.googleOffice', 'Import and export Google Docs, Sheets, and Slides.'),
  flag('accounts.onenoteGraph', 'Import OneNote notebooks through Microsoft Graph.'),
  flag('accounts.tasksSync', 'Two-way sync with Microsoft To Do and Google Tasks.'),
  flag('accounts.cloudSync', 'Dropbox, Box, and WebDAV: send pages and sync a folder.'),
  flag('accounts.penSync', 'Pen sets, colors, and toolbar layout synced across devices.'),
  flag('accounts.youtubeUpload', 'Upload a recording video to YouTube as private or unlisted.'),
  flag('accounts.captions', 'Transcripts from YouTube and Vimeo captions.'),
  flag('page.mediaEmbeds', 'Player blocks for YouTube, Vimeo, and podcast links, with notes stamped to the playhead.'),
  flag('page.liveEmbeds', 'Live embeds for Desmos, GeoGebra, Figma, Miro, and Lucidchart.'),
  flag('audio.exportVideo', 'Export a recording as a narrated video.'),
];
