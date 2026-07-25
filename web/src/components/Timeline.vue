<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { currentAgents, currentEvents, state } from '../store'
import { agentColorCss, formatDuration, formatTime, iconFor, shortTool } from '../format'
import type { TimelineEvent } from '@shared/types'

const list = ref<HTMLElement | null>(null)
const autoScroll = ref(true)

watch(
  () => currentEvents.value.length,
  async () => {
    if (!autoScroll.value) return
    await nextTick()
    const el = list.value
    if (el) el.scrollTop = el.scrollHeight
  },
)

function onScroll(): void {
  const el = list.value
  if (!el) return
  autoScroll.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

function select(event: TimelineEvent): void {
  state.selectedEvent = state.selectedEvent?.uuid === event.uuid ? null : event
}

function toggleActor(id: string): void {
  state.focusActor = state.focusActor === id ? null : id
}

function agentLabel(agentId: string | null): string {
  if (!agentId) return ''
  const agent = state.agents[agentId]
  if (!agent) return agentId.slice(0, 6)
  return agent.agentType ?? agentId.slice(0, 6)
}
</script>

<template>
  <section class="timeline">
    <div class="timeline-head">
      <span class="title">Timeline</span>
      <button :class="{ active: state.showThinking }" @click="state.showThinking = !state.showThinking">
        💭 pensamiento
      </button>
      <button :class="{ active: autoScroll }" @click="autoScroll = !autoScroll">auto-scroll</button>
      <span class="muted">{{ currentEvents.length }} eventos</span>
    </div>

    <div ref="list" class="timeline-list" @scroll="onScroll">
      <div
        v-for="event in currentEvents"
        :key="event.uuid"
        class="row"
        :class="[
          `kind-${event.kind}`,
          { indent: !!event.agentId, error: event.isError, selected: state.selectedEvent?.uuid === event.uuid },
        ]"
        @click="select(event)"
      >
        <span class="time">{{ formatTime(event.ts) }}</span>
        <span class="icon">{{ iconFor(event) }}</span>
        <span class="main">
          <span
            v-if="event.agentId"
            class="badge"
            :style="{ borderColor: agentColorCss(state.agents[event.agentId]?.agentType), color: agentColorCss(state.agents[event.agentId]?.agentType) }"
          >
            {{ agentLabel(event.agentId) }}
          </span>
          <span v-if="event.tool" class="tool">{{ shortTool(event.tool) }}</span>
          <span v-if="event.durationMs !== undefined" class="dur">{{ formatDuration(event.durationMs) }}</span>
          <span class="summary">{{ event.summary }}</span>
        </span>
      </div>

      <div v-if="currentEvents.length === 0" class="row">
        <span class="time" />
        <span class="icon">·</span>
        <span class="main muted">
          Sin actividad todavía. Escribe algo en tu sesión de Claude y aparecerá aquí.
        </span>
      </div>
    </div>

    <div class="agent-legend">
      <span
        class="agent-pill"
        :class="{ selected: state.focusActor === null }"
        @click="state.focusActor = null"
      >
        todo
      </span>
      <span
        class="agent-pill"
        :class="{ selected: state.focusActor === 'main' }"
        @click="toggleActor('main')"
      >
        <i class="swatch" style="background: #e5e7eb" /> Claude
      </span>
      <span
        v-for="agent in currentAgents"
        :key="agent.id"
        class="agent-pill"
        :class="{ selected: state.focusActor === agent.id, done: !agent.active }"
        :title="agent.description"
        @click="toggleActor(agent.id)"
      >
        <i class="swatch" :style="{ background: agentColorCss(agent.agentType) }" />
        {{ agent.agentType ?? 'agente' }}
        <span class="muted">{{ agent.events }}</span>
      </span>
    </div>
  </section>
</template>
