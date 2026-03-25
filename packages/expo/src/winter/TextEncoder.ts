// An optimized JS TextEncoder implementation for UTF-8 encoding.
// Mirrors the optimization approach used in TextDecoder.ts:
// 1. ASCII fast path - bypasses the byte-by-byte encoder for pure-ASCII input
// 2. Pre-allocated buffer with index-based writing - avoids intermediate arrays
//
// https://encoding.spec.whatwg.org/#interface-textencoder

/**
 * @see https://encoding.spec.whatwg.org/#interface-textencoder
 */
export class TextEncoder {
  readonly encoding = 'utf-8';

  /**
   * Encodes a string into UTF-8 bytes.
   * @param input The string to encode. Defaults to empty string.
   * @returns A Uint8Array containing the UTF-8 encoded bytes.
   */
  encode(input: string = ''): Uint8Array {
    const str = String(input);
    const len = str.length;

    if (len === 0) return new Uint8Array(0);

    // Fast path: pure ASCII input.
    // ASCII characters are all < 0x80 and map 1:1 to UTF-8 bytes,
    // so we can skip the full encoder and write directly.
    let allAscii = true;
    for (let i = 0; i < len; i++) {
      if (str.charCodeAt(i) >= 0x80) {
        allAscii = false;
        break;
      }
    }

    if (allAscii) {
      const result = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        result[i] = str.charCodeAt(i);
      }
      return result;
    }

    // Full UTF-8 encoding with pre-allocated buffer.
    // Worst case: 3 bytes per BMP character. Surrogate pairs use 2
    // string positions for 4 bytes (2 bytes/position), so len*3 is safe.
    const buf = new Uint8Array(len * 3);
    let pos = 0;

    for (let i = 0; i < len; i++) {
      let cp = str.charCodeAt(i);

      if (cp < 0x80) {
        // 1-byte: 0xxxxxxx
        buf[pos++] = cp;
      } else if (cp < 0x800) {
        // 2-byte: 110xxxxx 10xxxxxx
        buf[pos++] = 0xc0 | (cp >> 6);
        buf[pos++] = 0x80 | (cp & 0x3f);
      } else if (cp >= 0xd800 && cp < 0xdc00) {
        // High surrogate - look for low surrogate pair
        const next = i + 1 < len ? str.charCodeAt(i + 1) : 0;
        if (next >= 0xdc00 && next <= 0xdfff) {
          // Valid surrogate pair → 4-byte sequence
          cp = ((cp - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
          i++;
          buf[pos++] = 0xf0 | (cp >> 18);
          buf[pos++] = 0x80 | ((cp >> 12) & 0x3f);
          buf[pos++] = 0x80 | ((cp >> 6) & 0x3f);
          buf[pos++] = 0x80 | (cp & 0x3f);
        } else {
          // Lone high surrogate → U+FFFD replacement character
          buf[pos++] = 0xef;
          buf[pos++] = 0xbf;
          buf[pos++] = 0xbd;
        }
      } else if (cp >= 0xdc00 && cp <= 0xdfff) {
        // Lone low surrogate → U+FFFD replacement character
        buf[pos++] = 0xef;
        buf[pos++] = 0xbf;
        buf[pos++] = 0xbd;
      } else {
        // 3-byte: 1110xxxx 10xxxxxx 10xxxxxx
        buf[pos++] = 0xe0 | (cp >> 12);
        buf[pos++] = 0x80 | ((cp >> 6) & 0x3f);
        buf[pos++] = 0x80 | (cp & 0x3f);
      }
    }

    return buf.slice(0, pos);
  }

  /**
   * Encodes a string into UTF-8 bytes, writing into a provided buffer.
   * @param source The string to encode.
   * @param destination The Uint8Array to write into.
   * @returns An object with `read` (characters consumed) and `written` (bytes written).
   */
  encodeInto(
    source: string,
    destination: Uint8Array
  ): { read: number; written: number } {
    const str = String(source);
    const len = str.length;
    const destLen = destination.length;
    let read = 0;
    let written = 0;

    for (let i = 0; i < len; i++) {
      let cp = str.charCodeAt(i);

      if (cp < 0x80) {
        if (written >= destLen) break;
        destination[written++] = cp;
        read = i + 1;
      } else if (cp < 0x800) {
        if (written + 2 > destLen) break;
        destination[written++] = 0xc0 | (cp >> 6);
        destination[written++] = 0x80 | (cp & 0x3f);
        read = i + 1;
      } else if (cp >= 0xd800 && cp < 0xdc00) {
        const next = i + 1 < len ? str.charCodeAt(i + 1) : 0;
        if (next >= 0xdc00 && next <= 0xdfff) {
          cp = ((cp - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
          if (written + 4 > destLen) break;
          destination[written++] = 0xf0 | (cp >> 18);
          destination[written++] = 0x80 | ((cp >> 12) & 0x3f);
          destination[written++] = 0x80 | ((cp >> 6) & 0x3f);
          destination[written++] = 0x80 | (cp & 0x3f);
          i++;
          read = i + 1;
        } else {
          if (written + 3 > destLen) break;
          destination[written++] = 0xef;
          destination[written++] = 0xbf;
          destination[written++] = 0xbd;
          read = i + 1;
        }
      } else if (cp >= 0xdc00 && cp <= 0xdfff) {
        if (written + 3 > destLen) break;
        destination[written++] = 0xef;
        destination[written++] = 0xbf;
        destination[written++] = 0xbd;
        read = i + 1;
      } else {
        if (written + 3 > destLen) break;
        destination[written++] = 0xe0 | (cp >> 12);
        destination[written++] = 0x80 | ((cp >> 6) & 0x3f);
        destination[written++] = 0x80 | (cp & 0x3f);
        read = i + 1;
      }
    }

    return { read, written };
  }
}
