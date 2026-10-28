// The first-run setup: four steps in the window before Home is ever shown.
// Your language → this computer → what you need (with what is advised here,
// and what it costs) → Download, one button for everything, with the
// downloads' progress. Finish or Skip set `setupDone`; the window then goes
// to Home and plays the opening moment. The steps and the choice live here
// while the window lives (it only hides); the advice is setup.ts's.

import { cardText, mainCard, shortCpu } from '../hardware'
import { LANGUAGES } from '../languages'
import type { AppView, ToHost } from '../protocol'
import type { Settings } from '../settings'
import { cost, recommend, recommendedChoice, sizeText, speakersWhere, type Advice, type Choice, type Item } from '../setup'
import { minutes, seconds } from '../speechplan'
import { el } from './dom'
import { lucide, type LucideName } from './lucide'
import { installed, running } from './speech'
import { aside, bad, bar, btn, card, chip, grp, ib, linkBtn, seg, select, toggleCard } from './ui'

export type SetupHooks = {
  save: (patch: Partial<Settings>) => void
  post: (message: ToHost) => void
  /** Draw the setup again after a step or a switch changed here. */
  redraw: () => void
}

const STEPS = ['Your language', 'This computer', 'What you need', 'Download'] as const
const CAPS = ['English is what Altype teaches', 'what speech can run on here', 'advised for this computer', 'one button, then it goes on by itself'] as const

let step = 1
let choice: Choice | undefined
/** Download was pressed: the fourth step shows the downloads going. */
let started = false
/** The language the first snapshot came with: Windows' own, marked as advised. */
let firstNative = ''

/** The setup is over (or begins again on another first run). */
export function resetSetup(): void {
  step = 1
  choice = undefined
  started = false
  firstNative = ''
}

/** A green chip saying this is the advice, with why under the card's title. */
function advised(node: HTMLElement, a: Advice): HTMLElement {
  if (!a.on) return node
  const l = node.querySelector('.l')
  const first = l?.querySelector('small')
  const mark = el('span', { class: 'chip good' }, lucide('check', 's'), 'Recommended')
  if (l) l.insertBefore(mark, first ?? null)
  return node
}

export function setupNodes(v: AppView, h: SetupHooks): HTMLElement[] {
  if (!firstNative) firstNative = v.settings.native
  const c = (choice ??= recommendedChoice(v))
  const r = recommend(v)
  const body = step === 1 ? languageStep(v, h) : step === 2 ? computerStep(v, h, c, r) : step === 3 ? needStep(v, h, c, r) : downloadStep(v, h, c)
  const go = (to: number) => {
    step = Math.max(1, Math.min(4, to))
    h.redraw()
  }
  const finish = () => h.save({ setupDone: true, speechTestAgreed: c.test })
  const skip = () => h.save({ setupDone: true })
  const download = () => {
    start(v, h, c)
    started = true
    go(4)
  }
  const room = step === 3 ? cost(c, v).fits : true
  const next =
    step === 3
      ? btn([lucide('download', 's'), 'Download'], download, 'primary')
      : step === 4
        ? btn('Finish', finish, 'primary')
        : btn(['Next', lucide('chevron-right', 's')], () => go(step + 1), 'primary')
  if (!room) next.disabled = true
  return [
    el(
      'div',
      { class: 'shead' },
      el('div', { class: 'sprog' }, ...STEPS.map((_, i) => el('i', { class: i + 1 === step ? 'on' : i + 1 < step ? 'done' : '' })), el('span', {}, `Step ${step} of ${STEPS.length}`)),
      el('div', { class: 'stitle-line' }, el('span', { class: 'stitle' }, STEPS[step - 1]), el('span', { class: 'scap' }, CAPS[step - 1])),
      el('div', { class: 'sline' }),
    ),
    el('div', { class: 'sbody' }, ...body),
    el(
      'div',
      { class: 'sfoot' },
      step > 1 && !(step === 4 && started) ? linkBtn('Back', () => go(step - 1)) : null,
      el('span', { class: 'gap' }),
      step < 4 ? linkBtn('Skip for now', skip) : null,
      next,
    ),
  ]
}

// ---------------------------------------------------------------- 1 · your language

