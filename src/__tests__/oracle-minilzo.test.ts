import { describe, expect, it } from 'vitest';
import { lzo1xCompress } from '../compress.js';
import { lzo1xDecompress } from '../decompress.js';
import { lcgBytes, loadMiniLzo, repeatPattern } from './helpers.js';

const mini = await loadMiniLzo();

// Hard-fail if the miniLZO binding is missing in CI — the oracle is the conformity
// claim; silently skipping it in CI would defeat the purpose.
describe('miniLZO binding presence', () => {
  it.skipIf(!process.env.CI)('binding must load in CI', () => {
    expect(mini).not.toBeNull();
  });
});

function crossCheck(input: Uint8Array): void {
  const tsToMini = mini!.decompress(lzo1xCompress(input), input.length);
  const miniToTs = lzo1xDecompress(mini!.compress(input), input.length);
  expect(tsToMini).toEqual(input);
  expect(miniToTs).toEqual(input);
}

function alphabetBytes(n: number, seed: number, alphabet: string): Uint8Array {
  const alpha = new TextEncoder().encode(alphabet);
  const raw = lcgBytes(n, seed);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = alpha[raw[i]! % alpha.length]!;
  return out;
}

function sparseZeros(n: number, seed: number, runLen: number): Uint8Array {
  // Long zero runs separated by short bursts of pseudo-random bytes.
  const raw = lcgBytes(n, seed);
  const out = new Uint8Array(n);
  let i = 0;
  while (i < n) {
    const zeros = Math.min(runLen, n - i);
    i += zeros;
    const burstLen = Math.min(8 + (raw[i % n]! & 0x1f), n - i);
    for (let j = 0; j < burstLen; j++) out[i + j] = raw[(i + j) % n]!;
    i += burstLen;
  }
  return out;
}

function highEntropy(n: number, seed: number): Uint8Array {
  // Whitened LCG: two streams XOR'd to defeat the matcher (worst case for the encoder).
  const a = lcgBytes(n, seed);
  const b = lcgBytes(n, seed ^ 0xdeadbeef);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = a[i]! ^ b[i]!;
  return out;
}

const SIZE_BANDS = [7, 31, 127, 511, 2048, 8192, 32768, 65521, 131072];

describe.skipIf(!mini)('miniLZO oracle cross-validation', () => {
  it('binding loaded', () => {
    expect(mini).not.toBeNull();
  });

  // ---- Baseline per-size sanity (one assertion per size, easy to localise) ----
  for (const size of [1, 16, 256, 4096, 65535, 131072]) {
    it(`baseline random LCG, size = ${String(size)}`, () => {
      crossCheck(lcgBytes(size, size + 1));
    });
  }

  // ---- Bulk random sweep: many seeds × many size bands ----
  it('random LCG sweep: 9 size bands × 60 seeds = 540 payloads', () => {
    for (const size of SIZE_BANDS) {
      for (let seed = 1; seed <= 60; seed++) {
        crossCheck(lcgBytes(size, seed * 1009 + size));
      }
    }
  });

  // ---- High-entropy / near-incompressible ----
  it('high-entropy whitened LCG: 6 sizes × 30 seeds = 180 payloads', () => {
    for (const size of [127, 511, 2048, 8192, 32768, 131072]) {
      for (let seed = 1; seed <= 30; seed++) {
        crossCheck(highEntropy(size, seed * 17 + 3));
      }
    }
  });

  // ---- Highly compressible: single repeating byte ----
  it('single-byte runs: 256 bytes × 4 sizes = 1024 payloads', () => {
    for (const size of [16, 256, 4096, 65535]) {
      for (let b = 0; b < 256; b++) {
        const input = new Uint8Array(size).fill(b);
        crossCheck(input);
      }
    }
  });

  // ---- Short repeating patterns (RLE / short-match territory) ----
  it('short repeating patterns: 8 patterns × 5 sizes = 40 payloads', () => {
    const patterns = ['A', 'AB', 'ABC', 'ABCD', 'ABCDE', 'ABCDEFGH', '0123456789', 'the quick '];
    for (const pat of patterns) {
      for (const size of [16, 256, 4096, 16384, 65535]) {
        crossCheck(repeatPattern(pat, size));
      }
    }
  });

  // ---- Small-alphabet (text-like) ----
  it('small-alphabet text-like: 4 alphabets × 5 sizes × 8 seeds = 160 payloads', () => {
    const alphabets = ['ab', 'abcdef', 'abcdefghijklmnop', 'abcdefghijklmnopqrstuvwxyz '];
    for (const alpha of alphabets) {
      for (const size of [64, 512, 4096, 16384, 65535]) {
        for (let seed = 1; seed <= 8; seed++) {
          crossCheck(alphabetBytes(size, seed * 31 + alpha.length, alpha));
        }
      }
    }
  });

  // ---- Sparse-zeros: long zero runs with random bursts (matcher + literal-ladder) ----
  it('sparse zeros: 4 run-lengths × 4 sizes × 6 seeds = 96 payloads', () => {
    for (const runLen of [8, 64, 512, 4096]) {
      for (const size of [256, 4096, 16384, 65535]) {
        for (let seed = 1; seed <= 6; seed++) {
          crossCheck(sparseZeros(size, seed * 13 + runLen, runLen));
        }
      }
    }
  });

  // ---- Decoder-only paths: inputs hand-picked so miniLZO emits M1 tokens
  // (2-byte short-distance matches immediately after a >= 4-byte literal run).
  // Our own encoder never emits M1; this covers the decoder side. ----
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
