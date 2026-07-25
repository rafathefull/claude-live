import { ref } from 'vue'
import { detectLang, type Lang, type Text } from '@shared/i18n'

/**
 * Idioma de la interfaz. Arranca con el del navegador y se recuerda entre visitas.
 * Los textos se declaran en su sitio como `{ es, en }` y se resuelven con `tr()`.
 */

const STORAGE_KEY = 'claude-live:lang'

function initial(): Lang {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'es' || saved === 'en') return saved
  return detectLang(navigator.language)
}

export const lang = ref<Lang>(initial())

export function setLang(next: Lang): void {
  lang.value = next
  localStorage.setItem(STORAGE_KEY, next)
  document.documentElement.lang = next
}

document.documentElement.lang = lang.value

/** Resuelve un texto al idioma activo. Es reactivo: al cambiarlo, la vista se repinta. */
export function tr(text: Text): string {
  return text[lang.value]
}

export type { Lang, Text }
