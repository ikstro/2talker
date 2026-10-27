// What the keyboard helper decides about text typed in the wrong layout,
// without Windows: the keys pressed are kept, not the letters, so a word can
// be read in every layout ("ghbdtn" in the Russian one is "привет"). A word
// is fixed by itself only when it is no word as typed and a frequent word in
// another layout; the fix key takes back everything typed in the wrong layout
// up to the first word that is right as it is.

/** One key with or without Shift: `${vk}:${0|1}`. */
export type KeyId = string

/** What each key types in one layout, and back. */
export type KeyTable = { chars: Map<KeyId, string>; keys: Map<string, KeyId> }

export function keyId(vk: number, shift: boolean): KeyId {
  return `${vk}:${shift ? 1 : 0}`
}

export function tableOf(entries: Iterable<[KeyId, string]>): KeyTable {
  const chars = new Map<KeyId, string>()
  const keys = new Map<string, KeyId>()
  for (const [key, char] of entries) {
    chars.set(key, char)
    // A character two keys type (a digit on the number pad) is typed back with the first.
    if (!keys.has(char)) keys.set(char, key)
  }
  return { chars, keys }
}

/** The character a key types in a layout; Caps Lock turns the case of letters. */
export function charOf(table: KeyTable, vk: number, shift: boolean, caps: boolean): string | undefined {
  const char = table.chars.get(keyId(vk, shift))
  if (char === undefined || !caps) return char
  return char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase()
}

/** A key pressed: the key, Shift and Caps Lock, and the layout (its id) it typed in. */
export type Stroke = { vk: number; shift: boolean; caps: boolean; layout: string }

/** What the strokes type in `table`; a key that types nothing there stays as it typed. */
export function typeIn(strokes: readonly Stroke[], table: KeyTable, own: (layout: string) => KeyTable | undefined): string {
  return strokes
    .map(s => {
      const here = charOf(table, s.vk, s.shift, s.caps)
      if (here !== undefined) return here
      const home = own(s.layout)
      return (home && charOf(home, s.vk, s.shift, s.caps)) ?? ''
    })
    .join('')
}

// ---------------------------------------------------------------- words

/** The words of a language, most frequent first, and the three-letter runs they are made of. */
export type Lexicon = { rank: Map<string, number>; trigrams: Set<string> }

export function lexiconOf(words: readonly string[]): Lexicon {
  const rank = new Map<string, number>()
  const trigrams = new Set<string>()
  words.forEach((word, i) => {
    if (rank.has(word)) return
    rank.set(word, i)
    for (const t of trigramsOf(word)) trigrams.add(t)
  })
  return { rank, trigrams }
}

function trigramsOf(word: string): string[] {
  const marked = `^${word}$`
  const out: string[] = []
  for (let i = 0; i + 3 <= marked.length; i++) out.push(marked.slice(i, i + 3))
  return out
}

/** The share of a word's three-letter runs the language has: 1 for any real-looking word, low for "ghbdtn" in English. */
export function plausibility(word: string, lexicon: Lexicon): number {
  const runs = trigramsOf(word)
  return runs.filter(t => lexicon.trigrams.has(t)).length / runs.length
}

