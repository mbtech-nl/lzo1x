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

  it('decodes the M1 state==4 carry path (3-byte match, distance in (2048, 3072])', () => {
    // Hand-crafted decoder input that exercises the `inst < 0x10 && state == 4` branch.
    // miniLZO emits this token shape; our encoder also does (see M1-long round-trip below),
    // but the cheapest coverage proof is a deterministic byte stream.
    //
    // Stream layout:
    //   1) Token 0x00, ladder [0×7, 247] → first-frame literal-run of len = 18 + 2032 = 2050
    //      (decoder enters state==0 → literal branch, exits with state = 4, op = 2050).
    //   2) Token 0x00, distance byte 0x00 → M1-carry: matchLen = 3, distance = 0 + 0 + 2049.
    //   3) M4 end-of-stream marker.
    const stream: number[] = [];
    stream.push(0x00);
    for (let i = 0; i < 7; i++) stream.push(0x00);
    stream.push(247); // ladder terminator: 7*255 + 247 = 2032; +18 = 2050 literal bytes
    for (let i = 0; i < 2050; i++) stream.push((i + 1) & 0xff);
    stream.push(0x00, 0x00); // M1-carry, distance 2049 → matchSrc = 2050 - 2049 = 1
    stream.push(0x11, 0x00, 0x00); // EOS

    const decoded = lzo1xDecompress(new Uint8Array(stream));
    expect(decoded.length).toBe(2053);
    for (let i = 0; i < 2050; i++) expect(decoded[i]).toBe((i + 1) & 0xff);
    // 3-byte M1-carry copies output[1..4) to output[2050..2053).
    expect(decoded[2050]).toBe(decoded[1]);
    expect(decoded[2051]).toBe(decoded[2]);
    expect(decoded[2052]).toBe(decoded[3]);
  });

  it('round-trips the M1-long encoder branch (3-byte match, offset in (2048, 3072])', () => {
    // Force emitMatch's M1-long branch: matchLen === 3 && matchOff in (M2_MAX_OFFSET, 3072]
    // && litLen >= 4. Construction:
    //   - bytes 0..2     : marker (AA BB CC); hashes into ht[h_marker] = 0.
    //   - bytes 3..2049  : zero-fill (2047 zeros) → compresses to one M3 match of length 2046
    //                       starting at ip=4 (ref=3, distance=1). After emission, ip = 2050.
    //   - bytes 2050..2053: four distinct literals → litLen will be 4 when we reach the marker.
    //   - bytes 2054..2056: marker repeat → 3-byte match at offset 2054 (> 2048, ≤ 3072).
    //   - bytes 2057..2076: trail-guard literals (must be non-zero so the marker match
    //                       can't extend past 3 bytes).
    const buf = new Uint8Array(2077);
    buf[0] = 0xaa;
    buf[1] = 0xbb;
    buf[2] = 0xcc;
    // buf[3..2049] already zero
    buf[2050] = 0xdd;
    buf[2051] = 0xde;
    buf[2052] = 0xdf;
    buf[2053] = 0xe0;
    buf[2054] = 0xaa;
    buf[2055] = 0xbb;
    buf[2056] = 0xcc;
    for (let i = 2057; i < 2077; i++) buf[i] = ((i * 17) | 1) & 0xff; // non-zero trail
    rt(buf);
  });
});
