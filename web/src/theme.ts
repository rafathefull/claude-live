import { ref, watch } from 'vue'

/**
 * Tema claro / oscuro. El oscuro es el de siempre; el claro existe porque un panel que se
 * deja abierto todo el día junto al editor debería poder ir a juego con él.
 *
 * El valor se marca en `<html data-theme>`: el CSS redefine sus variables y la escena Pixi
 * pide su paleta en `world/palette.ts`. La preferencia del sistema solo decide la primera
 * vez; a partir de ahí manda lo que hayas elegido.
 */

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'claude-live:theme'

function initial(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch {
    // Sin almacenamiento: se decide por el sistema y no se recuerda.
  }
  return globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export const theme = ref<Theme>(initial())

export function applyTheme(): void {
  document.documentElement.dataset.theme = theme.value
}

export function toggleTheme(): void {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
}

watch(theme, (value) => {
  applyTheme()
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // Igual que arriba: vale para esta sesión.
  }
})
