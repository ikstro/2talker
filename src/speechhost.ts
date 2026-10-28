// The speech engine as Altype holds it: the installed parts (speechpack.ts),
// the running service (speechservice.ts), this computer (device.ts) with the
// plan of which model runs where (speechplan.ts), and what the app window sees
// of all of it (SpeechView). The service runs once a part is installed;
// installing another part stops it for the time, since Windows will not replace
// the files of a running Python. The plan is made again whenever something it
// depends on changes (the engine's numbers, the downloaded models, the person's
// choices, the computer) and sent to the engine when it differs.

import * as path from 'node:path'

import { driveOf, fingerprint, freeMb, loadProfile, probeDevice, quickProfile, saveProfile, type DeviceProfile } from './device'
import { langCode } from './languages'
import type { SpeechView } from './protocol'
import type { Settings } from './settings'
import { DOWNLOAD_MB, hasNvidia, INSTALLED_MB, SpeechPack, type SpeechPart } from './speechpack'
import { planSpeech, testKey, testRuns, type PlanInput, type SpeechPlan } from './speechplan'
import { SpeechService, type SpeechResult } from './speechservice'

/** "Not now" holds this long at least, even when there is something new to measure. */
const DECLINE_MS = 24 * 3600_000
/** A test run by itself is not run again for the same models sooner than this (one that failed, say). */
const RETEST_MS = 3600_000

export type SpeechHostOptions = {
  /** %LOCALAPPDATA%\Altype\speech: the environment, models, uv. */
  root: string
  /** Altype's own folder (%APPDATA%\Altype): the engine's settings and log, device.json. */
  userDir: string
  engineDir: string
  extensionDir: string
  port: number
  open: (url: string) => Promise<AsyncIterable<Uint8Array>>
  /** A test run gives the engine its own settings folder. */
  testHome?: string
  settings: () => Settings
  onChange: () => void
}

export class SpeechHost {
  readonly pack: SpeechPack
  readonly service: SpeechService
  profile: DeviceProfile
  plan: SpeechPlan
  private input: PlanInput
  private pushed = ''
  private pushing = false
  private autoTested = { key: '', at: 0 }
  private readonly nvidiaDriver = hasNvidia()

  constructor(private readonly o: SpeechHostOptions) {
    this.profile = loadProfile(this.deviceFile) ?? quickProfile()
    this.input = this.inputs()
    this.plan = planSpeech(this.input)
    this.pack = new SpeechPack({
      root: o.root,
      engineDir: o.engineDir,
      nvidia: this.nvidiaDriver,
      gpuSpeakers: () => this.plan.offers.speakersGpu,
      open: o.open,
      onChange: () => this.changed(),
    })
    this.service = new SpeechService({
      python: () => this.pack.python,
      engineDir: o.engineDir,
      port: o.port,
      log: path.join(o.userDir, 'speech.log'),
      pycache: path.join(o.root, 'pycache'),
      env: o.testHome ? { ALTYPE_SPEECH_HOME: o.testHome } : {},
      change: () => this.changed(),
    })
  }

  private get deviceFile(): string {
    return path.join(this.o.userDir, 'device.json')
  }

  /** At Altype's start: the service, when a part is installed; after an update brought other packages, those first. */
  start(): void {
    if (this.pack.state.status !== 'ready') return
    if (this.pack.stale) void this.install([])
    else void this.service.start()
  }

  /** Asks Windows about this computer (a second or two, in the background); a different answer makes the plan again. */
  async probe(): Promise<void> {
    const profile = await probeDevice()
    const changed = fingerprint(profile) !== fingerprint(this.profile) || !this.profile.at
    this.profile = profile
    saveProfile(this.deviceFile, profile)
    if (changed) this.changed()
  }

  get installed(): boolean {
    return this.pack.state.status === 'ready'
  }

  get ready(): boolean {
    return this.service.state === 'ready'
  }

  /** The engine is of 0.2 or later: it takes a plan and runs the speed test. */
  private get planned(): boolean {
    const [major = 0, minor = 0] = (this.service.health?.version ?? '0').split('.').map(Number)
    return this.ready && (major > 0 || minor >= 2)
  }

  private inputs(): PlanInput {
    // Called once before the service exists (the first plan, from the profile alone).
    const h = (this.service as SpeechService | undefined)?.health
    const s = this.o.settings()
    const print = fingerprint(this.profile)
    return {
      profile: this.profile,
      fingerprint: print,
      bench: h?.bench && h.bench.fingerprint === print ? h.bench : undefined,
      cuda: !!h?.parts.gpu && !h.fallback,
      speakersCuda: h?.speakersDevice === 'cuda',
      speakers: !!h?.parts.speakers,
      downloaded: h?.downloaded ?? [],
      native: langCode(s.native),
      prefer: s.speechPrefer,
      pins: { dictation: s.dictationModel, transcripts: s.transcriptsModel },
      ...(h ? { previous: { dictation: h.models.dictation.name, transcripts: h.models.transcripts.name } } : {}),
      nvidiaDriver: this.nvidiaDriver,
    }
  }

