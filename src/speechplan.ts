// Which speech model runs where on this computer, and how long each one takes
// here. Every model of the catalog (engine/models.json) gets an estimate per
// feature: its time measured on this computer when the speed test (or real use)
// has one, scaled from a measured model when another was measured, else a first
// guess from the processor's cores. Each feature then takes the most accurate
// model within its budget (a phrase in about 1.5 s; the words of an hour in about
// 45 min), preferring one already downloaded and offering the better one; a model
// the person picked is kept whatever it costs. The engine gets the result as its
// plan (settings.py), for the card and for the processor, should the card fail.

import catalog from '../engine/models.json'
import { nvidiaCard, type DeviceProfile } from './hardware'

export type Feature = 'dictation' | 'transcripts'
export type Device = 'cpu' | 'cuda'
export type Prefer = 'accuracy' | 'speed'
/** Where an estimate comes from: this model measured here, another model measured here and scaled, or a first guess. */
export type Basis = 'measured' | 'scaled' | 'guess'

type Prior = { phrase: number; rtf: number }
export type CatalogModel = {
  name: string
  label: string
  about: string
  backend: string
  bytes: number
  rank: number
  languages: 'all' | string[]
  /** Where it runs (Parakeet: the processor only) and what for (Parakeet: dictation). */
  devices: Device[]
  features: Feature[]
  cpu: Prior
  cuda: Prior
  ramMb: number
  vramMb: { float16: number; int8_float16: number }
}

export const MODELS = catalog.models as CatalogModel[]
const SPEAKERS = catalog.speakers as Record<Device, { rtf: number }>

/** Seconds for a 7 s phrase; minutes of words for an hour of sound. */
export const BUDGET: Record<Feature, Record<Prefer, number>> = {
  dictation: { accuracy: 1.5, speed: 0.8 },
  transcripts: { accuracy: 45, speed: 20 },
}
/** A model already chosen stays until it is this much over the budget, so numbers moving a little do not flip it. */
const KEEP = 1.15
/** Decoding the file and saving the sound, per second of an hour: a minute or so. */
const OVERHEAD_RTF = 0.015
/** A model bigger than this (large-v3, 3.1 GB) is never downloaded by itself: it is offered, with its size. */
export const AUTO_DOWNLOAD_MB = 2000

export type BenchRun = { phrase?: number; rtf?: number; n?: number; at?: string; source?: 'test' | 'use'; failed?: string }
export type Bench = { fingerprint: string; runs: Record<string, BenchRun> }

export type PlanInput = {
  profile: DeviceProfile | undefined
  fingerprint: string
  bench: Bench | undefined
  /** The engine can use the card now: the gpu part is there, a card answered, and it has not failed. */
  cuda: boolean
  /** Speakers run on the card (torch's CUDA build is installed). */
  speakersCuda: boolean
  /** The speakers part is installed: Transcribe's hour includes telling them apart. */
  speakers: boolean
  downloaded: string[]
  /** The person's own language (a code). */
  native: string
  prefer: Prefer
  /** A model the person picked per feature; empty for Automatic. */
  pins: Record<Feature, string>
  /** The models the engine has now per feature, so a choice near the budget does not flip back and forth. */
  previous?: Partial<Record<Feature, string>>
  /** No profile yet: whether an NVIDIA driver is installed at all (nvidia-smi.exe). */
  nvidiaDriver?: boolean
}

export type Choice = {
  model: string
  label: string
  about: string
  device: Device
  compute: string
  /** dictation: seconds for a 7 s phrase; transcripts: minutes for an hour, speakers included when their part is here. */
  estimate: number
  basis: Basis
  downloaded: boolean
  mb: number
  /** Within the budget (for transcripts, the words alone). */
  fits: boolean
  /** Why it cannot run here; empty when it can. */
  why: string
}

export type FeaturePlan = {
  chosen: Choice
  /** Every model, the usable ones first, the most accurate first. */
  choices: Choice[]
  pinned: boolean
  /** The model that fits this computer best, when it still has to be downloaded. */
  better?: Choice
  budget: number
}

export type EngineEntry = { model: string; compute?: string; beam?: number }
export type EnginePlan = {
  fingerprint: string
  threads: number
  cpu: Record<Feature, EngineEntry>
  cuda?: Record<Feature, EngineEntry>
}

