// Test-side helpers: deterministic PRNG so test inputs are reproducible across runs.

export function lcgBytes(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed >>> 0;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = x & 0xff;
  }
  return out;
}

export function repeatPattern(pat: string, totalBytes: number): Uint8Array {
  const p = new TextEncoder().encode(pat);
  const out = new Uint8Array(totalBytes);
  for (let i = 0; i < totalBytes; i++) out[i] = p[i % p.length]!;
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Try to load the native miniLZO binding. Returns null if unavailable.
export async function loadMiniLzo(): Promise<{
  compress: (buf: Uint8Array) => Uint8Array;
  decompress: (buf: Uint8Array, length: number) => Uint8Array;
} | null> {
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const mod = require('lzo') as {
      compress: (b: Buffer) => Buffer;
      decompress: (b: Buffer, n: number) => Buffer;
    };
    return {
      compress: (buf) => new Uint8Array(mod.compress(Buffer.from(buf))),
      decompress: (buf, length) => new Uint8Array(mod.decompress(Buffer.from(buf), length)),
    };
  } catch {
    return null;
  }
}
