import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

// The Vue plugin compiles the SFCs in `src/cad/ui` for their tests; it is inert
// for plain .ts modules. Nuxt UI isn't a dependency here: the setup file
// registers minimal stand-ins for the U* components (the apps render the real
// ones through Nuxt UI's auto-import).
export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/cad/ui/test/setup.ts'],
  },
});