export type SpeechPlan = {
  device: Device
  dictation: FeaturePlan
  transcripts: FeaturePlan
  /** The chosen models' times are this computer's own. */
  measured: boolean
  engine: EnginePlan
  /** Worth offering: the graphics card's part (an NVIDIA card that can take Whisper), and speakers on it. */
  offers: { gpu: boolean; speakersGpu: boolean }
  /** Minutes to tell an hour's speakers apart here, on the processor and (when offered) on the card; where it is advised. */
  speakers: { cpu: number; cuda?: number; advised: Device }
  threads: number
}

export const runKey = (model: string, device: Device, compute: string) => `${model}|${device}|${compute}`

/** How much slower than the reference processor (8 cores, a desktop) this one probably is. */
export function cpuFactor(profile: DeviceProfile | undefined): number {
  if (!profile) return 1.5
  const cores = Math.max(1, profile.cpu.cores)
  return Math.sqrt(8 / cores) * (profile.laptop ? 1.4 : 1)
}

/** How much slower than the reference card (an RTX 2080, compute 7.5) this one probably is. */
function cudaFactor(profile: DeviceProfile | undefined): number {
  const cap = nvidiaCard(profile)?.computeCap
  if (!cap) return 1
  return cap < 7 ? 2 : cap >= 8 ? 0.8 : 1
}

const driverMajor = (driver: string) => Number(driver.split('.')[0]) || 0

/** The graphics card's part is worth offering: an NVIDIA card with 2 GB or more, new enough for CUDA 12. */
export function gpuOffer(profile: DeviceProfile | undefined, nvidiaDriver = false): boolean {
  const card = nvidiaCard(profile)
  if (!card) return !profile?.at && nvidiaDriver
  if (card.vramMb && card.vramMb < 2048) return false
  if (card.computeCap && card.computeCap < 5) return false
  // nvidia-smi's driver numbers (528.33); Windows' own (32.0.15.6109) say nothing comparable.
  if (/^\d{3}\.\d+$/.test(card.driver) && driverMajor(card.driver) < 528) return false
  return true
}

/** The compute type a model takes on this card, or '' when it does not fit. */
function cudaCompute(m: CatalogModel, profile: DeviceProfile | undefined): string {
  const vram = nvidiaCard(profile)?.vramMb
  if (!vram) return 'float16'
  if (vram >= m.vramMb.float16 + 1024) return 'float16'
  if (vram >= m.vramMb.int8_float16 + 512) return 'int8_float16'
  return ''
}

function measuredValue(bench: Bench | undefined, key: string, field: 'phrase' | 'rtf'): number | undefined {
  const v = bench?.runs[key]?.[field]
  return typeof v === 'number' && v > 0 ? v : undefined
}

/** Seconds for a phrase or seconds per second, and where the number comes from. */
function speed(m: CatalogModel, device: Device, compute: string, field: 'phrase' | 'rtf', input: PlanInput): { value: number; basis: Basis } {
  const exact = measuredValue(input.bench, runKey(m.name, device, compute), field)
  if (exact !== undefined) return { value: exact, basis: 'measured' }
  // Another model measured on this device: this one by the catalog's ratio between the two,
  // from the measured model nearest in size and kind (small says more about turbo than tiny
  // does; a Whisper measured says something of Parakeet's processor, though less).
  let near: { value: number; distance: number } | undefined
  for (const other of MODELS) {
    if (other.name === m.name) continue
    for (const c of device === 'cpu' ? ['int8'] : ['float16', 'int8_float16']) {
      const v = measuredValue(input.bench, runKey(other.name, device, c), field)
      if (v === undefined) continue
      const distance = Math.abs(Math.log(other.bytes / m.bytes)) + (other.backend === m.backend ? 0 : 1)
      const value = ((v * m[device][field]) / other[device][field]) * (compute === 'int8_float16' && c !== compute ? 1.1 : 1)
      if (!near || distance < near.distance) near = { value, distance }
    }
  }
  if (near) return { value: near.value, basis: 'scaled' }
  const factor = device === 'cpu' ? cpuFactor(input.profile) : cudaFactor(input.profile) * (compute === 'int8_float16' ? 1.1 : 1)
  return { value: m[device][field] * factor, basis: 'guess' }
}

