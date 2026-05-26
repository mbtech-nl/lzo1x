import mbtech from '@mbtech-nl/eslint-config';

export default [
  ...mbtech,
  {
    // The codec's tight inner loops use non-null assertions on Uint8Array reads.
    // noUncheckedIndexedAccess flags them as `number | undefined`; correctness is
    // bounded by surrounding `ip < inEnd` / `op < out.length` checks, not by the
    // type system. Suppress the rule for this package's two source files.
    files: ['src/compress.ts', 'src/decompress.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
];