function languageStep(v: AppView, h: SetupHooks): HTMLElement[] {
  const s = v.settings
  const nameOf = (code: string) => LANGUAGES.find(l => l.code === code)?.name ?? code
  const used = [s.native, 'English', ...s.languages.map(nameOf)]
  const rest = LANGUAGES.filter(l => !used.includes(l.name))
  const own = card(
    'languages',
    'Your language',
    ['what Altype translates into and listens for; English is the language it teaches'],
    select(
      s.native,
      v.languages.map(l => [l.name, `${l.native} · ${l.name}`]),
      native => {
        choice = undefined
        h.save({ native })
      },
    ),
  )
  if (s.native === firstNative) advised(own, { on: true, why: '' })
  return [
    grp('Your language'),
    own,
    s.native === firstNative ? aside('info', `Windows is in ${s.native}: the same language is advised.`) : null,
    grp('Other languages you use'),
    card(
      'plus',
      'Add a language',
      ['dictation never picks another; translation and the screen’s text guess among them'],
      select<string>('', [['', 'Pick a language'], ...rest.map((l): [string, string] => [l.code, `${l.name} · ${l.native}`])], code => code && h.save({ languages: [...s.languages, code] })),
    ),
    card('globe', 'English', ['always'], null),
    ...s.languages.map(code => card('globe', nameOf(code), [], ib('x', `Remove ${nameOf(code)}`, () => h.save({ languages: s.languages.filter(x => x !== code) })))),
  ].filter((n): n is HTMLElement => n !== null)
}

// ---------------------------------------------------------------- 2 · this computer

function computerStep(v: AppView, h: SetupHooks, c: Choice, r: ReturnType<typeof recommend>): HTMLElement[] {
  const s = v.speech
  const d = s.device
  const looking = d.at === 0
  const gpu = mainCard(d)
  const spin = () => el('i', { class: 'spin' })
  const cardNote = looking ? el('small', { class: 'kstate busy' }, spin(), 'looking at the graphics card…') : gpu ? cardText(gpu) : 'none of its own'
  const onCard = s.plan.offers.gpu && c.gpu
  const verdict = onCard
    ? card('sparkles', 'Speech can run on the graphics card', [`a dictated phrase in ≈${seconds(s.firstModel.cuda.phrase)} with ${s.firstModel.cuda.model} · an hour of a meeting in minutes`], null)
    : card('sparkles', 'Speech runs on the processor', [`a dictated phrase in ≈${seconds(s.firstModel.cpu.phrase)} with ${s.firstModel.cpu.model} · an hour of a meeting in ≈${minutes(s.plan.transcripts.chosen.estimate)}`], null)
  verdict.classList.add('total')
  return [
    grp('Hardware'),
    card('cpu', 'Processor', [looking ? el('small', { class: 'kstate busy' }, spin(), `${shortCpu(d.cpu.name)} · looking…`) : `${shortCpu(d.cpu.name)} · ${d.cpu.cores} cores${d.laptop ? ' · a laptop' : ''}`], null),
    card('memory-stick', 'Memory', [`${d.ramGb} GB`], null),
    card('monitor', 'Graphics card', [cardNote], null),
    grp('What it means'),
    verdict,
    s.plan.offers.gpu
      ? advised(
          toggleCard(
            'monitor',
            'Use the graphics card',
            c.gpu,
            on => {
              c.gpu = on
              h.redraw()
            },
            r.gpu.why,
          ),
          r.gpu,
        )
      : null,
    looking ? aside('info', 'Still looking at this computer; Next does not wait, the advice follows once it is known.') : null,
  ].filter((n): n is HTMLElement => n !== null)
}

// ---------------------------------------------------------------- 3 · what you need

