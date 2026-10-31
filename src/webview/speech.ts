// What the speech pages share: the engine's HTTP API as the window sees it
// (its library's rows and transcripts, its own settings), short messages at
// the bottom of the window, and the two things a page offers before its
// feature can work: the engine's parts to download, and the Hugging Face key
// that lets speakers be told apart.

import { cardText, mainCard, nvidiaCard, shortCpu } from '../hardware'
import type { AppView, Choice, Feature, SpeechHealth, SpeechPart, SpeechResult } from '../protocol'
import { BASIS_TEXT, estimateText, minutes, seconds, type FeaturePlan } from '../speechplan'
import { el, icon } from './dom'
import { aside, bad, bar, btn, card, chip, grp, ib, link, linkBtn, post, radioRow, recommended, row, seg, toggleKnob } from './ui'

export type Source = 'file' | 'mic' | 'meet' | 'note'
export type Stage = '' | 'decode' | 'words' | 'speakers' | 'save'

/** A line of the engine's library (store.py LIST_COLUMNS), with the found words when searched. */
export type Row = {
  id: string
  title: string
  source: Source
  created: string
  duration: number
  status: 'recording' | 'queued' | 'working' | 'done' | 'failed'
  stage: Stage
  progress: number
  error: string
  language: string
  speakers_status: string
  snippet?: string
}

export type Utterance = { speaker: string; start: number; end: number; text: string; edited?: boolean }

export type Transcript = {
  id: string
  title: string
  source: Source
  created: string
  duration: number
  language: string
  speakers: Record<string, { name: string }>
  utterances: Utterance[]
  speakersStatus: 'ok' | 'single' | 'no-part' | 'needs-token' | 'failed'
  note?: string
  noteError?: string
  /** The words' times are kept: speakers can be split later without recognizing the text again. */
  hasWords?: boolean
  edited?: string
}

/** The engine's own settings (engine/settings.py); the key itself never comes back, only whether there is one. */
export type EngineSettings = {
  model: string
  language: string
  hotwords: string
  /** The words to spell as the engine holds them: Krya's `vocabulary` setting, sent with the plan. */
  vocabulary: { word: string; heard: string[] }[]
  hasToken: boolean
  dataDir: string
  kbDir: string
  kbInbox: string
}

export type Diarization = SpeechHealth['diarization']

export class SpeechError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** One call to the engine; its refusal is thrown with the engine's own words. */
export async function api<T>(method: string, route: string, body?: unknown): Promise<T> {
  const r = (await window.tutorHost.call({ call: 'speech', method, route, body })) as SpeechResult<T>
  if (!r.ok) throw new SpeechError(r.error, r.status)
  return r.data
}

export const problem = (error: unknown) => (error instanceof Error ? error.message : String(error))
export const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path

// ---------------------------------------------------------------- the redraw

let redraw = () => {}
/** The window's way to draw the open page again, after something here changed. */
export function onRedraw(fn: () => void): void {
  redraw = fn
}
export const redrawPage = () => redraw()

// ---------------------------------------------------------------- times

/** 0:07, 12:40, 1:02:13. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Minutes an hour of sound takes here with the model chosen for transcripts, speakers included when their part is here. */
export function minutesPerHour(v: AppView): number {
  return Math.max(1, Math.round(v.speech.plan.transcripts.chosen.estimate))
}

/** 40 s, 12 min, 1 h 4 min. */
export function length(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`
  const minutes = Math.round(seconds / 60)
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`
}

// ---------------------------------------------------------------- messages

const toasts = el('div', { class: 'toasts', role: 'status' })
document.body.append(toasts)

/** A short message at the bottom of the window, with one thing to do about it at most. */
export function toast(text: string, action?: { label: string; run: () => void }, fault = false): void {
  const node = el(
    'div',
    { class: fault ? 'toast bad' : 'toast' },
    el('span', {}, text),
    action ? el('button', { class: 'link', onclick: () => (action.run(), node.remove()) }, action.label) : null,
  )
  toasts.append(node)
  window.setTimeout(() => node.remove(), action ? 7000 : 3500)
}

