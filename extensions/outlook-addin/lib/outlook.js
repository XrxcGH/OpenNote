// An Outlook message, as Office.js reports it, in the shape extensions/clipper/shared/mail.js turns into a page.
// Kept apart from Office.js so the tests can run it.

/** Hosts whose messages open in Outlook on the web for work or school; any other opens in Outlook.com. */
const WORK_HOSTS = /(^|\.)outlook\.office(365)?\.com$/i;

/** A link that opens the message in Outlook on the web, from the mailbox's REST address and the message's REST ID. */
export function outlookLink(restUrl, restId) {
  if (!restId) return null;
  let host;
  try {
    host = new URL(restUrl).hostname;
  } catch {
    host = '';
  }
  const base = WORK_HOSTS.test(host) ? 'https://outlook.office.com' : 'https://outlook.live.com';
  return `${base}/mail/deeplink/read/${encodeURIComponent(restId)}`;
}

function address(value) {
  if (!value) return { name: '', email: '' };
  return { name: value.displayName ?? '', email: value.emailAddress ?? '' };
}

/**
 * `item` is `{ subject, from, to, dateTimeCreated, markdown, link, attachments }`, where each attachment is Office's
 * `{ name, contentType, size, isInline, attachmentType }` plus `content`, the result of getAttachmentContentAsync
 * (`{ format, content }`) or null when it couldn't be read. Only files with base64 content come along: cloud
 * attachments and attached items are named on the page instead.
 */
export function itemToMessage(item) {
  return {
    subject: item.subject ?? '',
    from: address(item.from),
    to: (item.to ?? []).map(address),
    date: item.dateTimeCreated ?? null,
    markdown: item.markdown ?? '',
    link: item.link ?? null,
    attachments: (item.attachments ?? []).map((each) => {
      const isFile = each.attachmentType === 'file' && each.content?.format === 'base64';
      return {
        name: each.name,
        mime: each.contentType,
        size: each.size,
        inline: Boolean(each.isInline),
        data: isFile ? each.content.content : null,
      };
    }),
  };
}
