// LZO1X-1 encoder. Format reference lives in README.md.
//
// Local decisions:
// - 13-bit hash table (8192 entries), keyed on 3 bytes. Single-pass greedy matcher,
//   no chain walk (the canonical "LZO1X-1" complexity profile; lzokay's near-optimal
//   chain-walking variant is intentionally NOT replicated).
// - Last 20 bytes of input are always trailing literals; matches stop short of them.
//   Decoder requires room past every match for wildcopy + EOS detection, so this guard
//   is part of the wire format, not a safety pad.
// - Emit-band logic (encode_literal_run / encode_match) follows the format spec; the
//   structure is necessarily similar to lzokay's MIT-licensed emitter because the
//   format dictates the byte layout.

const M1_MAX_OFFSET = 0x0400; // 1024
const M2_MAX_OFFSET = 0x0800; // 2048
const M3_MAX_OFFSET = 0x4000; // 16384
const M4_MAX_OFFSET = 0xbfff; // 49151
const M2_MAX_LEN = 8;
const M3_MAX_LEN = 33;
const M4_MAX_LEN = 9;
const M3_MARKER = 0x20;
const M4_MARKER = 0x10;

const HASH_BITS = 13;
const HASH_SIZE = 1 << HASH_BITS;
const HASH_MASK = HASH_SIZE - 1;

// Knuth multiplicative hash on the 3 bytes at `p`.
function hash3(b: Uint8Array, p: number): number {
  const v = b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16);
  return (Math.imul(v, 0x1e35a7bd) >>> (32 - HASH_BITS)) & HASH_MASK;
}

