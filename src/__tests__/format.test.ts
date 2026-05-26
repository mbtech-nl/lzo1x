import { describe, expect, it } from 'vitest';
import { lzo1xCompress } from '../compress.js';
import { lzo1xDecompress } from '../decompress.js';
import { repeatPattern } from './helpers.js';

const rt = (input: Uint8Array): void => {
  const c = lzo1xCompress(input);
  const d = lzo1xDecompress(c, input.length);
  expect(d).toEqual(input);
};

describe('format paths', () => {
  it('round-trips an empty input', () => {
    rt(new Uint8Array(0));
  });

  it('round-trips a single byte', () => {
    rt(new Uint8Array([0x42]));
  });

  it('round-trips an exactly-9-byte input (literal-only minimum)', () => {
    rt(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
  });

  it('round-trips an all-zero buffer (long M3 match self-overlap)', () => {
    rt(new Uint8Array(4096));
  });

  it('round-trips an all-0xFF buffer', () => {
    rt(new Uint8Array(4096).fill(0xff));
  });

  it('round-trips high-redundancy ASCII (M2/M3 emit paths)', () => {
    rt(repeatPattern('ABCDEFGH', 1000));
  });

  it('round-trips a long single-pattern (forces M3/M4 with long match length)', () => {
    rt(repeatPattern('The quick brown fox jumps over the lazy dog. ', 2000));
  });

  it('round-trips inputs at the M2 length boundary (8 bytes per match)', () => {
    rt(repeatPattern('ABCDEFGH', 50));
  });

  it('round-trips inputs at the M3 length boundary (33 bytes per match)', () => {
    rt(repeatPattern('A'.repeat(33), 30));
  });

  it('round-trips a single-byte repeat (33 bytes → M3 max, then ladder)', () => {
    rt(new Uint8Array(500).fill(0xab));
  });

  it('round-trips a 64KB input', () => {
    const buf = repeatPattern('XYZ123', 65536);
    rt(buf.subarray(0, 65535));
  });

  it('round-trips an input that requires the literal-run length ladder', () => {
    // Literal run > 18 bytes triggers the zero-byte ladder path on the encoder.
    // Mix of incompressible head + tail keeps the matcher silent for that span.
    const head = new Uint8Array(50);
    for (let i = 0; i < head.length; i++) head[i] = (i * 31 + 7) & 0xff;
    rt(head);
  });

  it('emits the M4 end-of-stream marker (0x11 0x00 0x00)', () => {
    const c = lzo1xCompress(new Uint8Array(0));
    expect(c).toEqual(new Uint8Array([0x11, 0x00, 0x00]));
  });

  it('rejects input shorter than the EOS marker', () => {
    expect(() => lzo1xDecompress(new Uint8Array([0x11, 0x00]))).toThrow(RangeError);
  });

  it('rejects a stream missing the EOS marker', () => {
    // A bare literal-run header with no terminator.
    expect(() => lzo1xDecompress(new Uint8Array([0x12, 0x00, 0x00, 0x00]))).toThrow();
  });

  it('round-trips a match long enough to exercise the M3 length ladder (> 33 bytes)', () => {
    // Single repeated byte for 400 bytes → one M3 match of ~400 bytes, beyond the M3MaxLen=33,
    // forcing the zero-byte ladder branch in the encoder.
    rt(new Uint8Array(400).fill(0x55));
  });

  it('round-trips a very long single-byte run (> 288 bytes, multi-iteration M3 ladder)', () => {
    // > M3MaxLen + 255 → the ladder while-loop runs at least twice.
    rt(new Uint8Array(600).fill(0x77));
  });

  it('round-trips a literal-run > 18 + 255 bytes (multi-iteration literal ladder)', () => {
    // Pseudo-incompressible head defeats the matcher; literal-ladder loop runs > 1 iteration.
    const buf = new Uint8Array(300);
    for (let i = 0; i < buf.length; i++) buf[i] = (i * 251 + 13) & 0xff;
    rt(buf);
  });
});
