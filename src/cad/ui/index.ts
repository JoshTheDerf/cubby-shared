/**
 * `@cubby/shared/cad/ui` — CubbyCAD's shape-editing Vue components, shared
 * with Cubby Slicer. They use @nuxt/ui (4) components and Tailwind classes, so
 * the host app must use Nuxt UI, resolve `@nuxt/ui` / `vue` from itself
 * (`resolve.dedupe`) and let Tailwind scan this directory
 * (`@source "../node_modules/@cubby/shared/src/cad/ui";`).
 *
 * Copy: every label has an i18n key + English; pass `translate` or call
 * `provideCadTranslate(t)` once, else English.
 */
export { default as NumberSlider } from './NumberSlider.vue';
export { default as ShapeParamsForm } from './ShapeParamsForm.vue';
export { default as ShapePalette } from './ShapePalette.vue';
export { CAD_TRANSLATE, provideCadTranslate, useCadTranslate } from './translate';
