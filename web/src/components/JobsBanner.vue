<script setup lang="ts">
import { computed } from 'vue'
import { openJobSession, state } from '../store'
import { JOB_EMOJI, JOB_STATE_TEXT } from '../world/Scene'
import { formatDate } from '../format'
import { tr } from '../i18n'
import type { JobInfo } from '@shared/types'

/**
 * Los jobs en segundo plano, desplegados sobre el escenario al pulsar el Campamento.
 *
 * Un banner y no un sitio fijo del mundo: son una lista con nombres largos y partes de
 * situación, y eso no se lee en una esquina del canvas. Aparece cuando lo pides y se va.
 */

const L = {
  title: { es: 'Campamento', en: 'Camp' },
  subtitle: {
    es: 'jobs en segundo plano · pulsa uno para ver su conversación',
    en: 'background jobs · click one to see its conversation',
  },
  empty: {
    es: 'No hay ningún job en segundo plano. Se lanzan con /bg desde cualquier sesión.',
    en: 'No background jobs. Launch one with /bg from any session.',
  },
  close: { es: 'Cerrar', en: 'Close' },
  noSession: {
    es: 'este job no dejó conversación que abrir',
    en: 'this job left no conversation to open',
  },
  staleNote: {
    es: 'su fichero dice que sigue trabajando, pero no hay ningún proceso detrás',
    en: 'its file says it is still working, but there is no process behind it',
  },
}

const emit = defineEmits<{ (e: 'close'): void }>()

const jobs = computed(() => state.jobs)

function project(job: JobInfo): string {
  return job.cwd ? (job.cwd.split('/').filter(Boolean).pop() ?? '') : ''
}

/** Lo último que se sabe de él: el resultado si terminó, y si no su parte de situación. */
function said(job: JobInfo): string {
  return job.result ?? job.detail ?? job.intent ?? ''
}

async function open(job: JobInfo): Promise<void> {
  const ok = await openJobSession(job)
  if (ok) emit('close')
}
</script>

<template>
  <aside class="jobs-banner">
    <header>
      <span class="banner-icon">🏕️</span>
      <strong>{{ tr(L.title) }}</strong>
      <span class="muted">{{ tr(L.subtitle) }}</span>
      <button :title="tr(L.close)" @click="emit('close')">✕</button>
    </header>

    <p v-if="jobs.length === 0" class="muted banner-empty">{{ tr(L.empty) }}</p>

    <ul v-else>
      <li
        v-for="job in jobs"
        :key="job.id"
        :class="[job.state, { unopenable: !job.sessionId }]"
        :title="job.sessionId ? undefined : tr(L.noSession)"
        @click="open(job)"
      >
        <span class="job-icon">{{ JOB_EMOJI[job.state] }}</span>
        <span class="job-main">
          <span class="job-name">{{ job.name }}</span>
          <span class="job-said">{{ said(job) }}</span>
        </span>
        <span class="job-meta">
          <span class="job-state">{{ tr(JOB_STATE_TEXT[job.state]) }}</span>
          <span class="muted">{{ project(job) }} · {{ formatDate(job.updatedAt) }}</span>
        </span>
      </li>
    </ul>

    <p v-if="jobs.some((job) => job.state === 'stale')" class="muted banner-note">
      💤 {{ tr(L.staleNote) }}
    </p>
  </aside>
</template>
