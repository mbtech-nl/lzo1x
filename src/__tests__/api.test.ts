import { describe, expect, it } from 'vitest';
import { lzo1xCompress } from '../compress.js';
import { lzo1xDecompress } from '../decompress.js';
import { lcgBytes } from './helpers.js';

describe('lzo1xDecompress error semantics', () => {
  it('throws RangeError on truncated input (shorter than EOS marker)', () => {
    expect(() => lzo1xDecompress(new Uint8Array([0x11, 0x00]))).toThrow(RangeError);
  });

  it('throws RangeError on a truncated literal run', () => {
    // 0x12 = leading-literal token with 1 literal, but no bytes follow.
    expect(() => lzo1xDecompress(new Uint8Array([0x12]))).toThrow(RangeError);
  });

  it('throws RangeError on a missing EOS marker mid-stream', () => {
    // Valid first frame literal but no terminator.
    expect(() => lzo1xDecompress(new Uint8Array([0x14, 0x41, 0x42, 0x43]))).toThrow();
  });

  it('throws RangeError on expectedOutputLength mismatch (too small)', () => {
    const c = lzo1xCompress(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(() => lzo1xDecompress(c, 4)).toThrow(RangeError);
  });

  it('throws RangeError on expectedOutputLength mismatch (too large)', () => {
    const c = lzo1xCompress(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(() => lzo1xDecompress(c, 999)).toThrow(RangeError);
  });

  it('throws on a bogus match referring before the buffer start', () => {
    // M2 token claiming distance 1 with zero output written yet.
    expect(() => lzo1xDecompress(new Uint8Array([0x40, 0x00, 0x11, 0x00, 0x00]))).toThrow();
  });
});

describe('lzo1xCompress size bound', () => {
  it('output ≤ input + ceil(input/16) + 67 (published worst case)', () => {
    for (const size of [0, 1, 9, 16, 100, 1024, 4096, 65535, 131072]) {
      const input = lcgBytes(size, size + 7);
      const c = lzo1xCompress(input);
      const worst = size + Math.ceil(size / 16) + 67;
      expect(c.length, `size=${String(size)}`).toBeLessThanOrEqual(worst);
    }
  });

  it('terminates with the M4 end-of-stream marker', () => {
    const input = lcgBytes(1000, 1);
    const c = lzo1xCompress(input);
    expect(c.at(-3)).toBe(0x11);
    expect(c.at(-2)).toBe(0x00);
    expect(c.at(-1)).toBe(0x00);
  });

  it('decompress accepts the dynamic-grow path on a large input', () => {
    const input = lcgBytes(50000, 5);
    const c = lzo1xCompress(input);
    const out = lzo1xDecompress(c);
    expect(out).toEqual(input);
  });
});
