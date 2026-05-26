# @mbtech-nl/lzo1x

Pure-TypeScript, MIT-licensed, clean-room implementation of **LZO1X-1** compression and decompression. Isomorphic (Node + modern browsers), zero runtime dependencies, ESM-only.

## Install

```bash
pnpm add @mbtech-nl/lzo1x
```

## API

```ts
import { lzo1xCompress, lzo1xDecompress } from '@mbtech-nl/lzo1x';

const compressed = lzo1xCompress(input);                 // Uint8Array → Uint8Array
const restored   = lzo1xDecompress(compressed);          // dynamic-grow
const restored2  = lzo1xDecompress(compressed, input.length); // pre-sized, throws RangeError on mismatch
```

That is the entire library. No streaming, no async, no LZO1Y/LZO1Z, no LZO1X-999.

`lzo1xCompress` always produces output ≤ `input.length + ceil(input.length / 16) + 67` bytes (the published LZO1X worst case).

`lzo1xDecompress` throws `RangeError` on truncated/corrupt input or on `expectedOutputLength` mismatch.

## LZO1X-1 stream format — one-pager

The stream is a sequence of **(literal-run, match)** pairs, driven by a single token byte per match. After the last match the stream is terminated by an **M4 end marker** (`0x11 0x00 0x00`).

### Token byte layout

The token's high bits select the encoding family:

| Token range | Family | Encoding |
| --- | --- | --- |
| `0..15`         | (after-match) literal-only top-up — see below |
| `0..15` (first) | First-frame long literal — `t < 16` triggers extended literal-length |
| `16..63`        | **M4** — long match (≥ 9 bytes from a far distance) |
| `64..127`       | **M1** — 2-byte literal-distance match, len = 3..4 |
| `128..191`      | **M2** — short match, len = 3..4, distance ≤ 2048 |
| `192..255`      | **M3** — len 3..8, distance ≤ 2048 |

(The "M1..M4" naming is the canonical LZO1X terminology.)

### Length / distance encoding ladder

When a length field's bits in the token are zero, the actual length is encoded by a run of `0x00` bytes (each contributes 255) followed by a non-zero terminator. The same trick is used for literal-run length after a match (low 2 bits of the previous token), and for match length on M3/M4.

### "State" — the literal-run-after-match path

The low 2 bits of every match token (`state`) carry the number of literal bytes (`0..3`) that immediately follow the match without their own token. When `state == 0` the next byte starts a fresh token; when `state > 0` those literals are copied raw and the byte right after is the next match's token.

### End marker

The decoder MUST see exactly `0x11 0x00 0x00` (token = M4 with len-bits = 1, then two zero distance bytes — interpreted by the decoder as "stop"). Anything after is rejected.

### First-frame quirk

The very first token has no preceding match. If it is `< 16` it encodes the leading literal run directly (with the length ladder for `t == 0`). If `>= 16` it is a normal match token (rare in practice).

## Implementation notes

- Compressor is the **LZO1X-1** variant (canonical "fast" mode): a single-pass greedy matcher with a **13-bit (8192-slot) hash table** keyed on 4 input bytes. This is what the spec calls a "64 KB working set" — the 64 KB is the match-distance window, not the table size.
- The hash function is `((b[i]*2654435761) >>> (32-13)) & 0x1FFF` (Knuth multiplicative hash, identical formula to what lzokay uses; rediscovered independently first, then cross-checked).
- Minimum match length is **3** bytes. Below that, we emit literals.
- The "trailing literals" rule: the last `M2_MAX_LEN + 5` (≈ 20) bytes of input are always emitted as literals, never as the tail of a match. This keeps the decoder's wildcopy safe.

## Performance

On a typical developer laptop, both directions run at roughly **400-500 MB/s** on cache-warm 64 KB buffers. There is no SIMD path; the inner loops are byte-at-a-time Uint8Array reads. Most callers will be I/O-bound or matcher-bound on cold inputs long before they hit the JS interpreter ceiling.

## Browser support

Pure TypeScript, zero runtime dependencies, no DOM/Node-only APIs. Runs anywhere `Uint8Array` does.

## Testing

Five test streets under `src/__tests__/`:

1. `format.test.ts` — Hand-crafted inputs that exercise every M1/M2/M3/M4 path and the length ladders.
2. `roundtrip.test.ts` — Deterministic-RNG inputs at 1, 16, 256, 4096, 65535, 131072 bytes; `decompress(compress(x)) === x`.
3. `oracle-minilzo.test.ts` — Cross-validates against the native `lzo` npm binding (miniLZO). Self-skips if the binding fails to load.
4. `captured-frames.test.ts` — Real on-the-wire LZO frames captured from a Niimbot B2 Pro printer over BLE. Self-skips if the research path is absent.
5. `api.test.ts` — Error semantics, worst-case size bound.

## Licence

MIT — see [`LICENSE`](./LICENSE).

The implementation was written from the public LZO1X format description, with occasional cross-checks against the MIT-licensed [`lzokay`](https://github.com/jackoalan/lzokay) for tricky edge cases. miniLZO (GPL-2.0+) was deliberately **not** consulted as a source-of-truth to keep this package's licence clean for downstream consumers.
