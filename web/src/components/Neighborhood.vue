<script setup lang="ts">
import { computed } from 'vue'
import { STATIONS } from '@shared/mapping'
import { liveSessions, state, stopReplay } from '../store'
import { summarizeSession } from '../neighborhood'
import { JOB_EMOJI, JOB_STATE_TEXT } from '../world/Scene'
import { agentColorCss, contextPercent, formatTokens, shortTool } from '../format'
import { tr } from '../i18n'
import type { SessionInfo } from '@shared/types'

/**
 * El barrio: todas las sesiones vivas a la vez, cada una con su plano.
 *
 * No son mundos en miniatura: son planos. Un canvas de Pixi por tarjeta serían N renderers
 * WebGL a la vez, y la escena grande ya da bastante trabajo a la máquina. Aquí cada estación es
 * una celda que se enciende cuando se usa, con su recuento, así que de un vistazo se ve en qué
 * anda cada sesión sin pagar el precio del mundo por duplicado.
 */

const L = {
  title: { es: 'Vecindario', en: 'Neighbourhood' },
  sessions: { es: 'sesiones vivas', en: 'live sessions' },
  session: { es: 'sesión viva', en: 'live session' },
  empty: {
    es: 'No hay ninguna sesión de Claude abierta. Abre claude en cualquier directorio y aparecerá aquí sola.',
    en: 'No Claude session is open. Run claude in any directory and it will show up here on its own.',
  },
  quiet: { es: 'sin actividad todavía', en: 'nothing yet' },
  lastly: { es: 'lo último', en: 'last thing' },
  enter: { es: 'Entrar en esta habitación', en: 'Enter this room' },
  busy: { es: 'trabajando', en: 'working' },
  idle: { es: 'esperándote', en: 'waiting for you' },
  context: { es: 'contexto', en: 'context' },
  failed: { es: 'la última herramienta falló', en: 'the last tool failed' },
  uses: { es: 'usos', en: 'uses' },
  hint: {
    es: 'Cada plano son las estaciones del mundo: se encienden al usarse y llevan su recuento. Pulsa una tarjeta para entrar en esa habitación.',
    en: 'Each plan shows the stations of the world: they light up when used and carry their count. Click a card to enter that room.',
  },
}

const emit = defineEmits<{ (e: 'enter'): void }>()

/** Las diez estaciones que son sitios de trabajo. La Mesa no es una, y el Campamento es global. */
const PLAN = STATIONS.filter((meta) => meta.id !== 'desk' && meta.id !== 'camp')

const cards = computed(() =>
  liveSessions.value.map((session) => ({
    session,
    summary: summarizeSession(
      state.events[session.sessionId] ?? [],
      Object.values(state.agents).filter((agent) => agent.sessionId === session.sessionId),
    ),
    // Una sesión de background es un job del Campamento: mientras no haya movido nada, lo que
    // se puede contar de ella es su propio parte de situación. El id corto del job es el
    // prefijo de su sessionId (`1feb7d97` ↔ `1feb7d97-7603-…`), así que valen las dos formas.
    job: state.jobs.find(
      (candidate) =>
        candidate.sessionId === session.sessionId || session.sessionId.startsWith(candidate.id),
    ),
  })),
)

function enter(session: SessionInfo): void {
  stopReplay()
  state.selectedSessionId = session.sessionId
  emit('enter')
}

function stateLabel(session: SessionInfo): string {
  return session.status === 'busy' ? tr(L.busy) : tr(L.idle)
}
</script>

