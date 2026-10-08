// The account and media features: meeting notes, sharing, sending, syncing, importing from services, players, live
// embeds, and the narrated video. One owner (the accounts and media lane), so parallel work never edits it. Each
// feature has its own group below.

import { accountsLms } from './accountsLms';
import { accountsMeetings } from './accountsMeetings';
import { accountsReadwise } from './accountsReadwise';
import { accountsShare } from './accountsShare';

export const accounts = {
  readwise: accountsReadwise,
  meetings: accountsMeetings,
  share: accountsShare,
  lms: accountsLms,
  common: {
    notConnected: '{service} isn’t connected. Connect it in Settings, then Connectors.',
    needsAccess: 'The {service} connection doesn’t allow this yet. Connect it again in Settings, then Connectors.',
    offline: 'Work offline is on, so OpenNote can’t reach {service}.',
    failed: '{service} didn’t answer. {message}',
    status: 'The service answered with code {status}.',
    working: 'Working with {service}…',
    cancel: 'Cancel',
    choose: 'Choose',
    noPage: 'Open a page first.',
    openSettings: 'Open Connectors',
  },
  audio: {
    noRecording: 'There is no finished recording on this page.',
  },
} as const;
