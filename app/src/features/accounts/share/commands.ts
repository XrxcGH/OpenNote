// Share page to Slack and Share page to Teams: choose the channel, choose what to post (a PDF, a picture, or a link), and
// post it as the person. Nothing is posted until the last button, and the page itself is never changed.

import { commandContext } from '../../../commands/registry';
import type { NodeId } from '../../../services/notes/types';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { shownMounted } from '../../page';
import { renderShownPage } from '../../pages';
import { formatLink } from '../../search';
import { accountsHost } from '../host';
import { attempt, isConnected, tellNotConnected } from '../run';
import { pickOne } from '../ui/prompts';
import type { Choice } from '../ui/prompts';
import { shareToSlack, listSlackChannels } from './slack';
import { listTeamChannels, listTeams, shareToTeams } from './teams';
import type { Channel, ShareKind, Shared } from './types';

const linkText = (title: string, link: string): string => t('accounts.share.message.link', { title, link });

function chooseChannel(channels: readonly Channel[], title: string, service: string): Promise<Channel | null> {
  const choices: Choice<Channel>[] = channels.map((channel) => ({
    id: channel.id,
    label: channel.name,
    value: channel,
  }));
  return pickOne({
    title,
    description: t('accounts.share.channel.description'),
    choices,
    confirmLabel: t('accounts.share.channel.confirm'),
    empty: t('accounts.share.channel.none', { service }),
  });
}

function chooseKind(): Promise<ShareKind | null> {
  return pickOne<ShareKind>({
    title: t('accounts.share.kind.title'),
    description: t('accounts.share.kind.description'),
    confirmLabel: t('accounts.share.kind.confirm'),
    choices: [
      { id: 'pdf', label: t('accounts.share.kind.pdf'), detail: t('accounts.share.kind.pdfDetail'), value: 'pdf' },
      { id: 'png', label: t('accounts.share.kind.png'), detail: t('accounts.share.kind.pngDetail'), value: 'png' },
      { id: 'link', label: t('accounts.share.kind.link'), detail: t('accounts.share.kind.linkDetail'), value: 'link' },
    ],
  });
}

/** The shown page as what is posted, or null when there is nothing to post. */
async function prepare(kind: ShareKind): Promise<Shared | null> {
  const mounted = shownMounted.get();
  if (!mounted) {
    showToast({ message: t('accounts.share.nothing') });
    return null;
  }
  const context = commandContext('palette');
  if (kind === 'link') {
    const title = (await context.notes.get(mounted.page.id as NodeId))?.title ?? '';
    return { kind: 'link', title: title || t('pageViews.print.untitled'), link: formatLink(mounted.page.id) };
  }
  const rendered = await renderShownPage(context, kind, true);
  if (!rendered) {
    showToast({ message: t('accounts.share.failedRender'), tone: 'danger' });
    return null;
  }
  return { kind: 'file', title: rendered.title, name: rendered.name, mime: rendered.mime, bytes: rendered.bytes };
}

async function finish(channel: Channel, shared: Shared, post: () => Promise<void>): Promise<void> {
  const label = `#${channel.name}`;
  announce(t('accounts.share.working', { channel: label }));
  await post();
  const message = t('accounts.share.done', { title: shared.title, channel: label });
  showToast({ message });
  announce(message);
}

export async function shareSlack(): Promise<void> {
  if (!shownMounted.get()) return void showToast({ message: t('accounts.share.nothing') });
  if (!(await isConnected('slack'))) return tellNotConnected('Slack');
  const client = commandContext('palette').platform.connectors;
  await attempt('Slack', async () => {
    const channel = await chooseChannel(await listSlackChannels(client), t('accounts.share.channel.title'), 'Slack');
    if (!channel) return;
    const kind = await chooseKind();
    if (!kind) return;
    const shared = await prepare(kind);
    if (!shared) return;
    await finish(channel, shared, () => shareToSlack(client, accountsHost(), channel, shared, linkText));
  });
}

export async function shareTeams(): Promise<void> {
  if (!shownMounted.get()) return void showToast({ message: t('accounts.share.nothing') });
  if (!(await isConnected('microsoft'))) return tellNotConnected('Microsoft');
  const client = commandContext('palette').platform.connectors;
  await attempt('Teams', async () => {
    const teams = await listTeams(client);
    const team = await pickOne({
      title: t('accounts.share.channel.teamsTitle'),
      description: t('accounts.share.channel.description'),
      choices: teams.map((one) => ({ id: one.id, label: one.name, value: one })),
      confirmLabel: t('accounts.share.channel.confirm'),
      empty: t('accounts.share.channel.none', { service: 'Teams' }),
    });
    if (!team) return;
    const channel = await chooseChannel(
      await listTeamChannels(client, team),
      t('accounts.share.channel.teamsChannelTitle', { team: team.name }),
      'Teams',
    );
    if (!channel) return;
    const kind = await chooseKind();
    if (!kind) return;
    const shared = await prepare(kind);
    if (!shared) return;
    await finish(channel, shared, () => shareToTeams(client, accountsHost(), channel, shared, linkText));
  });
}
