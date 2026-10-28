// The speech engine, installed in parts the first time a feature needs one
// (engine/pyproject.toml has the parts as extras):
//   core      speech to text, on the CPU          (Dictate, Transcribe)
//   gpu       the same on an NVIDIA card          (offered when the system has one)
//   speakers  who spoke when                      (Transcribe's speakers, meetings)
// uv, Astral's Python manager, is downloaded once (pinned, SHA-256 checked) and
// installs a Python of its own and the packages into %LOCALAPPDATA%\Altype\speech,
// outside the app's folder, so an update of Altype keeps them. The download
// cache goes when an install is done; the environment stays.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export type SpeechPart = 'core' | 'gpu' | 'speakers'

/** uv 0.13.0 for Windows x64, as Astral publishes it with its .sha256. */
export const UV = {
  version: '0.13.0',
  url: 'https://github.com/astral-sh/uv/releases/download/0.13.0/uv-x86_64-pc-windows-msvc.zip',
  bytes: 15_722_003,
  sha256: '088962f9e7b7bd9ea740c04c650b2a21c8928c345bd99ac24350dc924dba656c',
}

/** What each part downloads, roughly, in MB: what an install costs, and how far it is. */
export const DOWNLOAD_MB = { core: 160, gpu: 1150, speakers: 250, speakersGpu: 3000 }
/** What each part takes on the disk once installed, roughly, in MB (engine/pyproject.toml). */
export const INSTALLED_MB = { core: 330, gpu: 1700, speakers: 900, speakersGpu: 4000 }

export type SpeechPackState = {
  status: 'absent' | 'installing' | 'ready' | 'failed' | 'removing'
  /** Installed now. */
  parts: SpeechPart[]
  /** Being installed (all of them, the installed ones too: uv makes the environment match). */
  installing?: SpeechPart[]
  step?: 'tool' | 'packages'
  /** 0…1 of the step. */
  progress?: number
  message?: string
  /** The system has an NVIDIA card, so the gpu part is worth offering. */
  nvidia: boolean
  /** Where the installed speakers part runs: PyTorch for the card or for the processor. */
  speakersOn?: 'cuda' | 'cpu'
}

/**
 * The extras uv installs for these parts. Speakers on the card carry the CUDA
 * libraries themselves (speakers-gpu, ~4 GB); a card with too little memory for
 * both models keeps Whisper on it and the speakers on the processor (gpu + speakers).
 */
export function extrasFor(parts: SpeechPart[], gpuSpeakers = true): string[] {
  const set = new Set(parts)
  if (set.has('speakers')) {
    if (!set.has('gpu')) return ['speakers']
    return gpuSpeakers ? ['speakers-gpu'] : ['gpu', 'speakers']
  }
  return set.has('gpu') ? ['gpu'] : []
}

/** Where these extras run the speakers: the card, the processor, or nowhere. */
export function speakersOf(extras: readonly string[]): 'cuda' | 'cpu' | undefined {
  if (extras.includes('speakers-gpu')) return 'cuda'
  return extras.includes('speakers') ? 'cpu' : undefined
}

function sizeOf(table: typeof DOWNLOAD_MB, parts: SpeechPart[], gpuSpeakers: boolean): number {
  const extras = extrasFor(parts, gpuSpeakers)
  let mb = table.core
  if (extras.includes('speakers-gpu')) mb += table.speakersGpu
  if (extras.includes('speakers')) mb += table.speakers
  if (extras.includes('gpu')) mb += table.gpu
  return mb
}

/** The download for these parts, in MB. */
export function downloadMb(parts: SpeechPart[], gpuSpeakers = true): number {
  return sizeOf(DOWNLOAD_MB, parts, gpuSpeakers)
}

/** What these parts take on the disk once installed, in MB. */
export function installedMb(parts: SpeechPart[], gpuSpeakers = true): number {
  return sizeOf(INSTALLED_MB, parts, gpuSpeakers)
}

/** Parts in their fixed order, without repeats, core always first. */
export function normalizeParts(parts: SpeechPart[]): SpeechPart[] {
  const set = new Set<SpeechPart>(['core', ...parts])
  return (['core', 'gpu', 'speakers'] as const).filter(p => set.has(p))
}

export type Run = (exe: string, args: string[], env: Record<string, string>) => { exit: Promise<number>; output: () => string }

export type SpeechPackOptions = {
  /** %LOCALAPPDATA%\Altype\speech */
  root: string
  /** The engine's source: app.py, pyproject.toml, uv.lock. */
  engineDir: string
  nvidia: boolean
  /** Speakers go on the card too (it has the memory for both models); else Whisper alone does. */
  gpuSpeakers?: () => boolean
  open: (url: string) => Promise<AsyncIterable<Uint8Array>>
  /**
   * uv's own download cache on this computer (another program's, or a developer's), when there is one: the
   * packages already in it are not downloaded again, and it is left as it is after an install.
   */
  sharedCache?: string
  run?: Run
  onChange: () => void
}

