// What the two chat services share: a destination the person chooses, and a page to post there.

export interface Channel {
  /** The service's ID for it. */
  id: string;
  name: string;
  /** Teams: the team the channel is in. */
  team?: string;
}

export interface Team {
  id: string;
  name: string;
}

export type ShareKind = 'pdf' | 'png' | 'link';

/** What is posted: a file, or a link with the page's title. */
export type Shared =
  | { kind: 'file'; title: string; name: string; mime: string; bytes: Uint8Array }
  | { kind: 'link'; title: string; link: string };
