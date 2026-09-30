/**
 * `@cubby/shared/cad/ui` — CubbyCAD's shape-editing Vue components, shared
 * with Cubby Slicer. Their templates use Nuxt UI (4) components by name
 * (UFormField, UInput, USwitch, USelect, UIcon) and Tailwind classes, so the
 * host app must:
 *  - run Nuxt UI's Vite plugin with `scanPackages: ['@cubby/shared']` (its
 *    component auto-import skips node_modules otherwise; it also swaps in the
 *    Vue-mode UIcon), and
 *  - let Tailwind scan this directory
 *    (`@source "../node_modules/@cubby/shared/src/cad/ui";`).
 *
 * Copy: every label has an i18n key + English; pass `translate` or call
 * `provideCadTranslate(t)` once, else English.
 */
export { default as NumberSlider } from './NumberSlider.vue';
export { default as ShapeParamsForm } from './ShapeParamsForm.vue';
export { default as ShapePalette } from './ShapePalette.vue';
export { CAD_TRANSLATE, provideCadTranslate, useCadTranslate } from './translate';
