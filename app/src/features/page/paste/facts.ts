// Clipboard facts bound to one paste (Phase 4 ARCHITECTURE.md section 15.2). The shell hashes CF_UNICODETEXT with
// CRLF as LF; the page hashes its `text/plain` the same way and uses the facts only when the hashes match, so the
// source address and Word's images provably belong to the paste being handled.
import type { ClipboardClient, ClipboardFacts } from '../../../platform/types';

/** The lowercase hex SHA-256 of text with CRLF and CR as LF. */
export async function textSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text.replace(/\r\n?/g, '\n'));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The facts when they describe this text, or null. */
export async function bindFacts(text: string | null, facts: ClipboardFacts | null): Promise<ClipboardFacts | null> {
  if (!facts || facts.textSha256 === null || text === null) return null;
  return (await textSha256(text)) === facts.textSha256.toLowerCase() ? facts : null;
}

/** Asks the shell for the facts of the clipboard now, and binds them to this paste's text. */
export async function factsFor(clipboard: ClipboardClient | null, text: string | null): Promise<ClipboardFacts | null> {
  if (!clipboard || text === null) return null;
  try {
    return await bindFacts(text, await clipboard.facts());
  } catch {
    return null;
  }
}