export const fault = (error: unknown) => toast(problem(error), undefined, true)
export const showFile = (path: string) => ({ label: 'Show', run: () => post({ type: 'showInFolder', path }) })

// ---------------------------------------------------------------- the engine's settings

let engine: EngineSettings | undefined
let asking = false

/** The engine's settings, once it runs; asked for once and kept, then followed by each change made here. */
export function engineSettings(v: AppView): EngineSettings | undefined {
  if (v.speech.service !== 'ready') return undefined
  if (!engine && !asking) {
    asking = true
    api<EngineSettings>('GET', '/settings').then(
      s => {
        engine = s
        asking = false
        redraw()
      },
      () => (asking = false),
    )
  }
  return engine
}

/** The engine went away (removed, restarted): its settings are asked for again. */
export function forgetEngine(): void {
  engine = undefined
}

export async function saveEngine(changes: Partial<EngineSettings> & { hfToken?: string }): Promise<boolean> {
  try {
    engine = await api<EngineSettings>('PUT', '/settings', changes)
    redraw()
    return true
  } catch (error) {
    fault(error)
    return false
  }
}

/** The knowledge base: a folder of .md files (an Obsidian vault will do). */
export async function pickKb(): Promise<void> {
  const folder = (await window.tutorHost.call({ call: 'pickFolder', title: 'The knowledge base folder', current: engine?.kbDir ?? '' })) as string | null
  if (folder && (await saveEngine({ kbDir: folder }))) toast(`Knowledge base: ${folder}`)
}

// ---------------------------------------------------------------- the parts

export const installed = (v: AppView) => v.speech.pack.parts.includes('core')
export const hasPart = (v: AppView, part: SpeechPart) => v.speech.pack.parts.includes(part)
/** The engine is here and answering. */
export const running = (v: AppView) => installed(v) && v.speech.service === 'ready'

/** The graphics card's part comes with the first download unless the person turns it off. */
let withGpu = true

/** A part being installed or removed now: its line with the bar, or undefined. */
export function packWork(v: AppView): HTMLElement | undefined {
  const p = v.speech.pack
  if (p.status === 'removing') return row('Removing the speech engine…', [], null)
  if (p.status !== 'installing') return undefined
  // A part taken out (Storage's ×): the same sync, with fewer parts.
  if (p.installing && p.installing.length < p.parts.length) return row('Removing a part of the speech engine…', ['the speech engine is back in a moment', bar(p.progress ?? 0)], el('span', { class: 'pct' }, `${Math.round((p.progress ?? 0) * 100)}%`))
  const what = p.step === 'tool' ? 'the Python manager' : 'the packages'
  const pct = Math.round((p.progress ?? 0) * 100)
  const parts = (p.installing ?? []).filter(x => !p.parts.includes(x))
  const name = parts.includes('speakers') && p.parts.includes('core') ? 'Downloading the speakers part' : 'Downloading the speech engine'
  return row(name, [`${what}; you can close this window, the download goes on`, bar(p.progress ?? 0)], el('span', { class: 'pct' }, `${pct}%`))
}

/**
 * What the speech engine needs before `feature` works: its download (with
 * the graphics card's part when there is an NVIDIA card), the download going
 * on, why it failed, or the service starting. Nothing once it runs.
 */
