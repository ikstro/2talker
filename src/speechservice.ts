// The speech engine as a running service: engine/app.py under the Python the
// speech pack installed, on 127.0.0.1:<port>. Started once a part is
// installed, started again when it falls over, stopped with Altype. One
// already answering on the port (run by hand) is used as it is. Every feature
// and every other app (the Chrome extension) speaks to it over HTTP.

import { spawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import type { Bench } from './speechplan'

export const SPEECH_PORT = 8765

const RETRIES = [2, 5, 10, 30] // seconds before each new start; after the last it stays down

export type SpeechServiceState = 'off' | 'starting' | 'ready' | 'down'

export type SpeechTestState = { state: 'idle' | 'waiting' | 'running' | 'done' | 'failed'; done: number; total: number; current: string; message: string; at: string }

/** The engine's /health, as much of it as Altype reads (the optional parts come from engines of 0.2 on). */
export type SpeechHealth = {
  version: string
  device: 'cuda' | 'cpu' | null
  parts: { core: boolean; gpu: boolean; speakers: boolean }
  /** The model each feature has now, from the plan, and where it runs. */
  models: Record<'transcripts' | 'dictation', { name: string; state: 'ready' | 'missing' | 'downloading'; progress?: number; device?: 'cuda' | 'cpu'; compute?: string }>
  /** The models downloaded (catalog names). */
  downloaded?: string[]
  /** The Chrome extension last seen (it pings every 15 min; `seen` is Unix seconds). */
  extension?: { id: string; version: string; seen: number } | null
  /** Why the card is not used though it is there. */
  fallback?: string | null
  /** The speed test. */
  calibration?: SpeechTestState
  bench?: Bench
  /** Where speakers are told apart: on the card when torch's CUDA build is installed. */
  speakersDevice?: 'cuda' | 'cpu'
  diarization: 'ready' | 'missing' | 'needs-token' | 'checking' | 'downloading' | 'bad-token' | 'no-access' | 'failed'
  diarizationMessage: string
  busy: string | null
  queued: number
  dataDir: string
  kbDir: string
}

export type SpeechResult<T = unknown> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string }

export type SpeechServiceOptions = {
  python: () => string
  engineDir: string
  port: number
  log: string
  /** Where Python keeps its compiled files: not in the app's folder, which updates replace. */
  pycache: string
  env?: Record<string, string>
  change: () => void
}

export class SpeechService {
  state: SpeechServiceState = 'off'
  health: SpeechHealth | undefined
  trouble: string | undefined
  private child: ChildProcess | undefined
  private failures = 0
  private timer: NodeJS.Timeout | undefined
  private stopped = true
  private seen = ''

  constructor(private readonly o: SpeechServiceOptions) {}

  get base(): string {
    return `http://127.0.0.1:${this.o.port}`
  }

  async start(): Promise<void> {
    if (!this.stopped) return
    this.stopped = false
    this.failures = 0
    this.set('starting')
    if (!(await this.check())) this.launch()
    clearInterval(this.timer)
    this.timer = setInterval(() => void this.check(), 2000)
  }

  restart(): void {
    this.failures = 0
    this.trouble = undefined
    if (this.child) this.child.kill()
    else if (!this.stopped) this.launch()
    else void this.start()
  }

  stop(): void {
    this.stopped = true
    clearInterval(this.timer)
    this.child?.kill()
    this.child = undefined
    this.health = undefined
    this.set('off')
  }

  private launch(): void {
    const python = this.o.python()
    if (!fs.existsSync(python)) {
      this.set('down', 'The speech engine is not installed')
      return
    }
    this.set('starting')
    fs.mkdirSync(path.dirname(this.o.log), { recursive: true })
    const log = fs.createWriteStream(this.o.log, { flags: 'a' })
    log.write(`\n--- ${new Date().toISOString()} start\n`)
    const child = spawn(python, ['app.py', '--port', String(this.o.port)], {
      cwd: this.o.engineDir,
      env: { ...process.env, ...this.o.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', PYTHONPYCACHEPREFIX: this.o.pycache },
      windowsHide: true,
    })
    child.stdout.pipe(log, { end: false })
    child.stderr.pipe(log, { end: false })
    child.on('error', error => log.write(`--- ${error}\n`))
    child.on('exit', code => {
      log.end(`--- exit ${code}\n`)
      if (this.child === child) this.child = undefined
      if (this.stopped) return
      const wait = RETRIES[this.failures]
      this.failures++
      if (wait === undefined) {
        this.set('down', `The speech engine keeps stopping (${code}): see ${this.o.log}`)
        return
      }
      this.set('starting')
      setTimeout(() => !this.stopped && !this.child && this.launch(), wait * 1000)
    })
    this.child = child
  }

  private async check(): Promise<boolean> {
    try {
      const response = await fetch(`${this.base}/health`, { signal: AbortSignal.timeout(1500) })
      if (!response.ok) throw new Error(String(response.status))
      this.health = (await response.json()) as SpeechHealth
      this.failures = 0
      this.set('ready')
      return true
    } catch {
      if (this.state === 'ready') this.set('starting')
      return false
    }
  }

  private set(state: SpeechServiceState, trouble?: string): void {
    this.state = state
    if (trouble !== undefined || state === 'ready' || state === 'off') this.trouble = trouble
    const now = JSON.stringify([state, this.trouble, this.health])
    if (now === this.seen) return
    this.seen = now
    this.o.change()
  }

  /** One call to the engine: JSON in and out, or bytes in (a recording's chunk, a dictated phrase). */
  async call<T = unknown>(method: string, route: string, body?: unknown): Promise<SpeechResult<T>> {
    const binary = body instanceof Uint8Array
    try {
      const response = await fetch(this.base + route, {
        method,
        headers: body === undefined ? {} : { 'content-type': binary ? 'application/octet-stream' : 'application/json' },
        body: body === undefined ? undefined : binary ? Buffer.from(body) : JSON.stringify(body),
        signal: AbortSignal.timeout(binary ? 120_000 : 30_000),
      })
      const text = await response.text()
      const data = text && /^[[{]/.test(text) ? JSON.parse(text) : text
      if (!response.ok) {
        const detail = typeof data === 'object' && data && 'detail' in data ? String((data as { detail: unknown }).detail) : text
        return { ok: false, status: response.status, error: detail || response.statusText }
      }
      return { ok: true, status: response.status, data: data as T }
    } catch (error) {
      return { ok: false, status: 0, error: this.state === 'ready' ? String(error) : 'The speech engine is not running' }
    }
  }

  dispose(): void {
    this.stop()
  }
}
