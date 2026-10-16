// Plain text from the parts of an invitation: HTML turned into lines, and the boilerplate that Teams, Meet, and Zoom
// add after the real agenda taken off.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Text from HTML: line breaks and paragraphs become new lines, tags go, and the common entities are decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
      if (name.startsWith('#x')) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
      if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)));
      return ENTITIES[name.toLowerCase()] ?? whole;
    });
}

/** The lines where a conferencing service begins its own text. Everything after the first of them is dropped. */
const BOILERPLATE = [/^_{8,}\s*$/, /^-{8,}\s*$/, /^Microsoft Teams (meeting|Need help)/i, /^Join (Zoom|Google Meet)/i];

/** The agenda in an invitation: plain text, trimmed, with the conferencing boilerplate cut and long text shortened. */
export function agendaText(body: string, isHtml: boolean, limit = 2000): string {
  const lines = (isHtml ? htmlToText(body) : body).replace(/\r\n?/g, '\n').split('\n');
  const cut = lines.findIndex((line) => BOILERPLATE.some((pattern) => pattern.test(line.trim())));
  const kept = (cut < 0 ? lines : lines.slice(0, cut)).map((line) => line.replace(/[ \t]+$/g, ''));
  const text = kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}