function needStep(v: AppView, h: SetupHooks, c: Choice, r: ReturnType<typeof recommend>): HTMLElement[] {
  const s = v.speech
  const t = v.translatorState
  const flip = (key: keyof Choice) => (on: boolean) => {
    ;(c as unknown as Record<string, unknown>)[key] = on
    if (key === 'transcribe' && !on) c.speakers = false
    h.redraw()
  }
  const translatorNote =
    t.status === 'unsupported' ? 'no offline translator for this language yet' : t.status === 'ready' ? `the translator for ${v.settings.native} ⇄ English is here` : `the translator for ${v.settings.native} ⇄ English · ${sizeText(t.size)}, once`
  const dictNote = { ready: 'the word dictionary is here', absent: 'the word dictionary · a few MB, once', downloading: 'the word dictionary is coming', failed: 'the word dictionary · a few MB, once', none: 'no word dictionary for this language yet' }[v.dictionary.status]
  const engineMb = s.download.core + (c.gpu && s.pack.nvidia ? s.download.gpu : 0)
  const dictateModel = s.plan.dictation.chosen
  const transcribeModel = s.plan.transcripts.chosen
  const all = cost(c, v)
  const total = card(
    'hard-drive',
    `≈${sizeText(all.download)} to download`,
    [`${sizeText(all.disk)} on the disk once installed · ${s.disk.freeMb > 0 ? `${sizeText(s.disk.freeMb)} free on ${s.disk.drive}` : 'free space unknown'}`, all.fits ? null : bad('Not enough room: turn something off, or free some space.')],
    null,
  )
  total.classList.add('total')
  if (!all.fits) total.classList.add('bad')
  return [
    grp('Always'),
    card('languages', 'Listen & Translate', [translatorNote, dictNote], el('span', { class: 'chip' }, 'always on')),
    advised(
      card(
        'volume-2',
        'Voice',
        [r.voice.why],
        seg<Choice['voice']>(
          c.voice,
          [
            ['natural', v.natural.status === 'ready' ? 'Natural · here' : `Natural · ${sizeText(v.natural.size)}`],
            ['windows', 'Windows voice'],
          ],
          voice => {
            c.voice = voice
            h.redraw()
          },
        ),
      ),
      { on: r.voice.on, why: '' },
    ),
    grp('Keyboard'),
    advised(toggleCard('keyboard', 'Fix the layout as I type', c.autoFix, flip('autoFix'), r.autoFix.why), r.autoFix),
    toggleCard('type', 'Show the layout by the cursor', c.layoutBadge, flip('layoutBadge'), 'a small badge whenever the layout changes'),
    grp('Speech'),
    advised(toggleCard('mic', 'Dictate', c.dictate, flip('dictate'), `${r.dictate.why} · the speech engine ${sizeText(engineMb)} + ${dictateModel.label} ${dictateModel.downloaded ? 'here' : sizeText(dictateModel.mb)}`), r.dictate),
    advised(toggleCard('audio-lines', 'Transcribe meetings and files', c.transcribe, flip('transcribe'), `${r.transcribe.why} · ${transcribeModel.label} ${transcribeModel.downloaded ? 'here' : sizeText(transcribeModel.mb)}${c.dictate ? '' : ` + the speech engine ${sizeText(engineMb)}`}`), r.transcribe),
    c.transcribe ? advised(toggleCard('users', 'Who spoke when', c.speakers, flip('speakers'), `${r.speakers.why} · ${sizeText(s.speakers.sizes[speakersWhere(c, v)].download)}`), r.speakers) : null,
    c.transcribe && c.speakers ? speakersOnCard(v, h, c) : null,
    grp('Altype'),
    advised(toggleCard('power', 'Start with Windows', c.startWithWindows, flip('startWithWindows'), r.startWithWindows.why), r.startWithWindows),
    grp('All of it'),
    total,
    aside('info', 'Keys are set on each action’s page; everything here can be changed later in Settings.'),
  ].filter((n): n is HTMLElement => n !== null)
}

/** Where who spoke when runs: the card (large, quick) or the processor (small, slow); the card only when it can. */
function speakersOnCard(v: AppView, h: SetupHooks, c: Choice): HTMLElement {
  const s = v.speech
  const where = speakersWhere(c, v)
  const time = (on: 'cuda' | 'cpu') => s.plan.speakers[on]
  const canCard = s.plan.offers.speakersGpu && c.gpu && s.pack.nvidia && time('cuda') !== undefined
  const note = `an hour’s voices in ≈${minutes(time(where) ?? s.plan.speakers.cpu)} here`
  if (!canCard) return card('cpu', 'Runs on the processor', [note], null)
  const advice = s.plan.speakers.advised === 'cuda' ? 'the graphics card' : 'the processor'
  const node = card(
    'cpu',
    'Runs on',
    [note, where === s.plan.speakers.advised ? null : `${advice} is advised on this computer`],
    seg<'cuda' | 'cpu'>(
      where,
      [
        ['cuda', `Graphics card · ${sizeText(s.speakers.sizes.cuda.download)}`],
        ['cpu', `Processor · ${sizeText(s.speakers.sizes.cpu.download)}`],
      ],
      on => {
        c.speakersOn = on
        h.redraw()
      },
    ),
  )
  return where === s.plan.speakers.advised ? advised(node, { on: true, why: '' }) : node
}

/** Download: the settings are saved, every download starts; the fourth step shows them. */
function start(v: AppView, h: SetupHooks, c: Choice): void {
  const all = cost(c, v)
  h.save({
    voice: '',
    naturalDismissed: c.voice === 'windows',
    autoFix: c.autoFix,
    layoutBadge: c.layoutBadge,
    startWithWindows: c.startWithWindows,
    speechTestAgreed: c.test,
    // The advice stays "automatic", so it follows the computer; another choice is kept as made.
    speakersDevice: speakersWhere(c, v) === v.speech.plan.speakers.advised ? 'auto' : speakersWhere(c, v),
  })
  const t = v.translatorState.status
  if (t === 'absent' || t === 'failed') h.post({ type: 'prepareTranslator' })
  const d = v.dictionary.status
  if (d === 'absent' || d === 'failed') h.post({ type: 'prepareDictionary' })
  if (c.voice === 'natural' && (v.natural.status === 'absent' || v.natural.status === 'failed')) h.post({ type: 'downloadNatural' })
  if (c.dictate || c.transcribe) {
    if (all.parts.length === 0 && running(v)) for (const model of all.models) h.post({ type: 'downloadSpeechModel', model })
    else if (all.parts.length || all.models.length) h.post({ type: 'installSpeech', parts: all.parts.length ? all.parts : ['core'], models: all.models })
  }
}