export function engineRows(v: AppView, feature: string): HTMLElement[] {
  const s = v.speech
  const work = packWork(v)
  if (work && !installed(v)) return [work]
  if (!installed(v)) {
    const gpu = s.pack.nvidia && withGpu
    const mb = s.download.core + (gpu ? s.download.gpu : 0)
    const first = gpu ? s.firstModel.cuda : s.firstModel.cpu
    // On the disk: the parts and the first model; while installing, the download's cache too.
    const keeps = s.installed.core + (gpu ? s.installed.gpu : 0) + first.mb
    const needs = Math.round((keeps + mb) * 1.1)
    const short = s.disk.freeMb > 0 && s.disk.freeMb < needs
    const go = () => post({ type: 'installSpeech', parts: gpu ? ['core', 'gpu'] : ['core'] })
    const failed = s.pack.status === 'failed'
    const card = nvidiaCard(s.device)
    const download = btn(failed ? 'Try again' : 'Download', go, 'primary')
    download.disabled = short
    return [
      row(
        `${feature} needs the speech engine`,
        [
          failed ? bad(`The download stopped: ${s.pack.message ?? 'unknown error'}`) : `${size(mb)} to download, then it works offline; ${size(keeps)} on the disk (with the ${first.model} model)`,
          short ? bad(`Needs ${size(needs)} free; ${s.disk.drive} has ${size(s.disk.freeMb)}`) : s.disk.freeMb > 0 ? `${size(s.disk.freeMb)} free on ${s.disk.drive}` : null,
        ],
        download,
      ),
      s.pack.nvidia
        ? row(
            'Use the graphics card',
            [`${size(s.download.gpu)} more to download; a phrase takes about ${seconds(s.firstModel.cuda.phrase)} instead of ${seconds(s.firstModel.cpu.phrase)} (${card ? cardText(card) : 'NVIDIA'})`],
            toggleKnob(withGpu, on => ((withGpu = on), redraw()), 'Use the graphics card'),
          )
        : null,
    ].filter((n): n is HTMLElement => n !== null)
  }
  if (work) return [work]
  if (s.service === 'starting' || s.service === 'off') return [row('The speech engine is starting…', [], null)]
  if (s.service === 'down') return [row('The speech engine is not running',[bad(s.trouble ?? 'it stopped')], linkBtn('Restart', () => post({ type: 'restartSpeech' })))]
  return []
}

/** 480 MB, 1.6 GB. */
export function size(mb: number): string {
  return mb >= 1000 ? `${(Math.round(mb / 100) / 10).toFixed(1)} GB` : `${Math.max(1, Math.round(mb))} MB`
}

const where = (c: Choice) => (c.device === 'cuda' ? 'graphics card' : 'processor')

/** The model a feature uses now, as the engine has it: downloading shows how far. */
function liveModel(v: AppView, feature: Feature): SpeechHealth['models']['dictation'] | undefined {
  return v.speech.health?.models[feature === 'dictation' ? 'dictation' : 'transcripts']
}

const FEATURES: [Feature, string][] = [
  ['dictation', 'Dictate'],
  ['transcripts', 'Transcribe'],
]
const pin = (feature: Feature, model: string) => post({ type: 'saveSettings', patch: { [feature === 'dictation' ? 'dictationModel' : 'transcriptsModel']: model } })

/**
 * One action's speech model (Models › Dictate, Models › Transcribe): Automatic
 * first, the most accurate model quick enough here (speechplan.ts: on the card
 * dictation shares the transcripts' model; on the processor it needs one that
 * answers in a second), then each model the action can run, with its time here,
 * its size, and whether the other action uses it too, so one model serves both
 * where that costs nothing. A pick downloads it when it is not here. A model on
 * the disk that nothing uses can go; one kept for the processor says so.
 */
