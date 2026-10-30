// The accurate translators: Google's TranslateGemma, 4B for Accurate and 12B
// for Most accurate (GGUF, Q4_K_M), run by llama.cpp's server (llama.ts). The
// person picks a level on the Translate page; nothing is downloaded before.
// The engine is llama.cpp's Vulkan build (any graphics card, or the
// processor), or its CUDA build for a model that does not fit an NVIDIA card
// (`engineFor`; hardware.ts translationAdvice), each unpacked once into
// <root>\engine\<build>-<sha256 head> and shared by both levels; the models are
// <root>\models\<sha256 head>-<file>. All pinned with size and SHA-256 in
// llm-manifest.json. Unlike Firefox's models they translate between any two
// of their languages directly, one request per sentence, four at a time.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { fetchPinned, openStream, unzip, type Pinned } from './download'
import { LlamaServer } from './llama'
import manifest from './llm-manifest.json'
import type { Translator, TranslatorState } from './translator'

export type LlmLevel = 'accurate' | 'most'
export type LlmEngine = 'vulkan' | 'cuda'

type Build = { name: string; files: Pinned[] }
type Model = Pinned & { name: string; file: string }
export type LlmManifest = { engine: Record<LlmEngine, Build>; models: Record<LlmLevel, Model>; languages: Record<string, string> }

const MANIFEST = manifest as LlmManifest
const LEVELS: readonly LlmLevel[] = ['accurate', 'most']
const ENGINES: readonly LlmEngine[] = ['vulkan', 'cuda']

/** The model of each level, and how it is named. */
export const LLM_MODELS: Readonly<Record<LlmLevel, Model>> = MANIFEST.models
/** TranslateGemma's names of the languages it translates, by code. */
export const LLM_LANGUAGES: Readonly<Record<string, string>> = MANIFEST.languages

const PARALLEL = 4
/** A sentence on the processor with the 12B model may take minutes. */
const REQUEST_MS = 10 * 60_000

/** Where the engines and the models are kept under `root`. */
export function llmPaths(root: string, m: LlmManifest = MANIFEST) {
  const engineDir = (kind: LlmEngine) => path.join(root, 'engine', `${kind}-${m.engine[kind].files[0]?.sha256.slice(0, 12)}`)
  return {
    engineDir,
    exe: (kind: LlmEngine) => path.join(engineDir(kind), 'llama-server.exe'),
    model: (level: LlmLevel) => path.join(root, 'models', `${m.models[level].sha256.slice(0, 12)}-${m.models[level].file}`),
  }
}

/** TranslateGemma's prompt for one text, as its chat template writes it. */
export function promptFor(text: string, from: string, to: string): string {
  const s = LLM_LANGUAGES[from]
  const g = LLM_LANGUAGES[to]
  return (
    `<start_of_turn>user\nYou are a professional ${s} (${from}) to ${g} (${to}) translator. Your goal is to accurately convey the meaning and nuances of the original ${s} text while adhering to ${g} grammar, vocabulary, and cultural sensitivities.\n` +
    `Produce only the ${g} translation, without any additional explanations or commentary. Please translate the following ${s} text into ${g}:\n\n\n${text.trim()}<end_of_turn>\n<start_of_turn>model\n`
  )
}

/** `work` over every item, at most `limit` at a time, results in order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const lane = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await work(items[i] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
  return out
}

export type LlmOptions = {
  root: string
  log: string
  /** The build a level runs on here; Vulkan when not given. */
  engineFor?: (level: LlmLevel) => LlmEngine
  open?: (url: string) => Promise<AsyncIterable<Uint8Array>>
  /** Made here when not given (tests give their own). */
  server?: LlamaServer
  fetch?: typeof fetch
  /** What to download (tests give small files of their own). */
  manifest?: LlmManifest
  /** A translation done: seconds a sentence, and the seconds it waited for the model to load, when it did. */
  onTimed?: (level: LlmLevel, timed: { sentence: number; start?: number }) => void
}

