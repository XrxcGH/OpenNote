// Windows language IDs, as `[$-407]` tags write them, and BCP 47 tags. The IDs are the published values of the
// Windows language code identifier list (MS-LCID). Only the language part (the low 16 bits) names a locale.

const IDS: Readonly<Record<number, string>> = {
  0x0401: 'ar-SA',
  0x0404: 'zh-TW',
  0x0405: 'cs-CZ',
  0x0406: 'da-DK',
  0x0407: 'de-DE',
  0x0408: 'el-GR',
  0x0409: 'en-US',
  0x040a: 'es-ES',
  0x040b: 'fi-FI',
  0x040c: 'fr-FR',
  0x040d: 'he-IL',
  0x040e: 'hu-HU',
  0x0410: 'it-IT',
  0x0411: 'ja-JP',
  0x0412: 'ko-KR',
  0x0413: 'nl-NL',
  0x0414: 'nb-NO',
  0x0415: 'pl-PL',
  0x0416: 'pt-BR',
  0x0418: 'ro-RO',
  0x0419: 'ru-RU',
  0x041a: 'hr-HR',
  0x041b: 'sk-SK',
  0x041d: 'sv-SE',
  0x041e: 'th-TH',
  0x041f: 'tr-TR',
  0x0421: 'id-ID',
  0x0422: 'uk-UA',
  0x0424: 'sl-SI',
  0x042a: 'vi-VN',
  0x0439: 'hi-IN',
  0x043e: 'ms-MY',
  0x0804: 'zh-CN',
  0x0807: 'de-CH',
  0x0809: 'en-GB',
  0x080a: 'es-MX',
  0x080c: 'fr-BE',
  0x0813: 'nl-BE',
  0x0816: 'pt-PT',
  0x0c04: 'zh-HK',
  0x0c07: 'de-AT',
  0x0c09: 'en-AU',
  0x0c0a: 'es-ES',
  0x0c0c: 'fr-CA',
  0x1009: 'en-CA',
  0x100c: 'fr-CH',
  0x1409: 'en-NZ',
  0x1809: 'en-IE',
  0x4009: 'en-IN',
};

const TAGS = new Map<string, number>();
for (const [id, tag] of Object.entries(IDS)) if (!TAGS.has(tag.toLowerCase())) TAGS.set(tag.toLowerCase(), Number(id));

/** The BCP 47 tag of a language ID, or null when the list does not have it. */
export function tagOfLcid(id: number): string | null {
  return IDS[id & 0xffff] ?? null;
}

/** The language ID of a BCP 47 tag, or null. */
export function lcidOfTag(tag: string): number | null {
  return TAGS.get(tag.toLowerCase()) ?? null;
}

/** The hexadecimal form a tag writes, such as "409", or null when the tag has no ID. */
export function lcidHex(tag: string): string | null {
  const id = lcidOfTag(tag);
  return id === null ? null : id.toString(16).toUpperCase();
}