<template>
  <div class="hood">
    <header class="hood-head">
      <strong>🏘️ {{ tr(L.title) }}</strong>
      <span class="muted">
        {{ cards.length }} {{ cards.length === 1 ? tr(L.session) : tr(L.sessions) }}
      </span>
      <span class="muted hood-hint">{{ tr(L.hint) }}</span>
    </header>

    <p v-if="cards.length === 0" class="muted hood-empty">{{ tr(L.empty) }}</p>

    <div v-else class="hood-grid">
      <article
        v-for="card in cards"
        :key="card.session.sessionId"
        class="hood-card"
        :class="{ selected: card.session.sessionId === state.selectedSessionId }"
        :title="tr(L.enter)"
        @click="enter(card.session)"
      >
        <header>
          <i class="dot" :class="card.session.status" :title="stateLabel(card.session)" />
          <strong>{{ card.session.project }}</strong>
          <span v-if="card.session.background" class="muted">bg</span>
          <span class="muted branch">{{ card.session.gitBranch ?? '—' }}</span>
        </header>

        <!-- El plano: cada celda una estación, encendida si se ha usado, marcada si es la última. -->
        <div class="hood-plan">
          <span
            v-for="meta in PLAN"
            :key="meta.id"
            class="plan-cell"
            :class="{
              used: (card.summary.uses[meta.id] ?? 0) > 0,
              here: card.summary.lastStation === meta.id && card.session.status === 'busy',
              last: card.summary.lastStation === meta.id && card.session.status !== 'busy',
            }"
            :title="`${tr(meta.label)}${card.summary.uses[meta.id] ? ` · ${card.summary.uses[meta.id]} ${tr(L.uses)}` : ''}`"
          >
            <span class="plan-icon">{{ meta.icon }}</span>
            <span v-if="card.summary.uses[meta.id]" class="plan-count">
              {{ card.summary.uses[meta.id] }}
            </span>
          </span>
        </div>

        <p
          class="hood-doing"
          :class="{ failed: card.summary.lastFailed, past: card.session.status !== 'busy' }"
        >
          <template v-if="card.summary.lastStation">
            <span v-if="card.session.status === 'busy'" class="doing-where">
              🤖→{{ STATIONS.find((s) => s.id === card.summary.lastStation)?.icon }}
            </span>
            <!-- Esperándote no es estar en ninguna estación: se cuenta en pasado. -->
            <span v-else class="doing-where muted">
              {{ tr(L.lastly) }} {{ STATIONS.find((s) => s.id === card.summary.lastStation)?.icon }}
            </span>
            <span class="doing-tool">{{ shortTool(card.summary.lastTool) }}</span>
            <span class="doing-detail" :title="card.summary.lastSummary">
              {{ card.summary.lastSummary }}
            </span>
          </template>
          <template v-else-if="card.job">
            <span class="doing-where">{{ JOB_EMOJI[card.job.state] }}</span>
            <span class="doing-tool">{{ tr(JOB_STATE_TEXT[card.job.state]) }}</span>
            <span class="doing-detail" :title="card.job.detail ?? card.job.intent">
              {{ card.job.detail ?? card.job.intent }}
            </span>
          </template>
          <template v-else>
            <span class="muted">{{ tr(L.quiet) }}</span>
          </template>
        </p>

        <div v-if="card.summary.agents.length > 0" class="hood-agents">
          <span
            v-for="agent in card.summary.agents"
            :key="agent.id"
            class="hood-agent"
            :class="{ done: agent.done }"
            :title="agent.description ?? agent.id"
          >
            <i class="swatch" :style="{ background: agentColorCss(agent.agentType, agent.variant) }" />
            {{ agent.agentType ?? 'agent' }}
          </span>
        </div>

        <footer>
          <span class="muted">{{ card.session.model ?? '—' }}</span>
          <span class="hood-ctx">
            {{ tr(L.context) }}
            <span class="bar"><span :style="{ width: `${contextPercent(card.session)}%` }" /></span>
            {{ contextPercent(card.session) }}%
          </span>
          <span class="muted">
            {{ formatTokens((card.session.tokens?.input ?? 0) + (card.session.tokens?.output ?? 0)) }}
          </span>
        </footer>
      </article>
    </div>
  </div>
</template>
