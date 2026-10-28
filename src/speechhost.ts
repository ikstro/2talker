// The speech engine as Altype holds it: the installed parts (speechpack.ts),
// the running service (speechservice.ts), and what the app window sees of
// both (SpeechView). The service runs once a part is installed; installing
// another part stops it for the time, since Windows will not replace the
// files of a running Python.

import * as path from 'node:path'

import type { SpeechView } from './protocol'
import { DOWNLOAD_MB, hasNvidia, SpeechPack, type SpeechPart } from './speechpack'
import { SpeechService, type SpeechResult } from './speechservice'

export type SpeechHostOptions = {
  /** %LOCALAPPDATA%\Altype\speech: the environment, models, uv. */
  root: string
  /** Altype's own folder (%APPDATA%\Altype): the engine's settings and log. */
  userDir: string
  engineDir: string
  extensionDir: string
  port: number
  open: (url: string) => Promise<AsyncIterable<Uint8Array>>
  /** A test run gives the engine its own settings folder. */
  testHome?: string
  onChange: () => void
}

export class SpeechHost {
  readonly pack: SpeechPack
  readonly service: SpeechService

  constructor(private readonly o: SpeechHostOptions) {
    this.pack = new SpeechPack({ root: o.root, engineDir: o.engineDir, nvidia: hasNvidia(), open: o.open, onChange: o.onChange })
    this.service = new SpeechService({
      python: () => this.pack.python,
      engineDir: o.engineDir,
      port: o.port,
      log: path.join(o.userDir, 'speech.log'),
      pycache: path.join(o.root, 'pycache'),
      env: o.testHome ? { ALTYPE_SPEECH_HOME: o.testHome } : {},
      change: o.onChange,
    })
  }

  /** At Altype's start: the service, when a part is installed; after an update brought other packages, those first. */
  start(): void {
    if (this.pack.state.status !== 'ready') return
    if (this.pack.stale) void this.install([])
    else void this.service.start()
  }

  get installed(): boolean {
    return this.pack.state.status === 'ready'
  }

  get ready(): boolean {
    return this.service.state === 'ready'
  }

  view(keysOk: SpeechView['keysOk']): SpeechView {
    return {
      pack: this.pack.state,
      service: this.service.state,
      ...(this.service.trouble ? { trouble: this.service.trouble } : {}),
      ...(this.service.health ? { health: this.service.health } : {}),
      port: this.o.port,
      extensionDir: this.o.extensionDir,
      download: { core: DOWNLOAD_MB.core, gpu: DOWNLOAD_MB.gpu, speakers: this.pack.state.nvidia ? DOWNLOAD_MB.speakersGpu : DOWNLOAD_MB.speakers },
      keysOk,
    }
  }

  /** Installs parts (with the ones there), then starts the service and has it fetch the dictation model. */
  async install(parts: SpeechPart[]): Promise<void> {
    this.service.stop()
    try {
      await this.pack.install(parts)
    } finally {
      if (this.installed) {
        await this.service.start()
        void this.whenReady().then(() => this.call('POST', '/dictate/prepare'))
      }
    }
  }

  async remove(): Promise<void> {
    this.service.stop()
    await this.pack.remove()
  }

  restart(): void {
    if (this.installed) this.service.restart()
  }

  call<T = unknown>(method: string, route: string, body?: unknown): Promise<SpeechResult<T>> {
    return this.service.call<T>(method, route, body)
  }

  /** Resolves once the service answers, or after `ms` regardless. */
  async whenReady(ms = 60_000): Promise<boolean> {
    const until = Date.now() + ms
    while (!this.ready && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 300))
    return this.ready
  }

  dispose(): void {
    this.service.dispose()
  }
}
