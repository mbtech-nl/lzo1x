import { describe, expect, it } from 'vitest';
import { lzo1xCompress } from '../compress.js';
import { lzo1xDecompress } from '../decompress.js';
import { lcgBytes, loadMiniLzo } from './helpers.js';

const mini = await loadMiniLzo();
const SIZES = [1, 16, 256, 4096, 65535, 131072];

describe.skipIf(!mini)('miniLZO oracle cross-validation', () => {
  it('binding loaded', () => {
    expect(mini).not.toBeNull();
  });

  for (const size of SIZES) {
    it(`TS-compress → minilzo-decompress (size = ${String(size)})`, () => {
      const input = lcgBytes(size, size + 1);
      const c = lzo1xCompress(input);
      const d = mini!.decompress(c, input.length);
      expect(d).toEqual(input);
    });

    it(`minilzo-compress → TS-decompress (size = ${String(size)})`, () => {
      const input = lcgBytes(size, size + 2);
      const c = mini!.compress(input);
      const d = lzo1xDecompress(c, input.length);
      expect(d).toEqual(input);
    });

    it(`full cross matrix yields identical bytes (size = ${String(size)})`, () => {
      const input = lcgBytes(size, size + 3);
      const tsToMini = mini!.decompress(lzo1xCompress(input), input.length);
      const miniToTs = lzo1xDecompress(mini!.compress(input), input.length);
      expect(tsToMini).toEqual(input);
      expect(miniToTs).toEqual(input);
    });
  }

  // Inputs hand-picked to make miniLZO emit M1 tokens (2-byte short-distance matches
  // immediately following a >= 4-byte literal run). Exercises our decoder's M1 paths,
  // which our own encoder never emits.
  it('decodes miniLZO-emitted M1 short matches', () => {
    const inputs = [
      'abcabcabXYZabcabcdefabcdef',
      `${'AB'.repeat(20)}CCC${'AB'.repeat(20)}`,
      `xyzxyzxy${'A'.repeat(10)}xyzxyzxy`,
    ];
    for (const s of inputs) {
      const input = new TextEncoder().encode(s);
      const c = mini!.compress(input);
      const out = lzo1xDecompress(c, input.length);
      expect(out).toEqual(input);
    }
  });
});
