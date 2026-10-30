// The accurate translators: Google's Gemma 4, E4B for Accurate and 12B for
// Most accurate (QAT q4_0 GGUF), run by llama.cpp's server (llama.ts) from the
// files llmfiles.ts downloads; the same model checks English (checker.ts). The
// person picks a level on the Translate page; nothing is downloaded before.
// Unlike Firefox's models they translate between any two of their languages
// directly, one request per sentence, four at a time. Measured on the owner's
// texts (2026-10-30, RTX 2080 SUPER): E4B 0.7 s a sentence, as quick as
// TranslateGemma 4B, which read "Сборка опять упала" as "The assembly figures
// have fallen again" and could not check; the 12B the best wording, 6 s a
// sentence on that 8 GB card. The whole paragraph given as context read a
// little better, cost 40 % more and once repeated a sentence: not used.

import { LLM_LANGUAGES, mapLimit, type LlmFiles, type LlmModel } from './llmfiles'
import type { Translator } from './translator'

const PARALLEL = 4
/** A sentence on the processor with the 12B model may take minutes. */
const REQUEST_MS = 10 * 60_000

/** The instructions for one sentence from `from` into `to` (codes). */
export function translatePrompt(from: string, to: string): string {
  return (
    `You translate from ${LLM_LANGUAGES[from]} into ${LLM_LANGUAGES[to]}. Reply with the translation only, nothing before or after it. ` +
    'Keep names, @handles, e-mail addresses, links, numbers, code and product names exactly as they are. Keep the tone of the original.'
  )
}

export type LlmOptions = {
  files: LlmFiles
  fetch?: typeof fetch
  /** A translation done: seconds a sentence, and the seconds it waited for the model to load, when it did. */
  onTimed?: (model: LlmModel, timed: { sentence: number; start?: number }) => void
}

export type LlmTranslators = Record<LlmModel, Translator>

export function createLlmTranslators(o: LlmOptions): LlmTranslators {
  const { files } = o
  const { models, languages } = files.manifest
  const post = o.fetch ?? fetch

  async function one(base: string, text: string, from: string, to: string): Promise<string | undefined> {
    if (!text.trim()) return text
    const response = await post(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${files.server.apiKey}` },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: translatePrompt(from, to) },
          { role: 'user', content: text.trim() },
        ],
        temperature: 0,
        // A translation is rarely twice its source's letters in tokens; the cap stops a model that repeats itself.
        max_tokens: Math.min(2048, 64 + 2 * text.length),
        // No prompt cache: llama.cpp keeps none for Gemma's sliding-window layers (measured: every sentence's instructions read again).
        cache_prompt: false,
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(REQUEST_MS),
    })
    if (!response.ok) throw new Error(`The translation engine answered ${response.status}`)
    const data = (await response.json()) as { choices?: { message?: { content?: unknown } }[] }
    const content = data.choices?.[0]?.message?.content
    return typeof content === 'string' ? content.trim() || undefined : undefined
  }

  function translator(level: LlmModel): Translator {
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