/** Seconds per second of sound to tell the speakers apart on a device: measured here, else the catalog's guess scaled to this computer. */
function speakersRtfOn(input: PlanInput, device: Device): number {
  const measured = measuredValue(input.bench, `speakers|${device}`, 'rtf')
  return measured ?? SPEAKERS[device].rtf * (device === 'cpu' ? cpuFactor(input.profile) : cudaFactor(input.profile))
}

function speakersRtf(input: PlanInput): number {
  return speakersRtfOn(input, input.speakersCuda && input.cuda ? 'cuda' : 'cpu')
}

function choice(m: CatalogModel, feature: Feature, device: Device, input: PlanInput): Choice {
  let why = ''
  let compute = device === 'cpu' || !m.devices.includes('cuda') ? 'int8' : cudaCompute(m, input.profile)
  if (device === 'cuda' && !compute) {
    why = 'too big for this graphics card'
    compute = 'int8_float16'
  }
  if (!m.devices.includes(device)) why = 'runs on the processor; the graphics card runs Whisper here'
  const ramMb = (input.profile?.ramGb ?? 8) * 1024
  if (device === 'cpu' && m.ramMb > ramMb * 0.3) why = 'needs more memory than this computer has'
  if (m.languages !== 'all' && !m.languages.includes(input.native)) why = 'not for your language'
  const field = feature === 'dictation' ? 'phrase' : 'rtf'
  const s = speed(m, device, compute, field, input)
  const budget = BUDGET[feature][input.prefer]
  const estimate = feature === 'dictation' ? s.value : 60 * (s.value + OVERHEAD_RTF + (input.speakers ? speakersRtf(input) : 0))
  const words = feature === 'dictation' ? s.value : 60 * s.value
  return {
    model: m.name,
    label: m.label,
    about: m.about,
    device,
    compute,
    estimate,
    basis: s.basis,
    downloaded: input.downloaded.includes(m.name),
    mb: Math.round(m.bytes / 1e6),
    fits: !why && words <= budget,
    why,
  }
}

const rankOf = (model: string) => MODELS.find(m => m.name === model)?.rank ?? 0

function decide(feature: Feature, device: Device, input: PlanInput): FeaturePlan {
  const budget = BUDGET[feature][input.prefer]
  const choices = MODELS.filter(m => m.features.includes(feature))
    .map(m => choice(m, feature, device, input))
    .sort((a, b) => Number(!!a.why) - Number(!!b.why) || rankOf(b.model) - rankOf(a.model) || a.estimate - b.estimate)
  const usable = choices.filter(c => !c.why)
  const pick = (c: Choice, pinned = false, better?: Choice): FeaturePlan => ({ chosen: c, choices, pinned, budget, ...(better ? { better } : {}) })
  const pinned = input.pins[feature] && usable.find(c => c.model === input.pins[feature])
  if (pinned) return pick(pinned, true)
  if (usable.length === 0) return pick(choices[0]!)
  const words = (c: Choice) => (feature === 'dictation' ? c.estimate : c.estimate - (input.speakers ? 60 * speakersRtf(input) : 0) - 60 * OVERHEAD_RTF)
  const fits = usable.filter(c => c.fits)
  const kept = usable.find(c => c.model === input.previous?.[feature] && c.downloaded && words(c) <= budget * KEEP)
  const best = fits[0]
  const here = fits.find(c => c.downloaded)
  if (kept && (!here || rankOf(here.model) <= rankOf(kept.model))) return pick(kept, false, best && best !== kept && !best.downloaded && rankOf(best.model) > rankOf(kept.model) ? best : undefined)
  if (here) return pick(here, false, best && best !== here ? best : undefined)
  // Nothing within the budget is here yet: the best that downloads by itself (a big one is only offered).
  const first = fits.find(c => c.mb <= AUTO_DOWNLOAD_MB)
  if (first) return pick(first, false, best && best !== first ? best : undefined)
  if (best) return pick(best)
  // Nothing within the budget: the quickest, with its honest time.
  return pick(usable.slice().sort((a, b) => a.estimate - b.estimate)[0]!)
}

