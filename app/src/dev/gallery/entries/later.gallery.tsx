// The components of Phases 7 to 13 and the quality-of-life features that take plain props, in their states (A4-37):
// the connector card, the flashcard face, and the cloud folder notice. They get pictures and an axe pass from the day
// they are listed. The screens that need the app around them are in tests/ui/screens/later.ts.

import { ConnectorCard } from '../../../features/connectors';
import type { ConnectorInfo } from '../../../features/connectors';
import { CloudNotice } from '../../../features/qol';
import { CardFace } from '../../../features/study';
import { defineGallery } from '../registry';

const microsoft: ConnectorInfo = {
  id: 'microsoft',
  name: 'Microsoft',
  group: 'microsoft',
  auth: 'oauth',
  features: ['importOneNote', 'outlookCalendar', 'microsoftToDo'],
  access: [
    { capability: 'account', writes: false },
    { capability: 'onenoteRead', writes: false },
    { capability: 'tasksWrite', writes: true },
  ],
  hosts: ['login.microsoftonline.com', 'graph.microsoft.com'],
  state: { kind: 'notConnected' },
  baseUrl: null,
  pending: false,
  lastUsedUnix: null,
};

const none = () => Promise.resolve(false);
const noop = () => undefined;

function Card(props: { info: ConnectorInfo; offline?: boolean }) {
  return (
    <ConnectorCard
      info={props.info}
      offline={props.offline ?? false}
      offlineNoticeId="gallery-offline"
      onConnect={none}
      onCancel={noop}
      onDisconnect={noop}
      onSetup={noop}
      onOpenFolder={noop}
    />
  );
}

/** The cards are list items, so they sit in a list that adds no look of its own. */
const LIST = { display: 'contents' } as const;

export default defineGallery([
  {
    id: 'connectors.card.states',
    title: 'Connector cards',
    group: 'Connectors',
    description: 'Not connected, needing setup, connected, and needing to connect again.',
    render: () => (
      <ul style={LIST}>
        <Card info={microsoft} />
        <Card info={{ ...microsoft, state: { kind: 'needsSetup' } }} />
        <Card
          info={{
            ...microsoft,
            state: { kind: 'connected', account: 'sam@example.com', connectedUnix: 1_790_000_000 },
            lastUsedUnix: 1_790_100_000,
          }}
        />
        <Card info={{ ...microsoft, state: { kind: 'expired', account: 'sam@example.com' } }} />
      </ul>
    ),
  },
  {
    id: 'connectors.card.offline',
    title: 'Connector card, Work offline',
    group: 'Connectors',
    description: 'Connect waits while Work offline is on, and the card says why.',
    render: () => (
      <>
        <p id="gallery-offline">Work offline is on. Connecting waits until it is off.</p>
        <ul style={LIST}>
          <Card info={microsoft} offline />
        </ul>
      </>
    ),
  },
  {
    id: 'study.cardface.states',
    title: 'Flashcard faces',
    group: 'Study',
    description: 'A basic card, a cloze card, and a multiple choice card, each with its answer hidden and shown.',
    render: () => (
      <>
        <CardFace
          card={{ id: 'c1', kind: 'basic', front: 'What crosses a membrane by osmosis?', back: 'Water' }}
          shown={false}
          picked={null}
          onPick={noop}
        />
        <CardFace
          card={{ id: 'c1', kind: 'basic', front: 'What crosses a membrane by osmosis?', back: 'Water' }}
          shown
          picked={null}
          onPick={noop}
        />
        <CardFace
          card={{ id: 'c2', kind: 'cloze', front: 'The {{nucleus}} holds the cell’s DNA.', back: '' }}
          shown={false}
          picked={null}
          onPick={noop}
        />
        <CardFace
          card={{
            id: 'c3',
            kind: 'choice',
            front: 'Which organelle makes ATP?',
            back: '',
            choices: ['Ribosome', 'Mitochondrion', 'Golgi body'],
            answer: 1,
          }}
          shown
          picked={0}
          onPick={noop}
        />
      </>
    ),
  },
  {
    id: 'qol.cloudnotice.states',
    title: 'Cloud folder notice',
    group: 'Storage',
    description:
      'The notice for a notebook in a synced folder, where the app can keep it on the device and where it cannot.',
    render: () => (
      <>
        <CloudNotice
          folder="C:\Users\Sample\OneDrive\Notes"
          info={{ service: 'oneDrive', name: 'OneDrive', canPin: true }}
        />
        <CloudNotice
          folder="C:\Users\Sample\Dropbox\Notes"
          info={{ service: 'dropbox', name: 'Dropbox', canPin: false }}
        />
      </>
    ),
  },
]);
