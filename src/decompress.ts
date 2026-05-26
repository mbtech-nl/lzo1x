// LZO1X decoder. Format reference lives in README.md.
// Structure follows the canonical bit-mask decoder (M2: bit 0xC0, M3: 0x20, M4: 0x10);
// cross-checked against lzokay (MIT) for the state machine and the trail-literal carry.

const ERR_OVERRUN = 'lzo1x: unexpected end of input';
const ERR_LOOKBEHIND = 'lzo1x: invalid lookbehind reference';
const ERR_TRAILING = 'lzo1x: trailing bytes after end-of-stream marker';
const ERR_NO_EOS = 'lzo1x: missing end-of-stream marker';
const ERR_LENGTH = 'lzo1x: decompressed length does not match expectedOutputLength';

export function lzo1xDecompress(input: Uint8Array, expectedOutputLength?: number): Uint8Array {
  const inEnd = input.length;
  if (inEnd < 3) throw new RangeError(ERR_OVERRUN);

  const presized = expectedOutputLength !== undefined;
  let out: Uint8Array = presized
    ? new Uint8Array(expectedOutputLength)
    : new Uint8Array(Math.max(64, input.length * 2));
  let op = 0;

  const ensure = (need: number): void => {
    if (presized) {
      if (op + need > out.length) throw new RangeError(ERR_LENGTH);
      return;
    }
    if (op + need <= out.length) return;
    let cap = out.length;
    while (cap < op + need) cap *= 2;
    const grown = new Uint8Array(cap);
    grown.set(out.subarray(0, op));
    out = grown;
  };

  let ip = 0;
  let state = 0;
  let nstate = 0;
  let matchLen = 0;
  let matchSrc = 0;

  // First-frame handling: leading literal run encoded directly in the first byte.
  const first = input[ip]!;
  if (first >= 22) {
    const len = first - 17;
    ip++;
    if (ip + len > inEnd) throw new RangeError(ERR_OVERRUN);
    ensure(len);
    for (let i = 0; i < len; i++) out[op++] = input[ip++]!;
    state = 4;
  } else if (first >= 18) {
    const len = first - 17;
    ip++;
    if (ip + len > inEnd) throw new RangeError(ERR_OVERRUN);
    ensure(len);
    for (let i = 0; i < len; i++) out[op++] = input[ip++]!;
    state = len;
    nstate = len;
  }

  let sawEos = false;

  // Helper: length-encoding ladder reads zero-bytes-then-nonzero, returns the accumulated extension.
  const readLengthLadder = (): number => {
    let extra = 0;
    while (ip < inEnd && input[ip] === 0) {
      extra += 255;
      ip++;
      if (extra > 0x40000) throw new RangeError(ERR_OVERRUN); // sanity cap
    }
    if (ip >= inEnd) throw new RangeError(ERR_OVERRUN);
    extra += input[ip++]!;
    return extra;
  };

  mainLoop: while (true) {
    if (ip >= inEnd) throw new RangeError(ERR_OVERRUN);
    const inst = input[ip++]!;

    if (inst & 0xc0) {
      // M2 family: high two bits set somewhere → short match.
      if (ip >= inEnd) throw new RangeError(ERR_OVERRUN);
      const h = input[ip++]!;
      matchSrc = op - ((h << 3) + ((inst >> 2) & 0x7) + 1);
      matchLen = (inst >> 5) + 1;
      nstate = inst & 0x3;
    } else if (inst & 0x20) {
      // M3 family: bit 0x20 set, 0xC0 clear.
      matchLen = (inst & 0x1f) + 2;
      if (matchLen === 2) {
        const extra = readLengthLadder();
        matchLen += extra + 31;
      }
      if (ip + 2 > inEnd) throw new RangeError(ERR_OVERRUN);
      const lo = input[ip++]!;
      const hi = input[ip++]!;
      const word = lo | (hi << 8);
      matchSrc = op - ((word >>> 2) + 1);
      nstate = word & 0x3;
    } else if (inst & 0x10) {
      // M4 family: bit 0x10 set, 0x30 clear above it.
      matchLen = (inst & 0x7) + 2;
      if (matchLen === 2) {
        const extra = readLengthLadder();
        matchLen += extra + 7;
      }
      if (ip + 2 > inEnd) throw new RangeError(ERR_OVERRUN);
      const lo = input[ip++]!;
      const hi = input[ip++]!;
      const word = lo | (hi << 8);
      const distBase = ((inst & 0x8) << 11) + (word >>> 2);
      nstate = word & 0x3;
      if (distBase === 0) {
        // End-of-stream sentinel: inst=0x11, lo=0, hi=0 → distBase = 0, matchLen = 3
        sawEos = true;
        break mainLoop;
      }
      matchSrc = op - distBase - 16384;
    } else {
      // inst < 0x10: literal-run token, OR M1 short match when state != 0.
      if (state === 0) {
        // Literal run. Length = inst + 3, or extended via the ladder when inst == 0.
        let len = inst + 3;
        if (len === 3) {
          const extra = readLengthLadder();
          len += extra + 15;
        }
        if (ip + len > inEnd) throw new RangeError(ERR_OVERRUN);
        ensure(len);
        for (let i = 0; i < len; i++) out[op++] = input[ip++]!;
        state = 4;
        continue;
      } else if (state !== 4) {
        // M1: 2-byte match, distance ≤ 1024.
        if (ip >= inEnd) throw new RangeError(ERR_OVERRUN);
        nstate = inst & 0x3;
        matchSrc = op - ((inst >> 2) + (input[ip++]! << 2) + 1);
        matchLen = 2;
      } else {
        // M1 with state==4 carry: 3-byte match, distance in [2049, 3072].
        if (ip >= inEnd) throw new RangeError(ERR_OVERRUN);
        nstate = inst & 0x3;
        matchSrc = op - ((inst >> 2) + (input[ip++]! << 2) + 2049);
        matchLen = 3;
      }
    }

    if (matchSrc < 0) throw new RangeError(ERR_LOOKBEHIND);

    // Emit match (byte-by-byte; LZO matches may overlap so memcpy semantics matter).
    ensure(matchLen + nstate);
    for (let i = 0; i < matchLen; i++) out[op++] = out[matchSrc++]!;
    state = nstate;
    if (nstate > 0) {
      if (ip + nstate > inEnd) throw new RangeError(ERR_OVERRUN);
      for (let i = 0; i < nstate; i++) out[op++] = input[ip++]!;
    }
  }

  if (!sawEos) throw new RangeError(ERR_NO_EOS);
  // The EOS marker requires matchLen == 3 (i.e. inst & 0x7 == 1 → matchLen = 3 from "(inst & 7) + 2").
  if (matchLen !== 3) throw new RangeError(ERR_NO_EOS);
  if (ip !== inEnd) throw new RangeError(ERR_TRAILING);

  if (presized) {
    if (op !== expectedOutputLength) throw new RangeError(ERR_LENGTH);
    return out;
  }
  return op === out.length ? out : out.slice(0, op);
}
