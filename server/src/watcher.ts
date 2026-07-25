import { EventEmitter } from 'node:events'
import { watch } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { PROJECTS_DIR } from './config.js'
import { tailLines } from './lines.js'

/**
 * Lectura incremental de los transcripts. Mismo patrón que usa Claude Code para sus
 * propios jobs (el campo `linkScanOffset` de ~/.claude/jobs/<id>/state.json): se guarda
 * el offset en bytes por fichero y solo se lee lo nuevo.
 *
 * Nunca se carga un fichero entero en memoria: el mayor transcript de esta máquina son
 * 11,6 MB con líneas de hasta 715 KB.
 */

interface FileState {
  offset: number
  /** Última línea incompleta, pendiente de que llegue su '\n'. */
  partial: string
  /** Evita lecturas solapadas del mismo fichero. */
  reading: boolean
  /** Hubo cambios mientras leíamos: hay que releer al terminar. */
  dirty: boolean
}

export interface LinesEvent {
  path: string
  lines: string[]
}

export class TranscriptWatcher extends EventEmitter {
  private files = new Map<string, FileState>()
  private watcher?: ReturnType<typeof watch>
  private debounces = new Map<string, NodeJS.Timeout>()

  start(): void {
    try {
      this.watcher = watch(PROJECTS_DIR, { recursive: true }, (_event, filename) => {
        if (!filename) return
        const rel = filename.toString()
        if (!rel.endsWith('.jsonl')) return
        this.schedule(join(PROJECTS_DIR, rel))
      })
      this.watcher.on('error', (err) => this.emit('warn', `watch: ${String(err)}`))
    } catch (err) {
      this.emit('warn', `no se pudo vigilar ${PROJECTS_DIR}: ${String(err)}`)
    }
  }

  stop(): void {
    this.watcher?.close()
    for (const timer of this.debounces.values()) clearTimeout(timer)
    this.debounces.clear()
  }

  /** Marca un fichero como ya visto: solo se emitirá lo que se escriba a partir de ahora. */
  async prime(path: string): Promise<void> {
    if (this.files.has(path)) return
    let size = 0
    try {
      size = (await stat(path)).size
    } catch {
      size = 0
    }
    this.files.set(path, { offset: size, partial: '', reading: false, dirty: false })
  }

  /** Empieza a seguir un fichero desde el principio (para replay o ficheros nuevos). */
  async follow(path: string): Promise<void> {
    if (!this.files.has(path)) {
      this.files.set(path, { offset: 0, partial: '', reading: false, dirty: false })
    }
    await this.pump(path)
  }

  isTracked(path: string): boolean {
    return this.files.has(path)
  }

  forget(path: string): void {
    this.files.delete(path)
    const timer = this.debounces.get(path)
    if (timer) {
      clearTimeout(timer)
      this.debounces.delete(path)
    }
  }

  /**
   * Últimas `maxLines` líneas completas de un fichero, leyendo solo su cola.
   * Sirve para que el mundo no arranque vacío con una sesión ya en marcha.
   */
  async tail(path: string, maxLines: number): Promise<string[]> {
    return tailLines(path, maxLines)
  }

  private schedule(path: string): void {
    const existing = this.debounces.get(path)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.debounces.delete(path)
      void this.pump(path)
    }, 60)
    this.debounces.set(path, timer)
  }

  private async pump(path: string): Promise<void> {
    let state = this.files.get(path)
    if (!state) {
      // Fichero nuevo (sesión recién abierta o subagente recién nacido): se sigue entero.
      state = { offset: 0, partial: '', reading: false, dirty: false }
      this.files.set(path, state)
      this.emit('newfile', path)
    }
    if (state.reading) {
      state.dirty = true
      return
    }
    state.reading = true
    try {
      do {
        state.dirty = false
        await this.readNew(path, state)
      } while (state.dirty)
    } finally {
      state.reading = false
    }
  }

  private async readNew(path: string, state: FileState): Promise<void> {
    let handle
    try {
      handle = await open(path, 'r')
      const { size } = await handle.stat()
      if (size < state.offset) {
        // El fichero se truncó o se recreó: volvemos a empezar.
        state.offset = 0
        state.partial = ''
      }
      if (size === state.offset) return

      const length = size - state.offset
      const buffer = Buffer.allocUnsafe(length)
      const { bytesRead } = await handle.read(buffer, 0, length, state.offset)
      state.offset += bytesRead

      const chunk = state.partial + buffer.subarray(0, bytesRead).toString('utf8')
      const parts = chunk.split('\n')
      state.partial = parts.pop() ?? ''
      const lines = parts.filter((l) => l.trim().length > 0)
      if (lines.length > 0) this.emit('lines', { path, lines } satisfies LinesEvent)
    } catch (err) {
      this.emit('warn', `lectura de ${path}: ${String(err)}`)
    } finally {
      await handle?.close()
    }
  }
}
