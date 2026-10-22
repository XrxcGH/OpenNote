// The keys of the video block: what each does to a video element. They are the usual player keys, so a person who
// knows any player knows these. They act while the video has focus; the page's own keys are not touched.

export type VideoKey =
  | { do: 'toggle' }
  | { do: 'seek'; by: number }
  | { do: 'volume'; by: number }
  | { do: 'mute' }
  | { do: 'captions' }
  | { do: 'fullscreen' };

/** What a key does, or null when the key isn't one of the player's. */
export function keyAction(key: string, shift: boolean): VideoKey | null {
  switch (key) {
    case ' ':
    case 'k':
      return { do: 'toggle' };
    case 'ArrowLeft':
      return { do: 'seek', by: shift ? -10 : -5 };
    case 'ArrowRight':
      return { do: 'seek', by: shift ? 10 : 5 };
    case 'ArrowUp':
      return { do: 'volume', by: 0.1 };
    case 'ArrowDown':
      return { do: 'volume', by: -0.1 };
    case 'm':
      return { do: 'mute' };
    case 'c':
      return { do: 'captions' };
    case 'f':
      return { do: 'fullscreen' };
    default:
      return null;
  }
}

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

/** Does the key's work on the video. Answers a short description for a screen reader, or '' for none. */
export function applyKey(video: HTMLVideoElement, action: VideoKey): string {
  switch (action.do) {
    case 'toggle':
      if (video.paused) void video.play().catch(() => undefined);
      else video.pause();
      return '';
    case 'seek': {
      const end = Number.isFinite(video.duration) ? video.duration : Number.MAX_SAFE_INTEGER;
      video.currentTime = clamp(video.currentTime + action.by, 0, end);
      return '';
    }
    case 'volume':
      video.muted = false;
      video.volume = clamp(Math.round((video.volume + action.by) * 10) / 10, 0, 1);
      return `${Math.round(video.volume * 100)}%`;
    case 'mute':
      video.muted = !video.muted;
      return '';
    case 'captions': {
      const track = video.textTracks[0];
      if (!track) return '';
      track.mode = track.mode === 'showing' ? 'hidden' : 'showing';
      return track.mode;
    }
    case 'fullscreen':
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      else void video.requestFullscreen?.().catch(() => undefined);
      return '';
  }
}
