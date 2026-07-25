import { createReadStream } from 'node:fs'
import { open } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { TAIL_BYTES } from './config.js'

/** Primeras `maxLines` líneas no vacías, sin leer más de lo necesario. */
export async function headLines(path: string, maxLines: number): Promise<string[]> {
  const out: string[] = []
  const stream = createReadStream(path, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      if (line.trim().length === 0) continue
      out.push(line)
      if (out.length >= maxLines) break
    }
  } catch {
    // fichero ilegible: se devuelve lo que haya
  } finally {
    rl.close()
    stream.destroy()
  }
  return out
}

/**
 * Últimas `maxLines` líneas completas leyendo solo la cola del fichero.
 * Con transcripts de 11 MB esto evita recorrerlo entero.
 */
export async function tailLines(
  path: string,
  maxLines: number,
  maxBytes = TAIL_BYTES,
): Promise<string[]> {
  let handle
  try {
    handle = await open(path, 'r')
    const { size } = await handle.stat()
    const start = Math.max(0, size - maxBytes)
    const length = size - start
    if (length <= 0) return []
    const buffer = Buffer.allocUnsafe(length)
    await handle.read(buffer, 0, length, start)
    const lines = buffer.toString('utf8').split('\n').filter((l) => l.trim().length > 0)
    // Si se recortó por el principio, la primera línea puede venir partida.
    if (start > 0 && lines.length > 0) lines.shift()
    return lines.slice(-maxLines)
  } catch {
    return []
  } finally {
    await handle?.close()
  }
}

/** Recorre un fichero línea a línea sin cargarlo en memoria. */
export async function forEachLine(
  path: string,
  visit: (line: string) => boolean | void,
): Promise<void> {
  const stream = createReadStream(path, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      if (line.trim().length === 0) continue
      if (visit(line) === false) break
    }
  } finally {
    rl.close()
    stream.destroy()
  }
}
