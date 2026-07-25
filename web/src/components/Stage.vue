<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isReplaying, onEvent, selectedSession, state } from '../store'
import { Scene, type HoverInfo } from '../world/Scene'
import { Director } from '../world/director'
import type { TimelineEvent } from '@shared/types'

const host = ref<HTMLElement | null>(null)
/** Ayuda contextual del elemento bajo el cursor, para no tener que abrir la leyenda. */
const hover = ref<HoverInfo | null>(null)
const hoverPos = ref({ x: 0, y: 0 })
let scene: Scene | null = null
let director: Director | null = null
let unsubscribe: (() => void) | null = null

function labelFor(): string {
  const session = selectedSession.value
  if (!session) return 'Claude'
  return session.project || 'Claude'
}

function feed(event: TimelineEvent): void {
  if (!director) return
  if (event.sessionId !== state.selectedSessionId) return
  if (!state.showThinking && event.kind === 'thinking') return
  director.handle(event)
}

onMounted(async () => {
  if (!host.value) return
  scene = new Scene()
  await scene.mount(host.value)
  director = new Director(scene)
  director.bootstrap(labelFor())
  scene.app.ticker.add(() => director?.tick(performance.now()))
  scene.setHoverHandler((info, x, y) => {
    hover.value = info
    if (info) hoverPos.value = { x, y }
  })
  unsubscribe = onEvent(feed)
  primeWorld()
})

/**
 * Puebla el mundo al montar, al cambiar de sesión o tras un salto del reproductor.
 * En directo se muestran los últimos eventos (lo que importa es el ahora); en replay se
 * reconstruye solo el contexto inmediato anterior al punto actual, porque de ahí en
 * adelante los eventos los va soltando el motor del reproductor.
 */
function primeWorld(): void {
  if (!director) return
  director.reset(labelFor())
  const sessionId = state.selectedSessionId
  if (!sessionId) return
  const events = state.events[sessionId] ?? []
  const slice = isReplaying.value
    ? events.slice(Math.max(0, state.replay.index - 6), state.replay.index)
    : events.slice(-25)
  for (const event of slice) feed(event)
}

watch(() => state.selectedSessionId, primeWorld)
watch(() => state.replay.seekToken, primeWorld)

watch(
  () => selectedSession.value?.project,
  () => director?.setMainLabel(labelFor()),
)

const TIP_W = 290
const TIP_H = 150

const tooltipStyle = computed(() => {
  const width = host.value?.clientWidth ?? 0
  const height = host.value?.clientHeight ?? 0
  const x = Math.min(hoverPos.value.x + 18, Math.max(8, width - TIP_W))
  const y = Math.min(hoverPos.value.y + 16, Math.max(8, height - TIP_H))
  return { left: `${x}px`, top: `${y}px` }
})

onBeforeUnmount(() => {
  unsubscribe?.()
  scene?.destroy()
  scene = null
  director = null
})
</script>

<template>
  <div class="stage" ref="host">
    <div v-if="!state.selectedSessionId" class="stage-empty">
      <div>
        <p>No hay ninguna sesión de Claude abierta.</p>
        <p class="muted">
          Abre <code>claude</code> en cualquier directorio y aparecerá aquí sola: no hay que
          configurar nada en el proyecto.
        </p>
      </div>
    </div>
    <aside v-if="hover" class="world-tip" :style="tooltipStyle">
      <header>
        <span class="tip-icon">{{ hover.icon }}</span>
        <strong :style="hover.color ? { color: hover.color } : undefined">{{ hover.title }}</strong>
      </header>
      <p>{{ hover.body }}</p>
      <p v-if="hover.extra" class="tip-extra">{{ hover.extra }}</p>
    </aside>

    <slot />
  </div>
</template>
