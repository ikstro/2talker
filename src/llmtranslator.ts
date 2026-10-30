// The accurate translators: Google's TranslateGemma, 4B for Accurate and 12B
// for Most accurate (GGUF, Q4_K_M), run by llama.cpp's server (llama.ts) from
// the files llmfiles.ts downloads. The person picks a level on the Translate
// page; nothing is downloaded before. Unlike Firefox's models they translate
// between any two of their languages directly, one request per sentence, four
// at a time.

import { LLM_LANGUAGES, mapLimit, type LlmFiles } from './llmfiles'
import type { Translator } from './translator'

export type LlmLevel = 'accurate' | 'most'

const PARALLEL = 4
/** A sentence on the processor with the 12B model may take minutes. */
const REQUEST_MS = 10 * 60_000

/** TranslateGemma's prompt for one text, as its chat template writes it. */
export function promptFor(text: string, from: string, to: string): string {
  const s = LLM_LANGUAGES[from]
  const g = LLM_LANGUAGES[to]
  return (
    `<start_of_turn>user\nYou are a professional ${s} (${from}) to ${g} (${to}) translator. Your goal is to accurately convey the meaning and nuances of the original ${s} text while adhering to ${g} grammar, vocabulary, and cultural sensitivities.\n` +
    `Produce only the ${g} translation, without any additional explanations or commentary. Please translate the following ${s} text into ${g}:\n\n\n${text.trim()}<end_of_turn>\n<start_of_turn>model\n`
  )
}

export type LlmOptions = {
  files: LlmFiles
  fetch?: typeof fetch
  /** A translation done: seconds a sentence, and the seconds it waited for the model to load, when it did. */
  onTimed?: (level: LlmLevel, timed: { sentence: number; start?: number }) => void
}

export type LlmTranslators = Record<LlmLevel, Translator>

export function createLlmTranslators(o: LlmOptions): LlmTranslators {
  const { files } = o
  const { models, languages } = files.manifest
  const post = o.fetch ?? fetch

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
      state: native => (languages[native] ? files.state(level) : { status: 'unsupported', progress: 0, size: 0 }),
      prepare: (native, onProgress) =>
        languages[native] ? files.prepare(level, onProgress) : Promise.reject(new Error(`${models[level].name} does not translate this language`)),
      async translate(sentences, from, to) {
        const unknown = [from, to].find(code => !languages[code])
        if (unknown) throw new Error(`${models[level].name} does not translate this language (${unknown})`)
        if (sentences.length === 0) return []
        const target = files.target(level)
        const began = Date.now()
        return files.server.run(target, async (base, loaded) => {
          const ready = Date.now()
          const out = await mapLimit(sentences, PARALLEL, s => one(base, s, from, to))
          const counted = sentences.filter(s => s.trim()).length
          if (counted > 0) o.onTimed?.(level, { sentence: (Date.now() - ready) / 1000 / counted, ...(loaded ? { start: (ready - began) / 1000 } : {}) })
          return out
        })
      },
      dispose: () => files.dispose(),
    }
  }

  return { accurate: translator('accurate'), most: translator('most') }
}
