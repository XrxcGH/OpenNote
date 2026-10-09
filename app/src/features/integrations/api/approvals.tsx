// Shows the shell's questions one at a time, wherever the person is in the app. A question that arrived while the
// window was loading is fetched with `pending` at start. A question the shell stopped waiting for (it waits two
// minutes, then counts it as no) closes by itself.

import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { announce } from '../../../ui';
import { t } from '../../../strings/t';
import { ApprovalDialog } from './ApprovalDialog';
import { apiHost } from './host';
import type { ApiHost } from './host';
import type { ApiEvent, ApprovalRequest, Decision } from './types';

export interface Approvals {
  stop(): void;
  /** The questions on screen or waiting, first one shown. */
  queue(): readonly ApprovalRequest[];
}

export function startApprovals(host: ApiHost = apiHost()): Approvals {
  let queue: ApprovalRequest[] = [];
  let mount: { root: Root; element: HTMLElement; id: string } | null = null;

  const close = () => {
    if (!mount) return;
    const { root, element } = mount;
    mount = null;
    root.unmount();
    element.remove();
  };

  const show = () => {
    const next = queue[0];
    if (mount?.id === next?.id) return;
    close();
    if (!next) return;
    const element = document.body.appendChild(document.createElement('div'));
    const root = createRoot(element);
    mount = { root, element, id: next.id };
    announce(t('platformApi.ask.waiting'));
    root.render(<ApprovalDialog key={next.id} request={next} onDecide={(decision) => decide(next.id, decision)} />);
  };

  const decide = (id: string, decision: Decision) => {
    queue = queue.filter((request) => request.id !== id);
    queueMicrotask(show);
    void host.call('decide', { id, decision }).catch(() => {});
  };

  const add = (request: ApprovalRequest) => {
    if (queue.some((one) => one.id === request.id)) return;
    queue = [...queue, request];
    show();
  };

  const stopListening = host.listen((event: ApiEvent) => {
    if (event.kind === 'question') add(event.request);
    if (event.kind === 'answered') {
      queue = queue.filter((request) => request.id !== event.id);
      show();
    }
  });
  void host
    .call<ApprovalRequest[]>('pending')
    .then((pending) => (pending ?? []).forEach(add))
    .catch(() => {});

  return {
    stop() {
      stopListening();
      queue = [];
      close();
    },
    queue: () => queue,
  };
}
