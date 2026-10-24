// The two small dialogs of links on handwriting: "Make link", which asks for a target, and "Links on this page", a list
// that a keyboard or a screen reader can walk. Each row can open its link or select its writing, which draws the
// selection frame around it as the link's focus outline.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { commandContext } from '../../../commands/registry';
import { t } from '../../../strings/t';
import { Button, Dialog, RadioCard, RadioGroup, TextField } from '../../../ui';
import { say } from './say';
import { maybeSearchClient, openPage } from '../../search';
import type { InkHost } from './host';
import { inkLinks, isWebAddress, linkSelection, liveLinks } from './inkLinks';
import type { InkLink, LinkTarget } from './inkLinks';
import type { InkSurface } from './surface';

type Kind = 'page' | 'url' | 'recording';

export interface MadeLink {
  readonly target: LinkTarget;
  readonly label: string;
}

interface Suggestion {
  readonly page: string;
  readonly title: string;
}

// checks-disable-next-line modifiability: one component whose parts share its state; split it when it grows again
function MakeLinkDialog(props: { canRecord: boolean; initialLabel: string; done: (answer: MadeLink | null) => void }) {
  const { canRecord, initialLabel, done } = props;
  const [kind, setKind] = useState<Kind>('page');
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Suggestion | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [heading, setHeading] = useState('');
  const [url, setUrl] = useState('https://');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = maybeSearchClient();
    if (kind !== 'page' || !client || chosen) return;
    let live = true;
    void client.suggestPages(query, 6).then((found) => {
      if (live) setSuggestions(found.map((s) => ({ page: String(s.page), title: s.title })));
    });
    return () => {
      live = false;
    };
  }, [kind, query, chosen]);

  const submit = () => {
    if (kind === 'page') {
      if (!chosen) return setError(t('ink.links.pickPage'));
      const trimmed = heading.trim();
      const target: LinkTarget = { kind: 'page', page: chosen.page, ...(trimmed ? { heading: trimmed } : {}) };
      return done({ target, label: initialLabel || chosen.title });
    }
    if (kind === 'url') {
      if (!isWebAddress(url)) return setError(t('ink.links.badAddress'));
      return done({ target: { kind: 'url', url: url.trim() }, label: initialLabel || url.trim() });
    }
    return done({ target: { kind: 'recording' }, label: initialLabel || t('ink.links.recordingLabel') });
  };

  return (
    <Dialog
      title={t('ink.links.make')}
      description={t('ink.links.makeHelp')}
      size="small"
      onDismiss={() => done(null)}
      actions={[
        { id: 'cancel', label: t('ink.ask.cancel'), variant: 'secondary', onPress: () => done(null) },
        { id: 'confirm', label: t('ink.links.makeConfirm'), variant: 'primary', onPress: submit },
      ]}
    >
      <RadioGroup<Kind>
        label={t('ink.links.goesTo')}
        value={kind}
        onChange={(next) => {
          setKind(next);
          setError(null);
        }}
      >
        <RadioCard<Kind> value="page" label={t('ink.links.kindPage')} />
        <RadioCard<Kind> value="url" label={t('ink.links.kindUrl')} />
        {canRecord && <RadioCard<Kind> value="recording" label={t('ink.links.kindRecording')} />}
      </RadioGroup>
      {kind === 'page' && (
        <>
          <TextField
            label={t('ink.links.pageSearch')}
            value={chosen ? chosen.title : query}
            onChange={(value) => {
              setChosen(null);
              setQuery(value);
              setError(null);
            }}
            error={error ?? undefined}
          />
          {!chosen && (
            <ul aria-label={t('ink.links.pageResults')}>
              {suggestions.map((s) => (
                <li key={s.page}>
                  <Button variant="quiet" onClick={() => setChosen(s)}>
                    {s.title}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <TextField
            label={t('ink.links.heading')}
            help={t('ink.links.headingHelp')}
            value={heading}
            onChange={setHeading}
          />
        </>
      )}
      {kind === 'url' && (
        <TextField
          label={t('ink.links.address')}
          value={url}
          onChange={(value) => {
            setUrl(value);
            setError(null);
          }}
          error={error ?? undefined}
          onCommit={submit}
        />
      )}
      {kind === 'recording' && <p>{t('ink.links.recordingHelp')}</p>}
    </Dialog>
  );
}

function mount<T>(render: (done: (answer: T) => void) => React.ReactElement): Promise<T> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    const done = (answer: T) => {
      resolve(answer);
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
    };
    root.render(render(done));
  });
}

/** Asks where the writing should link to. Null when the person cancels. */
export function askLinkTarget(host: InkHost, initialLabel: string): Promise<MadeLink | null> {
  return mount<MadeLink | null>((done) => (
    <MakeLinkDialog canRecord={!!host.audio} initialLabel={initialLabel} done={done} />
  ));
}

/** Opens a link: a page in the app, a web address in the browser, or the recording at the writing's moment. */
export async function openInkLink(host: InkHost, link: InkLink): Promise<void> {
  const context = commandContext('menu');
  if (link.target.kind === 'page') {
    await openPage(context.notes, link.target.page);
  } else if (link.target.kind === 'url') {
    if (isWebAddress(link.target.url)) {
      await context.platform.shell.openExternal({ kind: 'link', url: link.target.url });
    }
  } else {
    await host.audio?.playFrom(link.strokes);
  }
}

const kindText = (link: InkLink): string =>
  link.target.kind === 'page'
    ? link.target.heading
      ? t('ink.links.toHeading', { heading: link.target.heading })
      : t('ink.links.toPage')
    : link.target.kind === 'url'
      ? link.target.url
      : t('ink.links.toRecording');

function LinkList(props: { host: InkHost; surface: InkSurface; done: () => void }) {
  const { host, surface, done } = props;
  const [links, setLinks] = useState(() => liveLinks(inkLinks.get(), (id) => surface.strokes([id]).length > 0));
  useEffect(
    () => inkLinks.subscribe(() => setLinks(liveLinks(inkLinks.get(), (id) => surface.strokes([id]).length > 0))),
    [surface],
  );
  return (
    <Dialog
      title={t('ink.links.list')}
      size="small"
      onDismiss={done}
      actions={[{ id: 'close', label: t('ink.links.close'), variant: 'primary', onPress: done }]}
    >
      {links.length === 0 ? (
        <p>{t('ink.links.empty')}</p>
      ) : (
        <ul aria-label={t('ink.links.list')}>
          {links.map(([id, link]) => (
            <li key={id}>
              <span>
                {link.label || t('ink.links.unnamed')} <small>{kindText(link)}</small>
              </span>{' '}
              <Button
                variant="quiet"
                onClick={() => host.select({ blocks: [], strokes: [...link.strokes] }, { announce: true })}
              >
                {t('ink.links.select')}
              </Button>
              <Button variant="quiet" onClick={() => void openInkLink(host, link)}>
                {t('ink.links.open')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/** Lists every link on the shown page. */
export function showLinkList(host: InkHost, surface: InkSurface): Promise<void> {
  return mount<void>((done) => <LinkList host={host} surface={surface} done={() => done()} />);
}

/** Make link: asks where the selected writing should go, then links it. */
export async function makeLinkFromSelection(host: InkHost, surface: InkSurface): Promise<void> {
  const selection = host.selection.get();
  if (selection.strokes.length === 0) return say(t('ink.links.selectFirst'));
  const answer = await askLinkTarget(host, '');
  if (answer) await linkSelection(surface, selection, answer.target, answer.label);
}
