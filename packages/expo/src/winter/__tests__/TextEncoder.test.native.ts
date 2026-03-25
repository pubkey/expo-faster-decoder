describe('TextEncoder', () => {
  it(`uses the Expo built-in APIs`, () => {
    expect((TextEncoder as any)[Symbol.for('expo.builtin')]).toBe(true);
  });

  it(`has expected attributes`, () => {
    expect('encoding' in new TextEncoder()).toBe(true);
    expect(new TextEncoder().encoding).toBe('utf-8');
  });

  it('encodes empty string', () => {
    const encoded = new TextEncoder().encode('');
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBe(0);
  });

  it('encodes empty when called with no arguments', () => {
    const encoded = new TextEncoder().encode();
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBe(0);
  });

  it('encodes ASCII string', () => {
    const encoder = new TextEncoder();
    const encoded = encoder.encode('Hello, world!');
    expect([...encoded]).toEqual([72, 101, 108, 108, 111, 44, 32, 119, 111, 114, 108, 100, 33]);
  });

  it('encodes full ASCII range', () => {
    const encoder = new TextEncoder();
    let string = '';
    const expected: number[] = [];
    for (let i = 0; i < 128; i++) {
      string += String.fromCharCode(i);
      expected.push(i);
    }
    const encoded = encoder.encode(string);
    expect([...encoded]).toEqual(expected);
  });

  it('encodes 2-byte UTF-8 characters', () => {
    const encoder = new TextEncoder();
    // ¢ = U+00A2 = 0xC2 0xA2
    const encoded = encoder.encode('\u00A2');
    expect([...encoded]).toEqual([0xc2, 0xa2]);
  });

  it('encodes 3-byte UTF-8 characters', () => {
    const encoder = new TextEncoder();
    // 水 = U+6C34 = 0xE6 0xB0 0xB4
    const encoded = encoder.encode('\u6C34');
    expect([...encoded]).toEqual([0xe6, 0xb0, 0xb4]);
  });

  it('encodes 4-byte UTF-8 characters (surrogate pairs)', () => {
    const encoder = new TextEncoder();
    // 𝄞 G-Clef = U+1D11E = 0xF0 0x9D 0x84 0x9E
    const encoded = encoder.encode('\uD834\uDD1E');
    expect([...encoded]).toEqual([0xf0, 0x9d, 0x84, 0x9e]);
  });

  it('encodes mixed ASCII and multi-byte', () => {
    const encoder = new TextEncoder();
    // z, ¢, 水, 𝄞, Private-use U+10FFFD
    const sample = 'z\xA2\u6C34\uD834\uDD1E\uDBFF\uDFFD';
    const expected = [
      0x7a, 0xc2, 0xa2, 0xe6, 0xb0, 0xb4, 0xf0, 0x9d, 0x84, 0x9e, 0xf4, 0x8f, 0xbf, 0xbd,
    ];
    expect([...encoder.encode(sample)]).toEqual(expected);
  });

  it('handles lone high surrogate as U+FFFD', () => {
    const encoder = new TextEncoder();
    const encoded = encoder.encode('\uD800');
    // U+FFFD = 0xEF 0xBF 0xBD
    expect([...encoded]).toEqual([0xef, 0xbf, 0xbd]);
  });

  it('handles lone low surrogate as U+FFFD', () => {
    const encoder = new TextEncoder();
    const encoded = encoder.encode('\uDC00');
    expect([...encoded]).toEqual([0xef, 0xbf, 0xbd]);
  });

  it('handles lone surrogates in context', () => {
    const encoder = new TextEncoder();

    // abc + lone high surrogate + def
    const encoded1 = encoder.encode('abc\uD800def');
    expect([...encoded1]).toEqual([
      0x61, 0x62, 0x63, 0xef, 0xbf, 0xbd, 0x64, 0x65, 0x66,
    ]);

    // abc + lone low surrogate + def
    const encoded2 = encoder.encode('abc\uDC00def');
    expect([...encoded2]).toEqual([
      0x61, 0x62, 0x63, 0xef, 0xbf, 0xbd, 0x64, 0x65, 0x66,
    ]);
  });

  it('handles reversed surrogates as two U+FFFD', () => {
    const encoder = new TextEncoder();
    const encoded = encoder.encode('\uDC00\uD800');
    expect([...encoded]).toEqual([0xef, 0xbf, 0xbd, 0xef, 0xbf, 0xbd]);
  });

  it('encodes falsy arguments as strings (polyfill bindings)', () => {
    const encoder = new TextEncoder();
    // @ts-expect-error - testing non-string input
    expect([...encoder.encode(false)]).toEqual([102, 97, 108, 115, 101]);
    // @ts-expect-error - testing non-string input
    expect([...encoder.encode(0)]).toEqual([48]);
  });

  it('ignores encoding argument per spec (always UTF-8)', () => {
    // @ts-expect-error - testing non-standard argument
    const encoder = new TextEncoder('iso-8859-1');
    expect(encoder.encoding).toBe('utf-8');
  });

  describe('encodeInto', () => {
    it('encodes ASCII string into destination', () => {
      const encoder = new TextEncoder();
      const dest = new Uint8Array(20);
      const result = encoder.encodeInto('Hello', dest);
      expect(result.read).toBe(5);
      expect(result.written).toBe(5);
      expect([...dest.subarray(0, 5)]).toEqual([72, 101, 108, 108, 111]);
    });

    it('encodes multi-byte characters', () => {
      const encoder = new TextEncoder();
      const dest = new Uint8Array(20);
      const result = encoder.encodeInto('\u00A2\u6C34', dest);
      expect(result.read).toBe(2);
      expect(result.written).toBe(5);
      expect([...dest.subarray(0, 5)]).toEqual([0xc2, 0xa2, 0xe6, 0xb0, 0xb4]);
    });

    it('stops when destination is too small', () => {
      const encoder = new TextEncoder();
      const dest = new Uint8Array(3);
      // 'Hello' needs 5 bytes but we only have 3
      const result = encoder.encodeInto('Hello', dest);
      expect(result.read).toBe(3);
      expect(result.written).toBe(3);
      expect([...dest]).toEqual([72, 101, 108]);
    });

    it('handles empty input', () => {
      const encoder = new TextEncoder();
      const dest = new Uint8Array(10);
      const result = encoder.encodeInto('', dest);
      expect(result.read).toBe(0);
      expect(result.written).toBe(0);
    });

    it('encodes surrogate pairs into destination', () => {
      const encoder = new TextEncoder();
      const dest = new Uint8Array(10);
      // 𝄞 G-Clef = U+1D11E
      const result = encoder.encodeInto('\uD834\uDD1E', dest);
      expect(result.read).toBe(2);
      expect(result.written).toBe(4);
      expect([...dest.subarray(0, 4)]).toEqual([0xf0, 0x9d, 0x84, 0x9e]);
    });
  });

  it('roundtrip with TextDecoder for full Unicode range', () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder('UTF-8');

    function genblock(from: number, len: number, skip: number) {
      let block = '';
      for (let i = 0; i < len; i += skip) {
        let cp = from + i;
        if (0xd800 <= cp && cp <= 0xdfff) continue;
        if (cp < 0x10000) {
          block += String.fromCharCode(cp);
          continue;
        }
        cp = cp - 0x10000;
        block += String.fromCharCode(0xd800 + (cp >> 10));
        block += String.fromCharCode(0xdc00 + (cp & 0x3ff));
      }
      return block;
    }

    const MIN_CODEPOINT = 0;
    const MAX_CODEPOINT = 0x10ffff;
    const BLOCK_SIZE = 0x1000;
    const SKIP_SIZE = 31;

    for (let i = MIN_CODEPOINT; i < MAX_CODEPOINT; i += BLOCK_SIZE) {
      const block = genblock(i, BLOCK_SIZE, SKIP_SIZE);
      const encoded = encoder.encode(block);
      const decoded = decoder.decode(encoded);
      expect(decoded).toBe(block);
    }
  });

  it('roundtrip with TextDecoder agrees with encodeURIComponent reference', () => {
    function encodeUtf8Ref(string: string): Uint8Array {
      const utf8 = unescape(encodeURIComponent(string));
      const octets = new Uint8Array(utf8.length);
      for (let i = 0; i < utf8.length; i += 1) {
        octets[i] = utf8.charCodeAt(i);
      }
      return octets;
    }

    const encoder = new TextEncoder();
    // z, cent, CJK water, G-Clef, Private-use character
    const sample = 'z\xA2\u6C34\uD834\uDD1E\uDBFF\uDFFD';
    const encoded = encoder.encode(sample);
    const reference = encodeUtf8Ref(sample);

    expect(encoded.length).toBe(reference.length);
    expect([...encoded]).toEqual([...reference]);
  });
});
