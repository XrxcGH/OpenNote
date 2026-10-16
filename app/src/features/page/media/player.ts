// Talking to a player in its frame. YouTube and Vimeo tell the page where the playhead is when asked over postMessage,
// and take a seek the same way. Messages go to the player's own origin only, and only messages from the frame's own
// window and origin are believed. Nothing here can change what the frame shows beyond the playhead.

export interface PlayerState {
  ms: number;
  playing: boolean;
}

export interface PlayerControl {
  seek(ms: number): void;
  dispose(): void;
}

type Listener = (state: PlayerState) => void;

/** How often the page asks a YouTube frame to start telling it things, until it does. */
const LISTEN_EVERY_MS = 500;

function parse(data: unknown): Record<string, unknown> | null {
  if (typeof data === 'string') {
    try {
      const value: unknown = JSON.parse(data);
      return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
}

/** Follows a player frame. `provider` says which messages to speak; others have no playhead and return null. */
export function controlPlayer(
  frame: HTMLIFrameElement,
  provider: 'youtube' | 'vimeo',
  origin: string,
  listener: Listener,
  win: Window = window,
): PlayerControl {
  let state: PlayerState = { ms: 0, playing: false };
  let heard = false;
  const send = (message: unknown) => {
    try {
      frame.contentWindow?.postMessage(JSON.stringify(message), origin);
    } catch {
      // The frame is gone or not ready; the next try covers it.
    }
  };
  const emit = (next: Partial<PlayerState>) => {
    state = { ...state, ...next };
    listener(state);
  };

  const onMessage = (event: MessageEvent) => {
    if (event.origin !== origin || event.source !== frame.contentWindow) return;
    const message = parse(event.data);
    if (!message) return;
    heard = true;
    if (provider === 'youtube') {
      const info = message.info as { currentTime?: unknown; playerState?: unknown } | undefined;
      if (message.event === 'infoDelivery' && info) {
        if (typeof info.currentTime === 'number') emit({ ms: Math.round(info.currentTime * 1000) });
        if (typeof info.playerState === 'number') emit({ playing: info.playerState === 1 });
      }
    } else {
      const data = message.data as { seconds?: unknown } | undefined;
      if (message.event === 'timeupdate' && typeof data?.seconds === 'number') {
        emit({ ms: Math.round(data.seconds * 1000), playing: true });
      } else if (message.event === 'play') emit({ playing: true });
      else if (message.event === 'pause' || message.event === 'ended') emit({ playing: false });
      else if (message.event === 'playProgress' && typeof data?.seconds === 'number')
        emit({ ms: Math.round(data.seconds * 1000) });
    }
  };
  win.addEventListener('message', onMessage);

  const subscribe = () => {
    if (provider === 'youtube') send({ event: 'listening', id: 'opennote', channel: 'widget' });
    else for (const name of ['timeupdate', 'play', 'pause', 'ended']) send({ method: 'addEventListener', value: name });
  };
  frame.addEventListener('load', subscribe);
  subscribe();
  // YouTube answers only after it is ready, so the page asks again until it hears.
  const timer = win.setInterval(() => {
    if (heard) return win.clearInterval(timer);
    subscribe();
  }, LISTEN_EVERY_MS);

  return {
    seek(ms) {
      const seconds = Math.max(0, ms / 1000);
      if (provider === 'youtube') {
        send({ event: 'command', func: 'seekTo', args: [seconds, true], id: 'opennote', channel: 'widget' });
        send({ event: 'command', func: 'playVideo', args: [], id: 'opennote', channel: 'widget' });
      } else {
        send({ method: 'setCurrentTime', value: seconds });
        send({ method: 'play' });
      }
      emit({ ms: Math.round(ms) });
    },
    dispose() {
      win.removeEventListener('message', onMessage);
      frame.removeEventListener('load', subscribe);
      win.clearInterval(timer);
      listener({ ms: state.ms, playing: false });
    },
  };
}