export function speechChoiceRows(v: AppView, feature: Feature): HTMLElement[] {
  const plan = v.speech.plan
  const p = plan[feature]
  const other: Feature = feature === 'dictation' ? 'transcripts' : 'dictation'
  const otherName = FEATURES.find(([f]) => f === other)?.[1] ?? ''
  // The other device's plan: what runs when the card refuses a model.
  const spare = plan.device === 'cuda' ? plan.engine.cpu : undefined
  const budget = feature === 'dictation' ? `a phrase in ≈${seconds(p.budget)}` : `an hour in ≈${minutes(p.budget)}`
  const live = (name: string) => [liveModel(v, 'dictation'), liveModel(v, 'transcripts')].find(m => m?.name === name && m.state === 'downloading')
  const out: HTMLElement[] = [
    radioRow(
      el('span', {}, 'Automatic', recommended()),
      [`the most accurate model that is quick enough here: ${budget}`, p.pinned ? null : `uses ${p.chosen.label} now`],
      !p.pinned,
      () => pin(feature, ''),
    ),
  ]
  for (const c of p.choices) {
    const on = p.pinned && p.chosen.model === c.model
    const here = p.chosen.model === c.model
    const shared = plan[other].chosen.model === c.model
    const backup = spare && !here && !shared ? FEATURES.filter(([f]) => spare[f]?.model === c.model).map(([, n]) => n) : []
    const loading = live(c.model)
    const notes: (string | HTMLElement | null)[] = c.why
      ? [`${c.about} · ${c.why}`]
      : [
          `${estimateText(feature, c)} · on the ${where(c)} · ${BASIS_TEXT[c.basis]}${on && !c.fits ? ' · slower than usual here' : ''}`,
          `${c.about} · ${size(c.mb)}${c.downloaded ? ' on this computer' : ', downloads when picked'}`,
          here && !p.pinned ? 'Automatic uses it now' : null,
          shared ? `${otherName} uses it too: downloaded once, loaded once` : null,
          loading ? bar(loading.progress ?? 0) : null,
        ]
    if (!here && !shared && c.downloaded) notes.push(backup.length ? `kept for ${backup.join(' and ')} on the processor, if the graphics card fails` : 'not used now')
    const pick = c.why
      ? undefined
      : () => {
          if (!c.downloaded) post({ type: 'downloadSpeechModel', model: c.model })
          pin(feature, c.model)
        }
    // The engine keeps a model it plans or holds: one nothing plans can go.
    const remove = c.downloaded && !here && !shared && !backup.length && !loading ? ib('x', `Remove ${c.label} (${size(c.mb)}); it downloads again when picked`, () => post({ type: 'removeStored', id: 'speechModel', item: c.model })) : null
    const node = radioRow(c.label, notes, on, pick, loading ? el('span', { class: 'pct' }, `${Math.round((loading.progress ?? 0) * 100)}%`) : null, remove)
    if (c.why) node.classList.add('dim')
    out.push(node)
  }
  return out
}

/** What Automatic leans to: accuracy or speed. */
export function preferRow(v: AppView): HTMLElement {
  return row(
    'Automatic prefers',
    [v.settings.speechPrefer === 'speed' ? 'quicker models, a little less accurate' : 'the most accurate models this computer runs in time'],
    seg(
      v.settings.speechPrefer,
      [
        ['accuracy', 'Accuracy'],
        ['speed', 'Speed'],
      ],
      speechPrefer => post({ type: 'saveSettings', patch: { speechPrefer } }),
    ),
  )
}

/** The graphics card's part, on the speech models' pages, when there is an NVIDIA card that can take it. */
export function gpuRow(v: AppView): HTMLElement | null {
  const p = v.speech.pack
  if (!p.nvidia || !installed(v)) return null
  if (hasPart(v, 'gpu')) return row('Speech on the graphics card', [el('small', { class: 'ok' }, 'Installed'), cardNote(v)])
  return row(
    'Speech on the graphics card',
    [`${size(v.speech.download.gpu)} to download; Dictate and Transcribe get several times quicker`, cardNote(v)],
    Object.assign(btn('Add', () => post({ type: 'installSpeech', parts: ['gpu'] })), { disabled: p.status !== 'ready' }),
  )
}

/** The speed test going on: which model, how far. */
function testWork(v: AppView): HTMLElement | null {
  const t = v.speech.health?.calibration
  if (!t || (t.state !== 'running' && t.state !== 'waiting')) return null
  const share = t.total ? t.done / t.total : 0
  const what = t.state === 'waiting' ? 'waits until the engine is free' : `${t.current || 'starting'} · step ${Math.min(t.total, t.done + 1)} of ${t.total}`
  return row('Testing this computer', [what, bar(share)], el('span', { class: 'pct' }, `${Math.round(share * 100)}%`))
}

/**
 * The offer of the speed test, once there is something to measure and the
 * person has not answered it: each downloaded model runs once on a short clip,
 * then the models are chosen from what this computer really does.
 */