  /** Something the plan depends on changed: the plan again, sent to the engine when it differs; the window told. */
  changed(): void {
    this.replan()
    this.o.onChange()
  }

  replan(): void {
    this.input = this.inputs()
    this.plan = planSpeech(this.input)
    if (!this.planned) {
      if (!this.ready) this.pushed = ''
      return
    }
    void this.push()
    this.autoTest()
  }

  private async push(): Promise<void> {
    const plan = JSON.stringify(this.plan.engine)
    if (plan === this.pushed || this.pushing) return
    this.pushing = true
    try {
      const r = await this.call('PUT', '/settings', { plan: this.plan.engine })
      if (r.ok) this.pushed = plan
    } finally {
      this.pushing = false
    }
    // The plan may have moved on while it was being sent.
    if (JSON.stringify(this.plan.engine) !== this.pushed) void this.push()
  }

  private get testing(): boolean {
    const t = this.service.health?.calibration?.state
    return t === 'waiting' || t === 'running'
  }

  /** The person agreed once: what is new (a model downloaded, another card) is measured by itself. */
  private autoTest(): void {
    if (!this.o.settings().speechTestAgreed || this.testing || this.service.health?.busy) return
    const runs = testRuns(this.input, this.plan)
    if (runs.length === 0) return
    const key = testKey(this.input, this.plan)
    if (this.autoTested.key === key && Date.now() - this.autoTested.at < RETEST_MS) return
    this.autoTested = { key, at: Date.now() }
    void this.test()
  }

  /** The speed test of the downloaded models not measured yet (all of them, `again`). */
  async test(again = false): Promise<SpeechResult> {
    const runs = testRuns(this.input, this.plan, again)
    const r = await this.call('POST', '/calibrate', { runs, expected: [this.input.native, 'en'] })
    this.changed()
    return r
  }

  /** The test to offer: the engine can run it, the person has not agreed, something is unmeasured, and "Not now" was not for this. */
  private testView(): SpeechView['test'] {
    const s = this.o.settings()
    const runs = this.planned ? testRuns(this.input, this.plan).length : 0
    const declined = s.speechTestDeclinedKey === testKey(this.input, this.plan) || Date.now() - s.speechTestDeclinedAt < DECLINE_MS
    return { offer: this.planned && !s.speechTestAgreed && runs > 0 && !declined && !this.testing, agreed: s.speechTestAgreed, runs }
  }

  /** What "Not now" remembers. */
  declineKey(): string {
    return testKey(this.input, this.plan)
  }

  downloadModel(model: string): Promise<SpeechResult> {
    return this.call('POST', `/models/${encodeURIComponent(model)}/download`)
  }

  view(keysOk: SpeechView['keysOk']): SpeechView {
    const offers = this.plan.offers
    const gpuPlan = planSpeech({ ...this.input, cuda: true }).dictation.chosen
    const cpuPlan = planSpeech({ ...this.input, cuda: false }).dictation.chosen
    const first = (c: typeof gpuPlan) => ({ model: c.label, mb: c.downloaded ? 0 : c.mb, phrase: c.estimate })
    return {
      pack: { ...this.pack.state, nvidia: offers.gpu || (this.pack.state.parts.includes('gpu') && this.nvidiaDriver) },
      service: this.service.state,
      ...(this.service.trouble ? { trouble: this.service.trouble } : {}),
      ...(this.service.health ? { health: this.service.health } : {}),
      port: this.o.port,
      extensionDir: this.o.extensionDir,
      download: { core: DOWNLOAD_MB.core, gpu: DOWNLOAD_MB.gpu, speakers: offers.speakersGpu ? DOWNLOAD_MB.speakersGpu : DOWNLOAD_MB.speakers },
      installed: { core: INSTALLED_MB.core, gpu: INSTALLED_MB.gpu, speakers: offers.speakersGpu ? INSTALLED_MB.speakersGpu : INSTALLED_MB.speakers },
      firstModel: { cpu: first(cpuPlan), cuda: first(gpuPlan) },
      disk: { freeMb: freeMb(this.o.root), drive: driveOf(this.o.root) },
      device: this.profile,
      plan: this.plan,
      test: this.testView(),
      keysOk,
    }
  }

  /** Installs parts (with the ones there), then starts the service, sends it the plan and has it fetch the dictation model. */
  async install(parts: SpeechPart[]): Promise<void> {
    this.service.stop()
    try {
      await this.pack.install(parts)
    } finally {
      if (this.installed) {
        await this.service.start()
        void this.whenReady().then(async () => {
          this.replan()
          await this.push()
          await this.call('POST', '/dictate/prepare')
        })
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
