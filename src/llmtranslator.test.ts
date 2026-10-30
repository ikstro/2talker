import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LlamaServer, LlamaTarget } from './llama'
import { createLlmTranslators, llmPaths, promptFor, type LlmEngine, type LlmLevel, type LlmManifest } from './llmtranslator'

const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')

describe('promptFor', () => {
  it('writes TranslateGemma chat template, by the languages names', () => {
    expect(promptFor('  Кнопки сундука и молнии поменять местами. ', 'ru', 'en')).toBe(
      '<start_of_turn>user\nYou are a professional Russian (ru) to English (en) translator. Your goal is to accurately convey the meaning and nuances of the original Russian text while adhering to English grammar, vocabulary, and cultural sensitivities.\n' +
        'Produce only the English translation, without any additional explanations or commentary. Please translate the following Russian text into English:\n\n\nКнопки сундука и молнии поменять местами.<end_of_turn>\n<start_of_turn>model\n',
    )
    expect(promptFor('Hej', 'nb', 'uk')).toContain('Norwegian Bokmål (nb) to Ukrainian (uk)')
  })
})

describe('createLlmTranslators', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true })))

  /** A zip of these files, made by Windows' tar. */
  function zipOf(dir: string, name: string, files: Record<string, string>): Buffer {
    const from = path.join(dir, name)
    fs.mkdirSync(from)
    for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(from, file), text)
    const zip = path.join(dir, `${name}.zip`)
    execFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-cf', zip, '-C', from, ...Object.keys(files)])
    return fs.readFileSync(zip)
  }

  /** Both builds as zips (CUDA's in two, as llama.cpp publishes it), two small models, the fake web serving them; Most accurate on CUDA. */
  function setup(engineFor: (level: LlmLevel) => LlmEngine = level => (level === 'most' ? 'cuda' : 'vulkan')) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-'))
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-src-'))
    dirs.push(root, src)
    const vulkan = zipOf(src, 'vulkan', { 'llama-server.exe': 'vulkan server', 'ggml-vulkan.dll': 'v' })
    const cuda = zipOf(src, 'cuda', { 'llama-server.exe': 'cuda server', 'ggml-cuda.dll': 'c' })
    const cudart = zipOf(src, 'cudart', { 'cudart64_12.dll': 'rt' })
    const small = Buffer.from('small model'.repeat(100))
    const big = Buffer.from('big model'.repeat(300))
    const web: Record<string, Buffer> = { 'https://x/vulkan.zip': vulkan, 'https://x/cuda.zip': cuda, 'https://x/cudart.zip': cudart, 'https://x/small.gguf': small, 'https://x/big.gguf': big }
    const pinned = (url: string) => ({ url, size: web[url]!.length, sha256: sha(web[url]!) })
    const manifest: LlmManifest = {
      engine: {
        vulkan: { name: 'vulkan', files: [pinned('https://x/vulkan.zip')] },
        cuda: { name: 'cuda', files: [pinned('https://x/cuda.zip'), pinned('https://x/cudart.zip')] },
      },
      models: {
        accurate: { name: 'TranslateGemma 4B', file: 'small.gguf', ...pinned('https://x/small.gguf') },
        most: { name: 'TranslateGemma 12B', file: 'big.gguf', ...pinned('https://x/big.gguf') },
      },
      languages: { en: 'English', ru: 'Russian', uk: 'Ukrainian' },
    }
    const open = vi.fn(async (url: string) => (async function* () {
      const body = web[url]
      if (!body) throw new Error('HTTP 404')
      for (let i = 0; i < body.length; i += 512) yield new Uint8Array(body.subarray(i, i + 512))
    })())
    const asked: { target: LlamaTarget; prompt: string }[] = []
    let serving: LlamaTarget | undefined
    const server = {
      get model() {
        return serving?.model
      },
      get exe() {
        return serving?.exe
      },
      run: vi.fn(async (target: LlamaTarget, job: (base: string, loaded: boolean) => Promise<unknown>) => {
        const loaded = serving?.model !== target.model
        serving = target
        return job('http://127.0.0.1:9001', loaded)
      }),
      stop: vi.fn(() => (serving = undefined)),
      dispose: vi.fn(),
    }
    const post = vi.fn(async (_url: string, init: RequestInit) => {
      const { prompt } = JSON.parse(String(init.body)) as { prompt: string }
      asked.push({ target: serving!, prompt })
      const text = prompt.split('\n\n\n')[1]?.split('<end_of_turn>')[0] ?? ''
      return new Response(JSON.stringify({ content: ` [${text}]\n` }), { status: 200 })
    })
    const timed: { level: LlmLevel; sentence: number; start?: number }[] = []
    const onTimed = (level: LlmLevel, t: { sentence: number; start?: number }) => timed.push({ level, ...t })
    const llm = createLlmTranslators({ root, log: path.join(root, 'llama.log'), open, manifest, engineFor, server: server as unknown as LlamaServer, fetch: post as unknown as typeof fetch, onTimed })
    return { root, llm, open, server, asked, timed, manifest, paths: llmPaths(root, manifest) }
  }

  it('is absent until picked, downloads the engine and the model, then translates directly', async () => {
    const { llm, open, asked, timed, paths } = setup(() => 'vulkan')
    expect(llm.accurate.direct).toBe(true)
    expect(llm.accurate.state('ru')).toMatchObject({ status: 'absent' })
    expect(llm.accurate.state('ja')).toMatchObject({ status: 'unsupported' })
    const seen: number[] = []
    await llm.accurate.prepare('ru', s => seen.push(s.progress))
    expect(llm.accurate.state('ru')).toMatchObject({ status: 'ready', progress: 1 })
    expect(seen[0]).toBe(0)
    expect(seen.at(-1)).toBeGreaterThan(0.95)
    expect(fs.readFileSync(paths.exe('vulkan'), 'utf8')).toBe('vulkan server')
    // Most accurate on the same build needs only its own model now.
    await llm.most.prepare('ru', () => undefined)
    expect(open.mock.calls.map(c => c[0])).toEqual(['https://x/vulkan.zip', 'https://x/small.gguf', 'https://x/big.gguf'])

    const out = await llm.accurate.translate(['Привет.', '', 'Как дела?'], 'ru', 'uk')
    expect(out).toEqual(['[Привет.]', '', '[Как дела?]'])
    expect(asked).toHaveLength(2)
    expect(asked[0]?.target).toEqual({ exe: paths.exe('vulkan'), model: paths.model('accurate'), allLayers: false })
    expect(asked[0]?.prompt).toContain('Russian (ru) to Ukrainian (uk)')
    // Timed by its two sentences; the first waited for the model to load, the next did not.
    await llm.accurate.translate(['Да.'], 'ru', 'en')
    expect(timed.map(t => [t.level, t.start !== undefined])).toEqual([
      ['accurate', true],
      ['accurate', false],
    ])
    expect(timed[0]?.sentence).toBeGreaterThanOrEqual(0)
  })

  it('a level on CUDA downloads its two zips into one folder and runs every layer on the card', async () => {
    const { llm, open, asked, paths } = setup()
    expect(llm.most.state('ru')).toMatchObject({ status: 'absent' })
    await llm.most.prepare('ru', () => undefined)
    expect(open.mock.calls.map(c => c[0])).toEqual(['https://x/cuda.zip', 'https://x/cudart.zip', 'https://x/big.gguf'])
    expect(fs.readdirSync(paths.engineDir('cuda')).sort()).toEqual(['cudart64_12.dll', 'ggml-cuda.dll', 'llama-server.exe'])
    // Accurate stays on Vulkan: its build is still to come.
    expect(llm.accurate.state('ru')).toMatchObject({ status: 'absent' })
    await llm.most.translate(['Hi.'], 'en', 'ru')
    expect(asked[0]?.target).toEqual({ exe: paths.exe('cuda'), model: paths.model('most'), allLayers: true })
  })

  it('downloads once when asked twice, and says a broken download failed', async () => {
    const { llm, open, manifest } = setup()
    await Promise.all([llm.accurate.prepare('ru', () => undefined), llm.accurate.prepare('uk', () => undefined)])
    expect(open).toHaveBeenCalledTimes(2)
    manifest.models.most.sha256 = '0'.repeat(64)
    await expect(llm.most.prepare('ru', () => undefined)).rejects.toThrow('TranslateGemma 12B did not arrive whole')
    expect(llm.most.state('ru')).toMatchObject({ status: 'failed' })
  })

  it('refuses before its files are here, and a language it does not know', async () => {
    const { llm } = setup()
    await expect(llm.accurate.translate(['Hi.'], 'en', 'ru')).rejects.toThrow('not downloaded yet')
    await llm.accurate.prepare('ru', () => undefined)
    await expect(llm.accurate.translate(['Hi.'], 'en', 'ja')).rejects.toThrow('does not translate this language (ja)')
  })

  it('removes a model with its server stopped, and each engine once no model left needs it', async () => {
    const { llm, server, paths } = setup()
    await llm.accurate.prepare('ru', () => undefined)
    await llm.most.prepare('ru', () => undefined)
    await llm.most.translate(['Hi.'], 'en', 'ru')
    await llm.remove('most')
    expect(server.stop).toHaveBeenCalled()
    expect(llm.most.state('ru')).toMatchObject({ status: 'absent' })
    expect(fs.existsSync(paths.engineDir('cuda'))).toBe(false)
    expect(llm.accurate.state('ru')).toMatchObject({ status: 'ready' })
    await llm.remove('accurate')
    expect(fs.existsSync(paths.engineDir('vulkan'))).toBe(false)
  })
})
