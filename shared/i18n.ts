/**
 * Textos en dos idiomas, compartidos entre el servidor y el front.
 *
 * No hay ficheros de traducción con claves: cada texto se escribe en su sitio con las dos
 * versiones juntas (`{ es: '…', en: '…' }`). En un proyecto de este tamaño evita el problema
 * clásico de las claves huérfanas y hace imposible traducir a medias sin darse cuenta.
 */

export type Lang = 'es' | 'en'

export const LANGS: Lang[] = ['es', 'en']

/** Un texto con sus dos versiones. */
export interface Text {
  es: string
  en: string
}

export function pick(text: Text, lang: Lang): string {
  return text[lang]
}

/** Idioma inicial: el del navegador si es español, inglés en cualquier otro caso. */
export function detectLang(candidate: string | undefined): Lang {
  return candidate?.toLowerCase().startsWith('es') ? 'es' : 'en'
}
