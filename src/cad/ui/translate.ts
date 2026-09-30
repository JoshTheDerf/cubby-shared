import { inject, provide, type InjectionKey } from 'vue';
import type { Translate } from '../schema';
import { englishTranslate } from '../i18n';

/**
 * How the shared CAD components get their copy: every label they render has a
 * CubbyCAD i18n key and an English fallback, and they ask a `Translate`
 * function for it. Pass one as a `translate` prop, or provide one for a whole
 * subtree with `provideCadTranslate(t)`. Without either, English.
 */
export const CAD_TRANSLATE: InjectionKey<Translate> = Symbol('cubby.cad.translate');

export function provideCadTranslate(t: Translate): void {
  provide(CAD_TRANSLATE, t);
}

/** The translate function for a component: its prop, else the provided one,
 *  else English. Call inside `setup`. */
export function useCadTranslate(prop?: () => Translate | undefined): Translate {
  const injected = inject(CAD_TRANSLATE, englishTranslate);
  return (key, fallback) => (prop?.() ?? injected)(key, fallback);
}
