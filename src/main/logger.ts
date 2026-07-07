import { app, shell } from 'electron'
import { join } from 'node:path'
import { createWriteStream, mkdirSync, existsSync, type WriteStream } from 'node:fs'

/**
 * Structured JSONL session logger for Trundler (this app — not trundler-mcp).
 *
 * Captures the full interaction: user prompts, the model in use, each MCP tool
 * call and its result, cart state, and errors. One file per app run under the
 * app's userData/logs directory, plus a concise console mirror.
 *
 * Enabled automatically in dev (unpackaged), or in production via `--debug` /
 * TRUNDLER_DEBUG=1 so a user can capture and send logs.
 */
export class Logger {
  enabled: boolean
  filePath = ''
  readonly sessionId: string
  private stream: WriteStream | null = null
  private seq = 0

  constructor(enabled: boolean) {
    this.enabled = enabled
    this.sessionId = new Date().toISOString().replace(/[:.]/g, '-')
    if (enabled) this.open()
  }

  private open(): void {
    try {
      const dir = join(app.getPath('userData'), 'logs')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      this.filePath = join(dir, `trundler-${this.sessionId}.log`)
      this.stream = createWriteStream(this.filePath, { flags: 'a' })
      console.log(`[trundler] debug logging → ${this.filePath}`)
    } catch (err) {
      console.error('[logger] failed to open log file:', err)
      this.enabled = false
    }
  }

  event(type: string, data: Record<string, unknown> = {}): void {
    if (!this.enabled) return
    const record = {
      t: new Date().toISOString(),
      seq: ++this.seq,
      session: this.sessionId,
      type,
      ...(truncateDeep(data) as Record<string, unknown>)
    }
    try {
      this.stream?.write(`${JSON.stringify(record)}\n`)
    } catch (err) {
      console.error('[logger] write failed:', err)
    }
    console.log(`[log] ${type} ${consolePreview(data)}`)
  }

  /** Turn logging on/off at runtime (from the Settings toggle). */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return
    this.enabled = on
    if (on) {
      if (!this.stream) this.open()
    } else {
      this.close()
    }
  }

  info(): { enabled: boolean; path: string } {
    return { enabled: this.enabled, path: this.filePath }
  }

  openFolder(): void {
    if (this.filePath) shell.showItemInFolder(this.filePath)
  }

  close(): void {
    try {
      this.stream?.end()
    } catch {
      /* ignore */
    }
    this.stream = null
  }
}

/** Whether a CLI flag / env var forces logging on regardless of the setting.
 *  (The normal control is the Settings toggle → config.debugLogging.) */
export function forcedDebug(): boolean {
  return process.argv.includes('--debug') || process.env.TRUNDLER_DEBUG === '1'
}

const MAX_STRING = 2000
const MAX_ARRAY = 60
const MAX_DEPTH = 8

/** Clamp large strings/arrays so a single result can't bloat the log. */
function truncateDeep(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '…(max depth)'
  if (typeof value === 'string') {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}…(+${value.length - MAX_STRING} chars)`
      : value
  }
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map((v) => truncateDeep(v, depth + 1))
    if (value.length > MAX_ARRAY) out.push(`…(+${value.length - MAX_ARRAY} more)`)
    return out
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = truncateDeep(v, depth + 1)
    return out
  }
  return value
}

function consolePreview(data: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(data)) {
    if (v == null) continue
    if (typeof v === 'string') parts.push(`${k}=${v.length > 60 ? `${v.slice(0, 60)}…` : v}`)
    else if (typeof v === 'object') parts.push(`${k}={…}`)
    else parts.push(`${k}=${v}`)
    if (parts.length >= 4) break
  }
  return parts.join(' ')
}
