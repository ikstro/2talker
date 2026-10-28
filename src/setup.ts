// The first-run setup's advice: what to download on this computer, and what
// the person's choice costs. Pure, so the window and the tests share it. The
// numbers come from the app's snapshot: the speech plan (speechplan.ts), the
// parts' sizes (speechhost.ts view), the voice's and the translator's size.

import { scriptFor } from './languages'
import type { AppView } from './protocol'
import type { SpeechPart } from './speechpack'
import { minutes, seconds } from './speechplan'

/** What the person takes from the setup: the switches of its third step, and the test of its fourth. */
export type Choice = {
  voice: 'natural' | 'windows'
  autoFix: boolean
  layoutBadge: boolean
  gpu: boolean
  dictate: boolean
  transcribe: boolean
  speakers: boolean
  /** Where who spoke when runs: the graphics card (PyTorch for it, large) or the processor (small, slow). */
  speakersOn: 'cuda' | 'cpu'
  startWithWindows: boolean
  /** Run the speed test once the models are here. */
  test: boolean
}

/** One piece of advice: whether to turn it on, and why, in a few words. */
export type Advice = { on: boolean; why: string }

export type Recommendation = Record<'voice' | 'autoFix' | 'gpu' | 'dictate' | 'transcribe' | 'speakers' | 'startWithWindows', Advice>

/** A few cores cannot make the natural voice faster than it speaks: a Windows voice is instant. */
const VOICE_CORES = 4
/** The word dictionary's download, roughly (a gzipped JSON; the store does not know its size). */
const DICTIONARY_MB = 5

/** What this computer is good for, from the plan and the profile; the chips and the switches' first state. */
export function recommend(v: AppView): Recommendation {
  const s = v.speech
  const d = s.device
  const plan = s.plan
  const cyrillic = scriptFor(v.settings.native) === 'Cyrillic'
  const weak = d.cpu.cores < VOICE_CORES
  const chosen = plan.transcripts.chosen
  const hourCpu = minutes(chosen.estimate)
  // The planner always finds a model that keeps the time; a meeting needs a good one too.
  const rough = chosen.model === 'tiny' || chosen.model === 'base'
  return {
    voice: weak ? { on: false, why: 'a Windows voice is instant; the natural one would pause between sentences on this processor' } : { on: true, why: 'reads like a person; this computer makes its speech faster than it plays' },
    autoFix: cyrillic
      ? { on: true, why: `${v.settings.native} and English share the keyboard: a word typed in the wrong layout is typed again right` }
      : { on: false, why: 'your language shares the Latin layout; turn it on if you also type in another' },
    gpu: plan.offers.gpu
      ? { on: true, why: `speech on the graphics card: a phrase in ≈${seconds(s.firstModel.cuda.phrase)}, not ≈${seconds(s.firstModel.cpu.phrase)}` }
      : { on: false, why: d.at ? 'no NVIDIA card that can take it; speech runs on the processor' : 'looking at the graphics card…' },
    dictate: { on: true, why: `${s.firstModel.cpu.model} writes a phrase in ≈${seconds(s.firstModel.cpu.phrase)} on this processor` },
    transcribe:
      chosen.fits && !rough
        ? { on: true, why: `${chosen.label}: an hour of a meeting in ≈${hourCpu} on this computer${plan.offers.gpu ? ', quicker on the graphics card' : ''}` }
        : { on: false, why: `possible, but ${rough ? 'rough' : 'slow'} here: ${chosen.label} writes an hour in ≈${hourCpu}` },
    speakers:
      plan.offers.speakersGpu && plan.speakers.cuda !== undefined
        ? { on: true, why: `the voices told apart on the graphics card: an hour in ≈${minutes(plan.speakers.cuda)}` }
        : { on: false, why: `possible, but slow here: on the processor an hour’s voices take ≈${minutes(plan.speakers.cpu)}` },
    startWithWindows: { on: true, why: 'the keys work from the first minute' },
  }
}

/** The choice the setup starts with: the advice, turned on. */
export function recommendedChoice(v: AppView): Choice {
  const r = recommend(v)
  return {
    voice: r.voice.on ? 'natural' : 'windows',
    autoFix: r.autoFix.on,
    layoutBadge: false,
    gpu: r.gpu.on,
    dictate: r.dictate.on,
    transcribe: r.transcribe.on,
    speakers: r.speakers.on && r.transcribe.on,
    speakersOn: v.speech.plan.speakers.advised,
    startWithWindows: true,
    test: true,
  }
}

