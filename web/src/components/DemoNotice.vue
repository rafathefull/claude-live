<script setup lang="ts">
import { ref } from 'vue'
import { tr } from '../i18n'

/**
 * Aviso de la versión publicada en GitHub Pages.
 *
 * Aquí no hay servidor ni acceso a ningún `~/.claude`: los datos son un mundo inventado que viaja
 * dentro de la página. Decirlo es obligatorio —si no, alguien podría creer que está viendo sus
 * propias sesiones— y también es la mejor manera de explicar qué hace el visor de verdad.
 */

const L = {
  title: { es: 'Demostración', en: 'Demo' },
  body: {
    es: 'Estás viendo un mundo inventado que viaja dentro de esta página: aquí no hay servidor y no se lee ningún ~/.claude. Todo lo demás es el visor de verdad, así que puedes tocarlo todo: cambia de pestaña, abre una conversación del historial y reprodúcela, pulsa el Campamento, pasa el ratón por el mundo.',
    en: 'You are looking at a made-up world that travels inside this page: there is no server here and no ~/.claude is read. Everything else is the real viewer, so feel free to poke around: switch tabs, open a conversation from the history and play it back, click the Camp, hover the world.',
  },
  install: {
    es: 'Para verlo con tus propias sesiones hace falta ejecutarlo en tu máquina:',
    en: 'To see it with your own sessions you need to run it on your machine:',
  },
  repo: { es: 'código y instrucciones', en: 'code and instructions' },
  hide: { es: 'Entendido', en: 'Got it' },
  tour: { es: '🧭 Ver el recorrido', en: '🧭 Take the tour' },
}

const emit = defineEmits<{ (e: 'tour'): void }>()

const REPO = 'https://github.com/rafathefull/claude-live'

const hidden = ref(localStorage.getItem('claude-live:demo-seen') === '1')

function dismiss(): void {
  hidden.value = true
  localStorage.setItem('claude-live:demo-seen', '1')
}
</script>

<template>
  <aside v-if="!hidden" class="demo-notice">
    <div>
      <strong>🎪 {{ tr(L.title) }}</strong>
      <p>{{ tr(L.body) }}</p>
      <p class="muted">
        {{ tr(L.install) }}
        <code>git clone {{ REPO }}</code> ·
        <a :href="REPO" target="_blank" rel="noopener">{{ tr(L.repo) }}</a>
      </p>
    </div>
    <button @click="emit('tour')">{{ tr(L.tour) }}</button>
    <button @click="dismiss">{{ tr(L.hide) }}</button>
  </aside>
</template>
