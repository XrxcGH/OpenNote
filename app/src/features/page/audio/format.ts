// Times for the recording screens (Phase 9).

/** Such as 3:05 or 1:02:03, from nanoseconds or milliseconds. */
export function clock(totalMs: number): string {
  const seconds = Math.max(0, Math.floor(totalMs / 1000));
  const [h, m, s] = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60];
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

export const clockNs = (ns: number) => clock(ns / 1e6);

/** Such as 640 KB or 12.3 MB. */
export function bytesText(bytes: number): string {
  if (bytes < 1000 * 1000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  if (bytes < 1000 * 1000 * 1000) return `${(bytes / 1e6).toFixed(bytes < 1e8 ? 1 : 0)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}