export function lzo1xCompress(input: Uint8Array): Uint8Array {
  const inLen = input.length;
  // Worst-case bound per spec: input + ceil(input/16) + 67. Plus a tiny slack.
  const outCap = inLen + ((inLen + 15) >>> 4) + 67 + 16;
  const out = new Uint8Array(outCap);
  let op = 0;
  let litStart = 0; // start of the current pending literal run in `input`
  let ip = 0; // current scan position

  // Hash table: stores positions in `input` (or -1 = empty).
  const ht = new Int32Array(HASH_SIZE).fill(-1);

  // Reserve guard: minimum match length is 3, and we need at least 3 bytes to hash.
  // Last 20 bytes are always literals.
  const TRAIL_GUARD = 20;
  const scanEnd = inLen - TRAIL_GUARD;

  // emit_literal_run: writes the pending literals [litStart, litStart+len) and the appropriate
  // length-encoding header. `firstFrame` means this is the very first thing in the stream,
  // `prevTrail` is the number of literals carried in the previous match-token's low 2 bits.
  const emitLiteralRun = (len: number, firstFrame: boolean): void => {
    if (firstFrame && len !== 0 && len <= 238) {
      // Leading literal token: 0x11 + len. Valid only when output is empty AND len fits.
      out[op++] = 17 + len;
    } else if (len <= 3) {
      // No header; the low 2 bits of the previous match token absorb this run.
      // (Caller is responsible for having reserved those bits.)
      out[op - 2] = (out[op - 2]! | len) & 0xff;
    } else if (len <= 18) {
      out[op++] = len - 3;
    } else {
      // Long literal run: token byte 0x00, then zero-byte ladder, then non-zero remainder.
      out[op++] = 0;
      let rem = len - 18;
      while (rem > 255) {
        out[op++] = 0;
        rem -= 255;
      }
      out[op++] = rem;
    }
    // Copy literals.
    for (let i = 0; i < len; i++) out[op++] = input[litStart + i]!;
  };

  // emit_match: writes one match token + extension bytes. Does NOT emit the post-match
  // trailing literals; the caller does that on the NEXT emitLiteralRun call (the low 2 bits
  // of the token reserve room for that "state").
  const emitMatch = (matchLen: number, matchOff: number, litLen: number): void => {
    // M1 (matchLen === 2) is unreachable from our matcher: the inner loop only triggers
    // when 3 source bytes already match, so matchLen is always >= 3 when emitMatch is
    // called. Kept for spec completeness in case a future matcher variant emits 2-byte
    // matches; the validation filter above also rejects them defensively.
    /* v8 ignore next 5 */
    if (matchLen === 2) {
      const off = matchOff - 1;
      out[op++] = ((off & 0x3) << 2) & 0xff;
      out[op++] = (off >>> 2) & 0xff;
    } else if (matchLen <= M2_MAX_LEN && matchOff <= M2_MAX_OFFSET) {
      // M2: short match, len 3..8, offset 1..2048.
      const off = matchOff - 1;
      out[op++] = (((matchLen - 1) << 5) | ((off & 0x7) << 2)) & 0xff;
      out[op++] = (off >>> 3) & 0xff;
    } else if (matchLen === 3 && matchOff <= M1_MAX_OFFSET + M2_MAX_OFFSET && litLen >= 4) {
      // M1 with state==4 carry: 3-byte match, offset in (2048, 3072].
      const off = matchOff - 1 - M2_MAX_OFFSET;
      out[op++] = ((off & 0x3) << 2) & 0xff;
      out[op++] = (off >>> 2) & 0xff;
    } else if (matchOff <= M3_MAX_OFFSET) {
      // M3: len 3..33, offset ≤ 16384.
      const off = matchOff - 1;
      if (matchLen <= M3_MAX_LEN) {
        out[op++] = (M3_MARKER | (matchLen - 2)) & 0xff;
      } else {
        out[op++] = M3_MARKER;
        let rem = matchLen - M3_MAX_LEN;
        while (rem > 255) {
          out[op++] = 0;
          rem -= 255;
        }
        out[op++] = rem;
      }
      out[op++] = (off << 2) & 0xff;
      out[op++] = (off >>> 6) & 0xff;
    } else {
      // M4: any length, offset in (16384, 49151].
      const off = matchOff - 0x4000;
      if (matchLen <= M4_MAX_LEN) {
        out[op++] = (M4_MARKER | ((off & 0x4000) >>> 11) | (matchLen - 2)) & 0xff;
      } else {
        out[op++] = (M4_MARKER | ((off & 0x4000) >>> 11)) & 0xff;
        let rem = matchLen - M4_MAX_LEN;
        while (rem > 255) {
          out[op++] = 0;
          rem -= 255;
        }
        out[op++] = rem;
      }
      out[op++] = (off << 2) & 0xff;
      out[op++] = (off >>> 6) & 0xff;
    }
  };

  // Main scan.
  let firstFrame = true;

  while (ip < scanEnd) {
    if (ip + 3 > inLen) break;

    const h = hash3(input, ip);
    const ref = ht[h]!;
    ht[h] = ip;

    let matchLen = 0;
    let matchOff = 0;

    if (
      ref >= 0 &&
      ip - ref <= M4_MAX_OFFSET &&
      ip - ref > 0 &&
      input[ref] === input[ip] &&
      input[ref + 1] === input[ip + 1] &&
      input[ref + 2] === input[ip + 2]
    ) {
      // Extend match.
      const maxLen = Math.min(scanEnd - ip, inLen - ref);
      let n = 3;
      while (n < maxLen && input[ref + n] === input[ip + n]) n++;
      matchLen = n;
      matchOff = ip - ref;
    }

    // Filter out matches that the encoder can't legally emit, per the format constraints
    // baked into emitMatch's branches.
    if (matchLen > 0) {
      const litLen = ip - litStart;
      // validM1 (2-byte match) is structurally false here — the matcher only sets matchLen
      // when 3 source bytes match, so matchLen >= 3 always. Kept as a defensive guard.
      const validM1 = matchLen === 2 && matchOff <= M1_MAX_OFFSET && litLen >= 4 && !firstFrame;
      const validM2 = matchLen >= 3 && matchLen <= M2_MAX_LEN && matchOff <= M2_MAX_OFFSET;
      const validM1Long =
        matchLen === 3 &&
        matchOff > M2_MAX_OFFSET &&
        matchOff <= M1_MAX_OFFSET + M2_MAX_OFFSET &&
        litLen >= 4;
      const validM3 = matchLen >= 3 && matchOff <= M3_MAX_OFFSET;
      const validM4 = matchLen >= 3 && matchOff <= M4_MAX_OFFSET;

      // Defensive rejection of out-of-spec matches; the matcher above never produces any
      // (every match it emits is at least 3 bytes long and within M4 distance), so this
      // branch is unreachable from the current matcher.
      /* v8 ignore next 3 */
      if (!(validM1 || validM2 || validM1Long || validM3 || validM4)) {
        matchLen = 0;
      }
    }

    if (matchLen === 0) {
      ip++;
      continue;
    }

    // Emit pending literals + this match.
    const litLen = ip - litStart;
    emitLiteralRun(litLen, firstFrame && op === 0);
    firstFrame = false;
    emitMatch(matchLen, matchOff, litLen);

    // Advance and re-hash the bytes inside the match (keeps the table fresh; matches the
    // canonical LZO1X-1 behaviour of inserting only the first match byte's position).
    // Simple variant: insert just the position we already hashed; advance by matchLen.
    ip += matchLen;
    litStart = ip;
  }

  // Final literal run (the trailing-guard bytes + anything we couldn't match).
  const finalLitLen = inLen - litStart;
  emitLiteralRun(finalLitLen, firstFrame && op === 0);

  // M4 end-of-stream marker: 0x11 0x00 0x00.
  out[op++] = M4_MARKER | 1;
  out[op++] = 0;
  out[op++] = 0;

  return out.slice(0, op);
}