type Marker = { parts: SpeechPart[]; lock: string; extras?: string[] }

export class SpeechPack {
  private status: SpeechPackState['status']
  private installing: SpeechPart[] | undefined
  private step: SpeechPackState['step']
  private progress = 0
  private message: string | undefined
  private running: Promise<void> | undefined

  constructor(private readonly o: SpeechPackOptions) {
    this.status = this.marker() ? 'ready' : 'absent'
  }

  get state(): SpeechPackState {
    const m = this.marker()
    const on = m?.parts.includes('speakers') ? (m.extras ? speakersOf(m.extras) : undefined) ?? 'cpu' : undefined
    return {
      status: this.status,
      parts: m?.parts ?? [],
      ...(on ? { speakersOn: on } : {}),
      ...(this.installing ? { installing: this.installing } : {}),
      ...(this.step ? { step: this.step, progress: this.progress } : {}),
      ...(this.message ? { message: this.message } : {}),
      nvidia: this.o.nvidia,
    }
  }

  get python(): string {
    return path.join(this.o.root, 'env', 'Scripts', 'python.exe')
  }

  get models(): string {
    return path.join(this.o.root, 'models')
  }

  private get uvExe(): string {
    return path.join(this.o.root, 'uv', UV.version, 'uv.exe')
  }