// ---------------------------------------------------------------- 4 · download

function downloadStep(v: AppView, h: SetupHooks, c: Choice): HTMLElement[] {
  const all = cost(c, v)
  const rows = all.items.map(item => itemRow(item, v, h))
  return [
    grp(started ? 'Downloading' : 'To download', all.items.length),
    ...rows,
    grp('Then'),
    advised(
      toggleCard(
        'play',
        'Test the speech models when they are here',
        c.test,
        on => {
          c.test = on
          h.save({ speechTestAgreed: on })
        },
        'each downloaded model runs once on a short clip, a minute or two in the background; then the times here are this computer’s own',
      ),
      { on: true, why: '' },
    ),
    aside('info', started ? 'You can close this window: the downloads go on, and Home shows how far they are.' : 'Nothing has started yet: go back to Download, or Finish to set everything up later from the pages.'),
  ].filter((n): n is HTMLElement => n !== null)
}

const done = (what: string) => el('small', { class: 'kstate ok' }, lucide('check', 's'), what)
const waiting = (what: string) => el('small', {}, what)

/** One download's line: here, coming (with its bar), failed (with Try again), or waiting its turn. */
function itemRow(item: Item, v: AppView, h: SetupHooks): HTMLElement {
  const s = v.speech
  const icons: Record<string, LucideName> = { translator: 'languages', dictionary: 'book-open', voice: 'volume-2', engine: 'cpu' }
  const icon = icons[item.key] ?? 'audio-lines'
  const pct = (p: number) => el('span', { class: 'pct' }, `${Math.round(p * 100)}%`)
  let note: HTMLElement | string = item.note
  let control: HTMLElement | null = null
  if (item.key === 'translator') {
    const t = v.translatorState
    if (t.status === 'ready') note = done('here')
    else if (t.status === 'downloading') (note = bar(t.progress)), (control = pct(t.progress))
    else if (t.status === 'failed') (note = bad('the download failed')), (control = linkBtn('Try again', () => h.post({ type: 'prepareTranslator' })))
    else note = started ? waiting('starting…') : item.note
  } else if (item.key === 'dictionary') {
    const d = v.dictionary.status
    if (d === 'ready') note = done('here')
    else if (d === 'downloading') note = waiting('coming…')
    else if (d === 'failed') (note = bad('the download failed')), (control = linkBtn('Try again', () => h.post({ type: 'prepareDictionary' })))
    else note = started ? waiting('starting…') : item.note
  } else if (item.key === 'voice') {
    const n = v.natural
    if (n.status === 'ready') note = done('here')
    else if (n.status === 'downloading') (note = bar(n.progress)), (control = pct(n.progress))
    else if (n.status === 'failed') (note = bad('the download failed')), (control = linkBtn('Try again', () => h.post({ type: 'downloadNatural' })))
    else note = started ? waiting('starting…') : item.note
  } else if (item.key === 'engine') {
    const p = s.pack
    if (p.status === 'installing') (note = el('span', {}, bar(p.progress ?? 0), el('small', {}, p.step === 'tool' ? 'the Python manager' : 'the packages · the window can be closed, it goes on'))), (control = pct(p.progress ?? 0))
    else if (installed(v) && !item.mb) note = done('here')
    else if (p.status === 'failed') (note = bad(p.message ?? 'the install failed')), (control = linkBtn('Try again', () => h.post({ type: 'installSpeech', parts: cost(choice ?? recommendedChoice(v), v).parts })))
    else note = started ? waiting('starting…') : item.note
  } else {
    const model = item.key.slice('model:'.length)
    const live = Object.values(s.health?.models ?? {}).find(m => m.name === model)
    if (item.mb === 0 || s.health?.downloaded?.includes(model)) note = done('here')
    else if (live?.state === 'downloading') (note = bar(live.progress ?? 0)), (control = pct(live.progress ?? 0))
    else note = started ? waiting(running(v) ? 'next' : 'after the speech engine') : item.note
  }
  const row = card(icon, item.label, [note, item.mb ? `${sizeText(item.mb)}` : null], control)
  return row
}

/** A chip for a line that is always on. */
export const always = () => chip('always on')
