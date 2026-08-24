import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    main: 'src/main/index.ts',
    preload: 'src/preload/index.ts',
  },
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  dts: false,
  clean: true,
  external: ['electron'],
  outDir: 'dist/main',
})