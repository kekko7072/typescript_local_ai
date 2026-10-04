import { defineConfig, type Options } from 'tsup';

// Adapters import the core through the package's own name so every subpath
// shares one copy of the core (one `LocalAiError` class, one default backend)
// and the consumer's bundler picks the browser or Node build of it.
const shared: Options = {
  format: ['esm'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  external: ['typescript_local_ai', 'react', 'vue', 'svelte', 'svelte/store', 'next', 'server-only'],
};

export default defineConfig([
  {
    ...shared,
    splitting: true,
    entry: {
      browser: 'src/browser.ts',
      node: 'src/node.ts',
      'testing/index': 'src/testing/index.ts',
      'vue/index': 'src/vue/index.ts',
      'svelte/index': 'src/svelte/index.ts',
      'next/index': 'src/next/index.ts',
    },
  },
  {
    ...shared,
    // React Server Components need the directive at the top of the module.
    // esbuild drops it from source, so it is re-added as a banner.
    entry: { 'react/index': 'src/react/index.ts' },
    banner: { js: '"use client";' },
  },
]);