const APOSTROPHES = /[’ʼ`]/g

/**
 * The word in a typed piece, in lower case: without the punctuation around
 * it; undefined when punctuation is left inside (other than an apostrophe
 * or a hyphen), so it is no word of this language.
 */
export function coreOf(text: string): string | undefined {
  const core = text.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '').replace(APOSTROPHES, "'").toLowerCase()
  if (!core || /[^\p{L}'-]/u.test(core)) return undefined
  return core
}

/** A piece of text as one layout reads the keys: `lang` is the language whose words it is checked against. */
export type Reading = { layout: string; lang: string; text: string }

/** How rare a fixed word may be, by its length: a short one must be common to be trusted. */
function trusted(word: string, rank: number): boolean {
  if (word.length <= 2) return rank < 3000
  if (word.length === 3) return rank < 20000
  return true
}

/**
 * The reading to fix a just-typed word into, if it is clearly typed in the
 * wrong layout: not a word as typed (nor a kept one), and a word, or at least
 * a word-shaped run of letters, in another layout. A piece with digits, an @
 * or a link, or a capital inside (iPhone), is left alone.
 */
export function chooseFix(typed: Reading, others: readonly Reading[], lexicons: Readonly<Record<string, Lexicon>>, keep: ReadonlySet<string>): Reading | undefined {
  const t = typed.text
  if (/\d|@|:\/\/|^www\./i.test(t) || /\p{Ll}\p{Lu}/u.test(t)) return undefined
  const own = lexicons[typed.lang]
  if (!own) return undefined
  const core = coreOf(t)
  if (core !== undefined && (core.length < 2 || own.rank.has(core) || keep.has(core))) return undefined
  if (keep.has(t.toLowerCase())) return undefined
  const letters = [...t].filter(c => /\p{L}/u.test(c)).length
  if (letters < 2) return undefined
  let best: { reading: Reading; score: number } | undefined
  for (const other of others) {
    const lexicon = lexicons[other.lang]
    const word = coreOf(other.text)
    if (!lexicon || !word || word.length < 2) continue
    const rank = lexicon.rank.get(word)
    // A known word ranks by how common it is; an unknown one only when it looks like the language and the typed piece does not.
    let score: number | undefined
    if (rank !== undefined) score = trusted(word, rank) ? rank : undefined
    else if (word.length >= 5 && plausibility(word, lexicon) === 1 && (core === undefined || plausibility(core, own) < 0.6)) score = 1_000_000
    if (score !== undefined && (!best || score < best.score)) best = { reading: other, score }
  }
  return best?.reading
}

/**
 * How many of the last words to fix with the fix key: back from the last one
 * (always taken) while a word is not right as it is, stopping at the first
 * that is a word in its own layout, or was typed in another layout. A
 * layout with no word list takes everything typed in it.
 */
export function wrongTail(words: readonly { typed: Reading; others: readonly Reading[] }[], lexicons: Readonly<Record<string, Lexicon>>): number {
  const last = words[words.length - 1]
  if (!last) return 0
  let count = 1
  for (let i = words.length - 2; i >= 0; i--) {
    const w = words[i] as (typeof words)[number]
    if (w.typed.layout !== last.typed.layout) break
    // R3, v2, a link or a mail: never typed in the wrong layout.
    if (/\d|@|:\/\//.test(w.typed.text)) break
    const lexicon = lexicons[w.typed.lang]
    const core = coreOf(w.typed.text)
    if (lexicon && core !== undefined && lexicon.rank.has(core)) {
      // Right as it is, unless another layout makes a more common word of it (rare, but "ghb" → "при").
      const better = w.others.some(o => {
        const word = coreOf(o.text)
        const rank = word === undefined ? undefined : lexicons[o.lang]?.rank.get(word)
        return rank !== undefined && rank < (lexicon.rank.get(core) as number) / 20
      })
      if (!better) break
    }
    count++
  }
  return count
}

// ---------------------------------------------------------------- selected text

/** The layout a text was typed in: the one whose keys type most of its letters; the first on a tie. */
export function sourceLayout(text: string, layouts: readonly { id: string; table: KeyTable }[]): string | undefined {
  let best: { id: string; count: number } | undefined
  for (const { id, table } of layouts) {
    let count = 0
    for (const char of text) if (/\p{L}/u.test(char) && table.keys.has(char)) count++
    if (!best || count > best.count) best = { id, count }
  }
  return best && best.count > 0 ? best.id : undefined
}

/** A text typed in layout `from` as it reads when the same keys are pressed in `to`. */
export function convertText(text: string, from: KeyTable, to: KeyTable): string {
  let out = ''
  for (const char of text) {
    const key = from.keys.get(char)
    out += (key && to.chars.get(key)) ?? char
  }
  return out
}

/** The layout after `id` in the cycle, round; the first one when `id` is not in it. */
export function nextLayout(cycle: readonly string[], id: string | undefined): string | undefined {
  if (cycle.length === 0) return undefined
  const i = id === undefined ? -1 : cycle.indexOf(id)
  return cycle[(i + 1) % cycle.length]
}
