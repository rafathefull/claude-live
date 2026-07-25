<script setup lang="ts">
import { ref } from 'vue'
import Hud from './components/Hud.vue'
import Stage from './components/Stage.vue'
import Timeline from './components/Timeline.vue'
import Inspector from './components/Inspector.vue'
import HistoryView from './components/HistoryView.vue'
import Legend from './components/Legend.vue'
import ReplayBar from './components/ReplayBar.vue'
import { isReplaying, state } from './store'

const view = ref<'live' | 'history'>('live')
const legendOpen = ref(false)
</script>

<template>
  <div class="app">
    <Hud :view="view" @view="view = $event" @legend="legendOpen = true" />

    <ReplayBar v-if="isReplaying && view === 'live'" />

    <HistoryView v-if="view === 'history'" @open="view = 'live'" />

    <div v-else class="body" :class="{ sober: state.soberMode }">
      <Stage v-if="!state.soberMode">
        <Inspector />
      </Stage>
      <Timeline />
    </div>

    <Legend v-if="legendOpen" @close="legendOpen = false" />
  </div>
</template>
