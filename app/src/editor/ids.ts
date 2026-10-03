// IDs for text elements, table rows, and table columns (SPEC 2.4): 26 lowercase Crockford base32 characters, made of
// a 48-bit time in milliseconds and 80 random bits, so that they sort by creation time.
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;

type Bytes = Uint8Array<ArrayBuffer>;

/** A new ID. `now` and `random` are parameters so that tests can fix them. */
export function newId(now: number = Date.now(), random: (bytes: Bytes) => Bytes = fillRandom): string {
  let time = now;
  let text = '';
  for (let i = 0; i < TIME_CHARS; i++) {
    text = ALPHABET[time % 32] + text;
    time = Math.floor(time / 32);
  }
  const bytes = random(new Uint8Array(RANDOM_CHARS));
  for (const byte of bytes) text += ALPHABET[byte % 32];
  return text;
}

function fillRandom(bytes: Bytes): Bytes {
  return crypto.getRandomValues(bytes);
}

const ID_PATTERN = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/;

/** Whether text is an ID in SPEC 2.4's text form. */
export function isId(text: string): boolean {
  return ID_PATTERN.test(text);
}