function forDevice(device: Device, input: PlanInput): Record<Feature, FeaturePlan> {
  const transcripts = decide('transcripts', device, input)
  let dictation = decide('dictation', device, input)
  // On the card, dictation uses the transcripts' model when it is quick enough: one model in the card's memory.
  if (device === 'cuda' && !dictation.pinned) {
    const same = dictation.choices.find(c => c.model === transcripts.chosen.model && !c.why)
    if (same && same.estimate <= dictation.budget * KEEP) dictation = { ...dictation, chosen: same, better: undefined }
  }
  return { dictation, transcripts }
}

const entryOf = (feature: Feature, plan: FeaturePlan, input: PlanInput): EngineEntry => {
  const c = plan.chosen
  if (c.device === 'cuda') return { model: c.model, compute: c.compute, ...(feature === 'dictation' ? { beam: 5 } : {}) }
  return { model: c.model, ...(feature === 'dictation' ? { beam: input.prefer === 'speed' ? 1 : 2 } : {}) }
}

export function planSpeech(input: PlanInput): SpeechPlan {
  const threads = Math.max(1, input.profile?.cpu.cores ?? 2)
  const cpu = forDevice('cpu', input)
  const cuda = input.cuda ? forDevice('cuda', input) : undefined
  const shown = cuda ?? cpu
  const offers = { gpu: gpuOffer(input.profile, input.nvidiaDriver), speakersGpu: false }
  offers.speakersGpu = offers.gpu && (nvidiaCard(input.profile)?.vramMb ?? 8192) >= 6144
  return {
    device: cuda ? 'cuda' : 'cpu',
    dictation: shown.dictation,
    transcripts: shown.transcripts,
    measured: shown.dictation.chosen.basis === 'measured' && shown.transcripts.chosen.basis === 'measured',
    engine: {
      fingerprint: input.fingerprint,
      threads,
      cpu: { dictation: entryOf('dictation', cpu.dictation, input), transcripts: entryOf('transcripts', cpu.transcripts, input) },
      ...(cuda ? { cuda: { dictation: entryOf('dictation', cuda.dictation, input), transcripts: entryOf('transcripts', cuda.transcripts, input) } } : {}),
    },
    offers,
    speakers: {
      cpu: Math.round(60 * speakersRtfOn(input, 'cpu')),
      ...(offers.speakersGpu ? { cuda: Math.max(1, Math.round(60 * speakersRtfOn(input, 'cuda'))) } : {}),
      advised: offers.speakersGpu ? 'cuda' : 'cpu',
    },
    threads,
  }
}

/** The models the speed test should measure: those downloaded, on the device in use, not yet measured here. */
export function testRuns(input: PlanInput, plan: SpeechPlan, all = false): { model: string; device: Device; compute?: string; beam: number }[] {
  const device = plan.device
  const beam = plan.engine[device]?.dictation.beam ?? 2
  return plan.dictation.choices
    .filter(c => c.downloaded && !c.why)
    .filter(c => all || measuredValue(input.bench, runKey(c.model, device, c.compute), 'phrase') === undefined || measuredValue(input.bench, runKey(c.model, device, c.compute), 'rtf') === undefined)
    .sort((a, b) => a.mb - b.mb)
    .map(c => ({ model: c.model, device, ...(device === 'cuda' ? { compute: c.compute } : {}), beam }))
}

/** What a declined test is remembered by: it is offered again when this changes (another computer, a model added). */
export function testKey(input: PlanInput, plan: SpeechPlan): string {
  return `${input.fingerprint}|${plan.device}|${testRuns(input, plan, true)
    .map(r => r.model)
    .join(',')}`
}

/** 0.4 s, 2.1 s, 12 s. */
export function seconds(s: number): string {
  return s < 10 ? `${(Math.round(s * 10) / 10).toFixed(1)} s` : `${Math.round(s)} s`
}

/** 12 min, 1 h 10 min. */
export function minutes(m: number): string {
  const r = Math.max(1, Math.round(m))
  return r >= 60 ? `${Math.floor(r / 60)} h${r % 60 ? ` ${r % 60} min` : ''}` : `${r} min`
}

/** A choice's time as the pages say it: "≈0.4 s a phrase", "≈12 min an hour". */
export function estimateText(feature: Feature, c: Choice): string {
  return feature === 'dictation' ? `≈${seconds(c.estimate)} a phrase` : `≈${minutes(c.estimate)} an hour`
}

export const BASIS_TEXT: Record<Basis, string> = { measured: 'measured here', scaled: 'from this computer’s test', guess: 'first guess' }
