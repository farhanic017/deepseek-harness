import { defineConfig } from 'tsdown'

// lib/types/invariant.js bundled via entry invariant
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    invariant: 'src/invariant.ts',
  },
  platform: 'node',
  format: ['esm', 'cjs'],
  target: 'node20',
  sourcemap: true,
  dts: true,
  clean: true,
})