// The few names the start-up registrations need from the transcripts, kept apart from the rest of the model so
// that start-up loads only these. A link to a moment of a recording looks like `opennote:moment/<recording>#<ms>`.

export const TRANSCRIPT_TYPE = 'ext:org.opennote/transcript' as const;

/** The moment a link points at: the recording, and a position in its audio. */
export const momentHref = (recording: string, ms: number): string => `opennote:moment/${recording}#${Math.round(ms)}`;

export function parseMomentHref(href: string): { recording: string; ms: number } | null {
  const found = /^opennote:moment\/([A-Za-z0-9_-]+)#(\d+)$/.exec(href);
  return found ? { recording: found[1], ms: Number(found[2]) } : null;
}