export function testOffer(v: AppView): HTMLElement | null {
  const work = testWork(v)
  if (work) return work
  const t = v.speech.test
  if (!t.offer) return null
  return el(
    'div',
    { class: 'offer' },
    icon('dashboard'),
    el(
      'div',
      { class: 'ot' },
      el('b', {}, 'Test your computer to pick the best speech models?'),
      el('small', {}, `Each downloaded model runs once on a short clip, about ${t.runs > 1 ? 'a minute or two' : 'a minute'}, in the background. Until then the times shown are guesses.`),
      el('span', { class: 'acts' }, btn('Run the test', () => post({ type: 'testSpeech' }), 'primary'), linkBtn('Not now', () => post({ type: 'declineSpeechTest' }))),
    ),
  )
}

/** Settings: this computer, the test, and accuracy or speed. */
export function computerRows(v: AppView): HTMLElement[] {
  const d = v.speech.device
  const card = mainCard(d)
  const cpu = `${shortCpu(d.cpu.name)} · ${d.cpu.cores} cores · ${d.ramGb} GB${d.laptop ? ' · a laptop' : ''}`
  const cards = card ? cardText(card) : d.at ? 'no graphics card of its own' : 'looking at the graphics card…'
  const plan = v.speech.plan
  const tested = plan.measured ? 'the speech models’ times are measured here' : running(v) ? 'the times are first guesses until the test' : 'tested once the speech engine is here'
  const t = testWork(v)
  return [
    row(
      cpu,
      [cards, tested],
      running(v) && !t ? linkBtn(v.speech.test.agreed && plan.measured ? 'Test again' : 'Test', () => post({ type: 'testSpeech' }), v.speech.test.runs === 0 && !plan.dictation.choices.some(c => c.downloaded)) : null,
    ),
    ...(t ? [t] : []),
  ]
}

/** What the graphics card does for speech, said plainly. */
export function cardNote(v: AppView): string {
  const s = v.speech
  const card = mainCard(s.device)
  const gpuPart = hasPart(v, 'gpu')
  if (!card) return s.device.at ? 'none of its own · speech runs on the processor' : 'looking…'
  const name = cardText(card)
  if (card.vendor !== 'nvidia') return `${name} · speech runs on the processor: only NVIDIA cards run it for now`
  if (!s.pack.nvidia && !gpuPart) return `${name} · too old or too small for speech · the processor does it`
  if (!gpuPart) return `${name} · add its part to use it`
  if (s.health?.fallback) return `${name} · it would not take the model, so the processor does it`
  if (s.plan.device === 'cpu') return `${name}, but the engine runs on the processor`
  return `${name} · speech is recognized on it`
}

// ---------------------------------------------------------------- speakers

const HF = {
  join: 'https://huggingface.co/join',
  model: 'https://huggingface.co/pyannote/speaker-diarization-community-1',
  tokens: 'https://huggingface.co/settings/tokens',
}

/** The speakers' model as the page says it: how it looks, and the words. */
const DIARIZATION: Record<Diarization, ['' | 'busy' | 'bad' | 'ok', string]> = {
  'needs-token': ['', 'needs a free Hugging Face key, once, to download the speakers’ model'],
  checking: ['busy', 'checking the key…'],
  downloading: ['busy', 'the key works · downloading the speakers’ model…'],
  'bad-token': ['bad', 'the key did not work: copy it whole, and make it of type Read'],
  'no-access': ['bad', 'the key works, but the model is not open to it yet: fill in the form on its page (step 2), then Check again'],
  failed: ['bad', 'could not check the key'],
  missing: ['', 'key saved · the model downloads with the first transcription'],
  ready: ['ok', 'the model is here · speakers are told apart offline, no key needed any more'],
}

/** "Replace key" was tapped: the field and the steps come back. */
let replacing = false
/** The key as typed so far: a redraw (the engine's state moving on) keeps it in the field. */
let draft = ''
/** What was asked of the engine a moment ago, shown until its own state follows (within two seconds). */
let expected: { state: Diarization; until: number } | undefined

export function diarizationOf(v: AppView): Diarization {
  const real = v.speech.health?.diarization ?? 'needs-token'
  if (expected && Date.now() < expected.until && (real === 'needs-token' || real === 'missing' || real === 'bad-token' || real === 'no-access' || real === 'failed')) return expected.state
  expected = undefined
  return real
}