/** One thing to download: its name, what it is for, its size (0: here already). */
export type Item = {
  key: 'translator' | 'dictionary' | 'voice' | 'engine' | `model:${string}`
  label: string
  note: string
  mb: number
}

export type Cost = {
  items: Item[]
  /** To download, and what stays on the disk, in MB. */
  download: number
  disk: number
  /** The engine's parts and the models the choice needs (the ones not here yet). */
  parts: SpeechPart[]
  models: string[]
  /** The disk has room (unknown free space counts as room). */
  fits: boolean
}

const speechNeeded = (c: Choice) => c.dictate || c.transcribe

/** Where the choice's speakers would run: the card only with its part chosen and room on it, else the processor. */
export function speakersWhere(c: Choice, v: AppView): 'cuda' | 'cpu' {
  return c.speakersOn === 'cuda' && c.gpu && v.speech.pack.nvidia && v.speech.plan.offers.speakersGpu ? 'cuda' : 'cpu'
}

/** What a choice costs on this computer, item by item. */
export function cost(c: Choice, v: AppView): Cost {
  const s = v.speech
  const items: Item[] = []
  let disk = 0
  const t = v.translatorState
  if (t.status !== 'unsupported') {
    const mb = t.status === 'ready' ? 0 : t.size
    items.push({ key: 'translator', label: `The translator for ${v.settings.native} ⇄ English`, note: mb ? 'Firefox Translations, once · then offline' : 'here already', mb })
    disk += mb
  }
  const dict = v.dictionary.status
  if (dict !== 'none') {
    const mb = dict === 'ready' ? 0 : DICTIONARY_MB
    items.push({ key: 'dictionary', label: 'The word dictionary', note: mb ? 'meanings of English words, once' : 'here already', mb })
    disk += mb
  }
  if (c.voice === 'natural') {
    const here = v.natural.status === 'ready'
    items.push({ key: 'voice', label: 'The natural voice', note: here ? 'here already' : 'Kokoro · reads on this computer', mb: here ? 0 : v.natural.size })
    if (!here) disk += v.natural.size
  }
  const parts: SpeechPart[] = []
  const models: string[] = []
  if (speechNeeded(c)) {
    const have = new Set(s.pack.parts)
    const wanted: SpeechPart[] = ['core', ...(c.gpu && s.pack.nvidia ? (['gpu'] as SpeechPart[]) : []), ...(c.transcribe && c.speakers ? (['speakers'] as SpeechPart[]) : [])]
    for (const part of wanted) if (!have.has(part)) parts.push(part)
    // The speakers' PyTorch for the card carries the card's libraries itself: with it, the card's part costs nothing more.
    const where = speakersWhere(c, v)
    const cardInside = where === 'cuda' && wanted.includes('speakers')
    const size = (p: SpeechPart, kind: 'download' | 'installed') =>
      p === 'speakers' ? s.speakers.sizes[where][kind] : p === 'gpu' && cardInside ? 0 : s[kind][p]
    const mb = parts.reduce((n, p) => n + size(p, 'download'), 0)
    const onDisk = parts.reduce((n, p) => n + size(p, 'installed'), 0)
    const names = { core: 'speech to text', gpu: 'the graphics card’s part', speakers: 'the speakers’ part' }
    items.push({ key: 'engine', label: 'The speech engine', note: parts.length ? `${parts.map(p => names[p]).join(', ')} · ${Math.round(onDisk)} MB on the disk` : 'here already', mb })
    disk += onDisk
    const downloaded = new Set(s.health?.downloaded ?? s.plan.dictation.choices.filter(x => x.downloaded).map(x => x.model))
    const want = [...(c.dictate ? [s.plan.dictation.chosen] : []), ...(c.transcribe ? [s.plan.transcripts.chosen] : [])]
    for (const m of want) {
      if (models.includes(m.model)) continue
      models.push(m.model)
      const here = downloaded.has(m.model) || m.downloaded
      items.push({ key: `model:${m.model}`, label: m.label, note: here ? 'here already' : m.about, mb: here ? 0 : m.mb })
      if (!here) disk += m.mb
    }
  }
  const download = items.reduce((n, i) => n + i.mb, 0)
  const free = s.disk.freeMb
  return { items, download, disk, parts, models: models.filter(m => !(s.health?.downloaded ?? []).includes(m)), fits: free <= 0 || free >= disk * 1.1 }
}

/** 480 MB, 2.9 GB. */
export function sizeText(mb: number): string {
  return mb >= 1000 ? `${(Math.round(mb / 100) / 10).toFixed(1)} GB` : `${Math.max(1, Math.round(mb))} MB`
}
