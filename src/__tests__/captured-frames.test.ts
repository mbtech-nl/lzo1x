import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lzo1xDecompress } from '../decompress.js';

const CAPTURE_DIR = '/home/mannes/thermal-label/niimbot/research/b2-pro-2026-05-24-line';
const hasCaptures = existsSync(CAPTURE_DIR);

describe.skipIf(!hasCaptures)('captured Niimbot B2 Pro LZO frames decode correctly', () => {
  for (let i = 0; i < 11; i++) {
    const n = String(i).padStart(2, '0');
    it(`chunk_${n}`, () => {
      const bin = new Uint8Array(readFileSync(`${CAPTURE_DIR}/chunk_${n}.bin`));
      const dec = new Uint8Array(readFileSync(`${CAPTURE_DIR}/chunk_${n}.dec`));
      const out = lzo1xDecompress(bin, dec.length);
      expect(out).toEqual(dec);
    });
  }
});