const follow = (state: Diarization) => {
  expected = { state, until: Date.now() + 3000 }
  redraw()
}

/**
 * Who spoke when: the speakers part to download, then the Hugging Face key
 * with its live state (checking, downloading, a bad key, no access to the
 * model, ready) and the four steps to get one.
 */
export function speakerRows(v: AppView): HTMLElement[] {
  const s = v.speech
  const out: HTMLElement[] = [...speakersDeviceRows(v), ...speakersInstallRows(v)]
  if (!hasPart(v, 'speakers')) return out
  if (!running(v)) return [...out, card('lock', 'The voices’ model', ['set up once the speech engine runs'], null)]
  return [...out, grp('The voices’ model'), ...keyRows(v)]
}

export const DEVICE_NAMES = { cuda: 'graphics card', cpu: 'processor' } as const

/** Where who spoke when runs, as the person may choose it: the card (when it has room) or the processor, each with its size and its time here. */
function speakersDeviceRows(v: AppView): HTMLElement[] {
  const s = v.speech
  const plan = s.plan.speakers
  const pick = (on: 'cuda' | 'cpu') => post({ type: 'saveSettings', patch: { speakersDevice: on === plan.advised ? 'auto' : on } })
  const option = (on: 'cuda' | 'cpu') => {
    const sz = s.speakers.sizes[on]
    const time = plan[on]
    const chosen = s.speakers.on === on
    const node = card(
      on === 'cuda' ? 'monitor' : 'cpu',
      on === 'cuda' ? 'Graphics card' : 'Processor',
      [
        time === undefined ? null : `an hour’s voices in ≈${minutes(time)} here${plan.advised === on ? ' · advised' : ''}`,
        on === 'cuda'
          ? `PyTorch for the card · ≈${size(sz.download)} download · ${size(sz.installed)} on the disk, in place of the card’s part`
          : `PyTorch for the processor · ≈${size(sz.download)} download · ${size(sz.installed)} on the disk`,
      ],
      chosen ? chip('chosen', 'lit') : linkBtn('Use', () => pick(on)),
    )
    if (chosen) node.classList.add('picked')
    return node
  }
  const rows: HTMLElement[] = [aside('info', 'The words are recognized already. Telling the voices apart is another model; it runs on PyTorch, which is what downloads here.'), grp('Runs on')]
  if (s.plan.offers.speakersGpu && plan.cuda !== undefined) rows.push(option('cuda'))
  rows.push(option('cpu'))
  return rows
}

/** The part as it stands: to download for the chosen place, to switch to it, being installed, or installed. */
function speakersInstallRows(v: AppView): HTMLElement[] {
  const s = v.speech
  const work = packWork(v)
  if (work) return [work]
  const on = s.speakers.on
  const sz = s.speakers.sizes[on]
  const parts: SpeechPart[] = on === 'cuda' && !hasPart(v, 'gpu') ? ['gpu', 'speakers'] : ['speakers']
  const install = (label: string) => btn(label, () => post({ type: 'installSpeech', parts }), 'primary')
  const model = s.speakers.model ? 'the voices’ model is here already: no Hugging Face key needed' : 'then a free Hugging Face key, once, for the voices’ model'
  const room = s.disk.freeMb > 0 && s.disk.freeMb < sz.installed * 1.1 ? bad(`Needs ≈${size(sz.installed * 1.1)} free; ${s.disk.drive} has ${size(s.disk.freeMb)}`) : null
  if (!hasPart(v, 'speakers')) {
    return [grp('Download'), card('download', `Who spoke when, on the ${DEVICE_NAMES[on]}`, [`≈${size(sz.download)} download, once · ${model}`, s.pack.status === 'failed' ? bad(`The download stopped: ${s.pack.message ?? 'unknown error'}`) : room], install(s.pack.status === 'failed' ? 'Try again' : 'Download'))]
  }
  const there = s.pack.speakersOn ?? 'cpu'
  if (there !== on) {
    return [grp('Installed'), card('rotate-cw', `On the ${DEVICE_NAMES[there]} now`, [`switching to the ${DEVICE_NAMES[on]}: ≈${size(sz.download)} download; the other PyTorch goes`, room], install('Switch'))]
  }
  return [grp('Installed'), card('circle-check', `Installed · on the ${DEVICE_NAMES[on]}`, [el('small', { class: 'ok' }, `an hour’s voices in ≈${minutes(s.plan.speakers[on] ?? s.plan.speakers.cpu)} here`)], null)]
}

