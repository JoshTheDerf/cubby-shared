import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

// The Vue plugin compiles the SFCs in `src/cad/ui` for their tests; it is inert
// for plain .ts modules. Nuxt UI isn't a dependency here, so its components
// resolve to minimal stand-ins (the apps render the real ones).
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      {
        find: /^@nuxt\/ui\/components\/(\w+)\.vue$/,
        replacement: fileURLToPath(new URL('./src/cad/ui/test/stubs/$1.vue', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
