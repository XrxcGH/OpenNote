// The account features: what a connected account unlocks (meeting notes, sharing, sending, syncing, imports) and the
// media features that came with them. The platforms import the host's types and the in-memory host from here.

export { createFakeAccountsHost } from './fakeHost';
export type { FakeAccountsHost, FakeHostOptions } from './fakeHost';
export { accountsHost, base64Of, bytesPart } from './host';
export type { AccountsHost, Downloaded, UploadPart } from './host';
export { askText, pickOne } from './ui/prompts';
export type { UploadRequest } from './youtube/commands';
/** Uploads a recording's video to YouTube. The code loads when it is first called. */
export const uploadRecordingToYoutube = (...args: Parameters<typeof import('./youtube/commands').uploadRecording>) =>
  import('./youtube/commands').then((module) => module.uploadRecording(...args));
export { failureText, isConnected, tellNotConnected } from './run';