/** The Hugging Face key with its live state, and the four steps to get one while it is needed. */
function keyRows(v: AppView): HTMLElement[] {
  const s = v.speech
  const state = diarizationOf(v)
  const [kind, words] = DIARIZATION[state]
  const message = state === 'failed' && s.health?.diarizationMessage ? `${words}: ${s.health.diarizationMessage}` : words
  const note = el('small', { class: kind ? `kstate ${kind}` : 'kstate' }, kind === 'busy' ? el('i', { class: 'spin' }) : kind === 'ok' ? icon('check') : null, message)
  const again = (label: string) =>
    linkBtn(label, async () => {
      try {
        await api('POST', '/diarization/setup')
        follow('checking')
      } catch (error) {
        fault(error)
      }
    })
  const field = el('input', {
    type: 'password',
    class: 'field wide',
    placeholder: 'hf_…',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': 'Hugging Face key',
    oninput: (event: Event) => (draft = (event.target as HTMLInputElement).value),
  })
  field.value = draft
  const saveKey = async () => {
    const value = field.value.trim()
    if (!value) return field.focus()
    field.blur()
    draft = ''
    replacing = false
    if (await saveEngine({ hfToken: value })) follow('checking')
  }
  field.addEventListener('keydown', event => {
    if (event.key === 'Enter') void saveKey()
    if (event.key === 'Escape' && replacing) (event.preventDefault(), (replacing = false), field.blur(), redraw())
  })
  const entry = el('span', { class: 'kchg' }, field, btn('Save', () => void saveKey(), 'primary'))
  const settled = state === 'ready' || state === 'missing'
  const control =
    settled && !replacing
      ? linkBtn('Replace key', () => {
          replacing = true
          redraw()
        })
      : state === 'no-access'
        ? again('Check again')
        : state === 'failed'
          ? again('Try again')
          : null
  // Once the model is on the disk the key has done its work: nothing to replace.
  if (state === 'ready' && !replacing) return [row('The voices’ model', [note], null)]
  const out = [row('Hugging Face key', [note], control)]
  const typing = (!settled && state !== 'checking' && state !== 'downloading') || replacing
  if (typing) {
    out.push(
      el(
        'ol',
        { class: 'steps' },
        el('li', {}, link(HF.join, 'Sign up at Hugging Face'), ', free.'),
        el('li', {}, 'Open ', link(HF.model, 'the model’s page'), ' and fill in its form: Company or university, anything, your own name will do; Use case: ', el('b', {}, 'Meeting note taker'), '. Then Agree and access.'),
        el('li', {}, 'Open ', link(HF.tokens, 'Access Tokens'), ' → Create new token → type ', el('b', {}, 'Read'), ' → copy the hf_… key.'),
        el('li', {}, 'Paste it here and Save. The model downloads once; after that, everything works offline.', el('span', { class: 'kline' }, entry)),
      ),
    )
  }
  return out
}

/** A line under a page saying, calmly, what speakers still need, with the way there. */
export function speakersMissing(v: AppView, go: () => void): HTMLElement | null {
  if (!installed(v)) return null
  const state = v.speech.health?.diarization
  if (hasPart(v, 'speakers') && state !== 'needs-token' && state !== 'bad-token' && state !== 'no-access' && state !== 'failed') return null
  const why = !hasPart(v, 'speakers') ? 'Speakers are not told apart yet: their part is not downloaded.' : 'Speakers are not told apart yet: a Hugging Face key is needed.'
  return aside('users', why, ' ', linkBtn('Set up', go))
}
