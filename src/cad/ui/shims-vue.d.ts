// Plain `tsc` (the package's typecheck) can't read SFCs; the apps' vue-tsc
// type-checks these components against the real Vue / Nuxt UI types.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<any, any, any>;
  export default component;
}
