import { describe, expect, it } from 'vitest';
import { lzo1xCompress } from '../compress.js';
import { lzo1xDecompress } from '../decompress.js';
import { lcgBytes } from './helpers.js';

const SIZES = [1, 16, 256, 4096, 65535, 131072];

describe('self round-trip on deterministic-RNG inputs', () => {
  for (const size of SIZES) {
    it(`size = ${String(size)}`, () => {
      const input = lcgBytes(size, size + 1);
      const compressed = lzo1xCompress(input);
      const out = lzo1xDecompress(compressed, input.length);
      expect(out).toEqual(input);
    });
  }

  it('dynamic-grow path (no expectedOutputLength) yields identical bytes', () => {
    const input = lcgBytes(4096, 17);
    const c = lzo1xCompress(input);
    const out = lzo1xDecompress(c);
    expect(out).toEqual(input);
  });
});