export type LlmTranslators = Record<LlmLevel, Translator> & {
  /** Deletes a level's model (an engine too once no model left needs it); its server is stopped and gone first, as Windows keeps a file in use. */
  remove(level: LlmLevel): Promise<void>
  dispose(): void
}

/** Deleted, tried again for a moment while Windows still holds it (a process just ended). */
function removePath(target: string): void {
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}

export function createLlmTranslators(o: LlmOptions): LlmTranslators {
  const { engine: builds, models, languages } = o.manifest ?? MANIFEST
  const paths = llmPaths(o.root, o.manifest)
  const server = o.server ?? new LlamaServer({ log: o.log })
  const open = o.open ?? openStream
  const post = o.fetch ?? fetch
  const engineFor = o.engineFor ?? (() => 'vulkan')

  const buildSize = (kind: LlmEngine) => builds[kind].files.reduce((n, f) => n + f.size, 0)
  const hasEngine = (kind: LlmEngine) => fs.existsSync(paths.exe(kind))
  const hasModel = (level: LlmLevel) => {
    try {
      return fs.statSync(paths.model(level)).size === models[level].size
    } catch {
      return false
    }
  }

  /** Each engine's download while it runs (both levels may wait for it), and its bytes so far. */
  const engineRunning = new Map<LlmEngine, Promise<void>>()
  const engineGot = new Map<LlmEngine, number>()
  /** A level's download: its model's bytes so far, out of `total` (the engine's in it when it was missing too). */
  const downloads = new Map<LlmLevel, { got: number; total: number; engine?: LlmEngine; running: Promise<void> }>()
  const failed = new Set<LlmLevel>()

  /** What a level still has to download here, in bytes. */
  const missing = (level: LlmLevel) => (hasEngine(engineFor(level)) ? 0 : buildSize(engineFor(level))) + (hasModel(level) ? 0 : models[level].size)

  function state(level: LlmLevel, native: string): TranslatorState {
    if (!languages[native]) return { status: 'unsupported', progress: 0, size: 0 }
    const download = downloads.get(level)
    if (download) {
      const kind = download.engine
      const engine = kind ? (hasEngine(kind) ? buildSize(kind) : (engineGot.get(kind) ?? 0)) : 0
      return { status: 'downloading', progress: Math.min(1, (engine + download.got) / download.total), size: Math.round(download.total / 1e6) }
    }
    if (hasEngine(engineFor(level)) && hasModel(level)) return { status: 'ready', progress: 1, size: Math.round(models[level].size / 1e6) }
    return { status: failed.has(level) ? 'failed' : 'absent', progress: 0, size: Math.round(missing(level) / 1e6) }
  }

  /** An engine: downloaded once (its zips one after another), unpacked beside a folder of an older build of its kind, which then goes. */
  function ensureEngine(kind: LlmEngine, onBytes: () => void): Promise<void> {
    if (hasEngine(kind)) return Promise.resolve()
    const running = engineRunning.get(kind)
    if (running) return running
    const job = (async () => {
      const base = path.join(o.root, 'engine')
      const dir = paths.engineDir(kind)
      const unpacking = `${dir}.part`
      fs.mkdirSync(base, { recursive: true })
      fs.rmSync(unpacking, { recursive: true, force: true })
      let done = 0
      for (const [i, file] of builds[kind].files.entries()) {
        const zip = path.join(base, `${path.basename(dir)}.${i}.zip`)
        await fetchPinned(file, zip, 'The translation engine', got => {
          engineGot.set(kind, done + got)
          onBytes()
        }, open)
        done += file.size
        await unzip(zip, unpacking)
        fs.rmSync(zip, { force: true })
      }
      if (!fs.existsSync(path.join(unpacking, 'llama-server.exe'))) throw new Error('The translation engine came without its server')
      fs.renameSync(unpacking, dir)
      for (const name of fs.readdirSync(base)) if (name.startsWith(`${kind}-`) && name !== path.basename(dir)) fs.rmSync(path.join(base, name), { recursive: true, force: true })
    })().finally(() => {
      engineRunning.delete(kind)
      engineGot.delete(kind)
    })
    engineRunning.set(kind, job)
    return job
  }

  function prepare(level: LlmLevel, native: string, onProgress: (state: TranslatorState) => void): Promise<void> {
    const s = state(level, native)
    if (s.status === 'unsupported') return Promise.reject(new Error(`${models[level].name} does not translate this language`))
    if (s.status === 'ready') return Promise.resolve()
    const existing = downloads.get(level)
    if (existing) return existing.running
    let shown = 0
    const tick = () => {
      const now = state(level, native)
      // Every whole percent, not every chunk.
      if (now.progress - shown < 0.01) return
      shown = now.progress
      onProgress(now)
    }
    const kind = engineFor(level)
    const entry = { got: 0, total: Math.max(1, missing(level)), ...(hasEngine(kind) ? {} : { engine: kind }), running: Promise.resolve() }
    entry.running = (async () => {
      await ensureEngine(kind, tick)
      if (hasModel(level)) return
      fs.mkdirSync(path.join(o.root, 'models'), { recursive: true })
      await fetchPinned(models[level], paths.model(level), models[level].name, got => {
        entry.got = got
        tick()
      }, open)
    })()
      .then(() => {
        failed.delete(level)
      })
      .catch(error => {
        failed.add(level)
        throw error
      })
      .finally(() => downloads.delete(level))
    downloads.set(level, entry)
    onProgress(state(level, native))
    return entry.running
  }

  async function one(base: string, text: string, from: string, to: string): Promise<string | undefined> {
    if (!text.trim()) return text
    const response = await post(`${base}/completion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // A translation is rarely longer in tokens than its source in letters; the cap stops a model that repeats itself.
      // No prompt cache: llama.cpp keeps none for Gemma's sliding-window layers (measured: every sentence's instructions read again).
      body: JSON.stringify({ prompt: promptFor(text, from, to), n_predict: Math.min(2048, 64 + text.length), temperature: 0, cache_prompt: false, stop: ['<end_of_turn>'] }),
      signal: AbortSignal.timeout(REQUEST_MS),
    })
    if (!response.ok) throw new Error(`The translation engine answered ${response.status}`)
    const data = (await response.json()) as { content?: unknown }
    return typeof data.content === 'string' ? data.content.trim() || undefined : undefined
  }

  function translator(level: LlmLevel): Translator {
    return {
      direct: true,
      state: native => state(level, native),
      prepare: (native, onProgress) => prepare(level, native, onProgress),
      async translate(sentences, from, to) {
        const unknown = [from, to].find(code => !languages[code])
        if (unknown) throw new Error(`${models[level].name} does not translate this language (${unknown})`)
        if (sentences.length === 0) return []
        const kind = engineFor(level)
        if (!hasEngine(kind) || !hasModel(level)) throw new Error(`${models[level].name} is not downloaded yet`)
        const target = { exe: paths.exe(kind), model: paths.model(level), allLayers: kind === 'cuda' }
        const began = Date.now()
        return server.run(target, async (base, loaded) => {
          const ready = Date.now()
          const out = await mapLimit(sentences, PARALLEL, s => one(base, s, from, to))
          const counted = sentences.filter(s => s.trim()).length
          if (counted > 0) o.onTimed?.(level, { sentence: (Date.now() - ready) / 1000 / counted, ...(loaded ? { start: (ready - began) / 1000 } : {}) })
          return out
        })
      },
      dispose: () => server.dispose(),
    }
  }

  return {
    accurate: translator('accurate'),
    most: translator('most'),
    async remove(level) {
      if (downloads.has(level)) return
      if (server.model === paths.model(level)) await server.stop()
      removePath(paths.model(level))
      failed.delete(level)
      // An engine no model left here needs goes too.
      for (const kind of ENGINES) {
        if (engineRunning.has(kind) || LEVELS.some(l => hasModel(l) && engineFor(l) === kind)) continue
        if (server.exe === paths.exe(kind)) await server.stop()
        removePath(paths.engineDir(kind))
      }
    },
    dispose: () => server.dispose(),
  }
}