  private marker(): Marker | undefined {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(this.o.root, 'installed.json'), 'utf8')) as Marker
      return Array.isArray(m.parts) && fs.existsSync(this.python) ? m : undefined
    } catch {
      return undefined
    }
  }

  private lockHash(): string {
    try {
      return createHash('sha256').update(fs.readFileSync(path.join(this.o.engineDir, 'uv.lock'))).digest('hex')
    } catch {
      return ''
    }
  }

  /** Altype was updated with other packages for the engine: the same parts are installed again (quick, mostly kept). */
  get stale(): boolean {
    const m = this.marker()
    return !!m && m.lock !== this.lockHash()
  }

  /** Installs these parts (with the ones already there); a second call while one runs waits for it. */
  install(parts: SpeechPart[]): Promise<void> {
    if (this.running) return this.running
    const wanted = normalizeParts([...(this.marker()?.parts ?? []), ...parts])
    // Only a request for the speakers may move them (card or processor); a sync after an update keeps them where they are.
    const extras = this.extras(wanted, parts.includes('speakers'))
    this.running = this.installAll(wanted, extras).finally(() => (this.running = undefined))
    return this.running
  }

  private async installAll(parts: SpeechPart[], extras: string[]): Promise<void> {
    this.installing = parts
    this.message = undefined
    try {
      this.set('installing', 'tool', 0)
      await this.ensureUv()
      this.set('installing', 'packages', 0)
      await this.sync(parts, extras)
      fs.writeFileSync(path.join(this.o.root, 'installed.json'), JSON.stringify({ parts, lock: this.lockHash(), extras } satisfies Marker))
      // Only Altype's own cache goes; a shared one stays as its owner keeps it.
      fs.rmSync(path.join(this.o.root, 'cache'), { recursive: true, force: true })
      this.installing = undefined
      this.set(this.marker() ? 'ready' : 'failed', undefined, 1)
    } catch (error) {
      this.installing = undefined
      this.message = error instanceof Error ? error.message : String(error)
      this.set(this.marker() ? 'ready' : 'failed', undefined, 0)
      throw error
    }
  }

  private async ensureUv(): Promise<void> {
    if (fs.existsSync(this.uvExe)) return
    const dir = path.dirname(this.uvExe)
    fs.mkdirSync(dir, { recursive: true })
    const zip = path.join(dir, 'uv.zip')
    const hash = createHash('sha256')
    let got = 0
    const body = await this.o.open(UV.url)
    await pipeline(
      Readable.from(body),
      new Transform({
        transform: (chunk: Buffer, _encoding, callback) => {
          got += chunk.length
          hash.update(chunk)
          this.tick(got / UV.bytes)
          callback(null, chunk)
        },
      }),
      fs.createWriteStream(zip),
    )
    if (got !== UV.bytes || hash.digest('hex') !== UV.sha256) {
      fs.rmSync(zip, { force: true })
      throw new Error('The Python manager did not arrive whole')
    }
    // Windows' own tar reads zip files.
    const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    const unzip = this.runner(tar, ['-xf', zip, '-C', dir], {})
    if ((await unzip.exit) !== 0 || !fs.existsSync(this.uvExe)) throw new Error(`Could not unpack the Python manager: ${unzip.output()}`)
    fs.rmSync(zip, { force: true })
  }

  /**
   * The extras for these parts: as installed before when the parts are the same (an update keeps them),
   * unless the speakers were asked for and are now wanted elsewhere (card or processor); else as this card can take.
   */
  private extras(parts: SpeechPart[], moveSpeakers = false): string[] {
    const m = this.marker()
    const wanted = extrasFor(parts, this.o.gpuSpeakers?.() ?? true)
    if (m?.extras && m.parts.join() === parts.join() && (!moveSpeakers || speakersOf(m.extras) === speakersOf(wanted))) return m.extras
    return wanted
  }

  private async sync(parts: SpeechPart[], extras: string[]): Promise<void> {
    const root = this.o.root
    const shared = this.o.sharedCache && fs.existsSync(this.o.sharedCache) ? this.o.sharedCache : undefined
    const cache = shared ?? path.join(root, 'cache')
    const env = path.join(root, 'env')
    const args = ['sync', '--frozen', '--no-dev', '--project', this.o.engineDir, '--python', '3.12', ...extras.flatMap(e => ['--extra', e])]
    const job = this.runner(this.uvExe, args, {
      UV_PROJECT_ENVIRONMENT: env,
      UV_PYTHON_INSTALL_DIR: path.join(root, 'python'),
      UV_CACHE_DIR: cache,
      UV_PYTHON_PREFERENCE: 'only-managed',
      UV_NO_PROGRESS: '1',
    })
    // uv shows no numbers when nobody watches it; the download cache growing against the expected size does,
    // or, with a shared cache that is big already, the environment growing towards its installed size.
    const onCard = !extras.includes('speakers') || extras.includes('speakers-gpu')
    const expected = downloadMb(parts, onCard) * 1e6
    const before = shared ? folderBytes(env) : 0
    const target = installedMb(parts, onCard) * 1e6
    const done = () => (shared ? (folderBytes(env) - before) / Math.max(target - before, 1e8) : folderBytes(cache) / expected)
    const timer = setInterval(() => this.tick(Math.max(0, Math.min(0.97, done()))), 1500)
    try {
      const code = await job.exit
      if (code !== 0) throw new Error(`Installing the speech engine failed (${code}): ${job.output().trim().split('\n').slice(-3).join(' ')}`)
    } finally {
      clearInterval(timer)
    }
  }

  /** Everything the engine installed, models too; the space comes back. */
  async remove(): Promise<void> {
    if (this.running) throw new Error('An install is running')
    this.set('removing', undefined, 0)
    for (const name of ['installed.json', 'env', 'python', 'uv', 'cache', 'models', 'pycache']) {
      fs.rmSync(path.join(this.o.root, name), { recursive: true, force: true })
    }
    this.set('absent', undefined, 0)
  }

  /** The environment, the models and what else the engine keeps, in bytes. */
  diskBytes(): number {
    return folderBytes(this.o.root)
  }

  private runner(exe: string, args: string[], env: Record<string, string>): ReturnType<Run> {
    return (this.o.run ?? spawnRun)(exe, args, env)
  }

  private shown = 0

  private tick(progress: number): void {
    // Every whole percent, not every chunk.
    if (Math.abs(progress - this.shown) < 0.01) return
    this.shown = progress
    this.progress = progress
    this.o.onChange()
  }

  private set(status: SpeechPackState['status'], step: SpeechPackState['step'], progress: number): void {
    this.status = status
    this.step = step
    this.progress = progress
    this.shown = progress
    this.o.onChange()
  }
}

function spawnRun(exe: string, args: string[], env: Record<string, string>): ReturnType<Run> {
  const child = spawn(exe, args, { env: { ...process.env, ...env }, windowsHide: true })
  let output = ''
  const keep = (chunk: Buffer) => (output = (output + chunk.toString('utf8')).slice(-4000))
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  return {
    exit: new Promise(resolve => {
      child.on('error', error => (keep(Buffer.from(String(error))), resolve(-1)))
      child.on('close', code => resolve(code ?? -1))
    }),
    output: () => output,
  }
}

/** A folder's size, walked; missing is 0. */
export function folderBytes(dir: string): number {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const here = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(here, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(here, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else {
        try {
          total += fs.statSync(full).size
        } catch {
          // gone meanwhile
        }
      }
    }
  }
  return total
}

/** An NVIDIA card's driver puts nvidia-smi into System32. */
export function hasNvidia(): boolean {
  return fs.existsSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'nvidia-smi.exe'))
}
