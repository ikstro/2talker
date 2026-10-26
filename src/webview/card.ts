// The card: one picked text or one snipped piece of the screen, in English
// on top and translated under it. Listen highlights the spoken sentence and
// word; a click on an English word shows its meanings (Shift+hover too), and
// a click on a sentence marks its other side. The HTML of both halves
// arrives rendered from the main process.

import { labelCode, langCode, voiceMatches } from '../languages'
import { chosenNatural } from '../natural'
import type { CardView, HostVoice, NaturalState, ToHost, ToView, TranslationState, ViewConfig } from '../protocol'
import { el, html, icon, setIcon } from './dom'
import { WordHover } from './hover'
import { Player } from './player'
import { markRare } from './rare'
import { canOpenSpeechSettings, voiceSteps } from './voices'

declare global {
  interface Window {
    tutorHost: { post(message: ToHost): void }
  }
}

const post = (message: ToHost) => window.tutorHost.post(message)

const state = {
  card: undefined as CardView | undefined,
  config: { voice: '', rate: 1, wordHint: 'shift', rareWords: true } as ViewConfig,
  /** The most common English words: the others get a dotted line. */
  common: new Set<string>(),
  pinned: false,
  /** The translation under the English; the native-language button hides it. */
  showTranslation: true,
  hostVoices: undefined as HostVoice[] | undefined,
  hostCanSpeak: false,
  platform: '',
  webVoices: [] as SpeechSynthesisVoice[],
  natural: undefined as NaturalState | undefined,
  /** The person pressed Listen: the natural voice is offered from then on. */
  listened: false,
  naturalJustReady: false,
  /** The card whose text is on screen, and the last one read aloud by itself. */
  shownId: -1,
  readId: -1,
}

// ---------------------------------------------------------------- voices

function targetCode(): string {
  return langCode(state.card?.target ?? 'English')
}

function webVoice(): SpeechSynthesisVoice | undefined {
  const named = state.config.voice ? state.webVoices.find(v => v.name === state.config.voice) : undefined
  if (named) return named
  if (state.config.voice && state.hostVoices?.some(v => v.name === state.config.voice)) return undefined
  const matching = state.webVoices.filter(v => voiceMatches(v.lang, targetCode()))
  return matching.find(v => v.localService) ?? matching[0]
}

function hasVoice(): boolean {
  const code = targetCode()
  if (code === 'en' && state.natural?.status === 'ready') return true
  if (state.webVoices.some(v => voiceMatches(v.lang, code))) return true
  if (state.hostVoices === undefined) return true
  return state.hostCanSpeak && state.hostVoices.some(v => voiceMatches(v.lang, code))
}

function naturalVoice(): string | undefined {
  if (targetCode() !== 'en' || state.natural?.status !== 'ready') return undefined
  return chosenNatural(state.config.voice)?.id
}

// Chromium starts audio on a gesture unless told otherwise; the main process tells it otherwise.
let audioOut: AudioContext | undefined
function openAudio(): AudioContext | undefined {
  if (!audioOut) {
    try {
      audioOut = new AudioContext({ sampleRate: 24_000 })
    } catch {
      return undefined
    }
  }
  if (audioOut.state === 'suspended') void audioOut.resume()
  return audioOut
}

const player = new Player(
  post,
  {
    lang: () => targetCode(),
    voice: webVoice,
    rate: () => state.config.rate,
    hostCanSpeak: () => state.hostCanSpeak,
    natural: naturalVoice,
    audio: () => openAudio(),
    naturalFailed: message => showHint([`The natural voice stopped (${message}). A system voice reads on.`], 10_000),
  },
  () => updatePlayButtons(),
)

// ---------------------------------------------------------------- skeleton

const root = document.getElementById('root') as HTMLDivElement

const kindLabel = el('span', { class: 'card-kind' })
const translationButton = el('button', { class: 'toggle', 'aria-pressed': 'true', onclick: () => toggleTranslation() }, 'RU')
const pinButton = el('button', { class: 'icon-btn', 'aria-pressed': 'false', onclick: () => togglePin() }, icon('pin'))
const closeButton = el('button', { class: 'icon-btn', title: 'Close (Esc)', 'aria-label': 'Close', onclick: () => post({ type: 'close' }) }, icon('close'))
const header = el('header', { class: 'bar' }, kindLabel, el('span', { class: 'grow' }), translationButton, pinButton, closeButton)

const voiceText = el('span', { class: 'banner-text' })
const voiceButton = el('button', { class: 'primary-btn', onclick: () => downloadNatural() })
const voiceClose = el(
  'button',
  {
    class: 'icon-btn',
    title: 'Not now',
    'aria-label': 'Not now',
    onclick: () => {
      if (state.natural?.status === 'ready') state.naturalJustReady = false
      else post({ type: 'dismissNatural' })
      renderVoiceBanner()
    },
  },
  icon('close'),
)
const voiceBanner = el('div', { class: 'banner voice-banner', hidden: true }, voiceText, voiceButton, voiceClose)

const stateView = el('div', { class: 'empty', hidden: true })
const body = el('div', { class: 'body' })
const listenButton = el('button', { class: 'listen', 'data-play': 'message', 'data-key': 'card' }, icon('play'), el('span', { class: 'listen-label' }, 'Listen'))
const note = el('span', { class: 'status-line' })
const translation = el('div', { class: 'translation' })
const article = el('article', { class: 'msg assistant' }, body, el('footer', { class: 'msg-foot' }, listenButton, note), translation)
const list = el('main', { class: 'list', hidden: true }, article)
const hint = el('div', { class: 'toast', role: 'status', hidden: true })

root.append(header, voiceBanner, stateView, list, hint)

const hover = new WordHover({
  host: root,
  area: list,
  post,
  blocked: () => false,
  nativeName: () => state.card?.native ?? 'your language',
  mode: () => state.config.wordHint,
  // A word alone, read by the same voice as the text; the text's reading stops for it.
  speak: word => {
    if (!hasVoice() || !player.play('word', [el('span', {}, word)])) noVoiceHint()
  },
})

function markRareWords(): void {
  markRare(body, state.common, state.config.rareWords)
}

// The window is as tall as the card's content, with the page's border above and below.
new ResizeObserver(() => post({ type: 'height', px: Math.ceil(document.body.getBoundingClientRect().height) + 2 })).observe(document.body)

// ---------------------------------------------------------------- rendering

function downloadNatural(): void {
  if (state.natural) state.natural = { ...state.natural, status: 'downloading', progress: 0 }
  post({ type: 'downloadNatural' })
  renderVoiceBanner()
}

function renderVoiceBanner(): void {
  const n = state.natural
  const shown =
    !!n &&
    n.status !== 'unsupported' &&
    targetCode() === 'en' &&
    (n.status === 'ready' ? state.naturalJustReady : n.status === 'downloading' || (state.listened && !n.dismissed))
  voiceBanner.hidden = !shown
  if (!shown || !n) return
  voiceButton.hidden = n.status !== 'absent' && n.status !== 'failed'
  voiceClose.hidden = n.status === 'downloading'
  switch (n.status) {
    case 'absent':
      voiceText.textContent = 'A natural voice sounds like a real person and reads offline.'
      voiceButton.textContent = `Download · ${n.size} MB`
      return
    case 'failed':
      voiceText.textContent = 'The natural voice did not download.'
      voiceButton.textContent = 'Retry'
      return
    case 'downloading':
      voiceText.textContent = `Downloading the natural voice… ${Math.round(n.progress * 100)}%`
      return
    case 'ready':
      voiceText.textContent = 'The natural voice is ready. Press Listen to hear it.'
      return
  }
}

function renderChrome(): void {
  const c = state.card
  kindLabel.replaceChildren(
    icon(c?.kind === 'screenshot' ? 'device-camera' : 'copy'),
    el('span', {}, c?.kind === 'screenshot' ? 'From the screen' : 'Selected text'),
  )
  translationButton.textContent = labelCode(c?.native)
  translationButton.setAttribute('aria-pressed', String(state.showTranslation))
  translationButton.title = state.showTranslation ? `Hide the ${c?.native ?? ''} translation` : `Show the ${c?.native ?? ''} translation`
  pinButton.setAttribute('aria-pressed', String(state.pinned))
  pinButton.title = state.pinned ? 'Unpin: close when another window is clicked' : 'Pin: keep open'
  setIcon(pinButton.querySelector('.codicon'), state.pinned ? 'pinned' : 'pin')
  document.body.classList.toggle('no-translation', !state.showTranslation)
  document.body.classList.toggle('no-voice', !hasVoice())
  renderVoiceBanner()
  updatePlayButtons()
}

function status(text: string): HTMLElement {
  return el('p', { class: 'empty-text status-line' }, icon('loading', 'codicon-modifier-spin'), text)
}

function downloading(c: CardView, progress: number, size: number): HTMLElement {
  return status(`Downloading the translator for English and ${c.native}, once… ${Math.round(progress * 100)}% of ${size} MB`)
}

function failed(message: string): HTMLElement[] {
  return [
    el('p', { class: 'empty-title' }, 'Not translated'),
    el('p', { class: 'empty-text' }, message),
    el('p', {}, el('button', { class: 'primary-btn', onclick: () => post({ type: 'retry' }) }, 'Try again')),
  ]
}

/** The lower half; the same translation is left as it is, so a mark on it stays. */
function renderTranslation(c: CardView, t: TranslationState): void {
  if (t.status === 'ready') {
    if (translation.dataset.html === t.html) return
    translation.replaceChildren(html(t.html))
    translation.dataset.html = t.html
    return
  }
  delete translation.dataset.html
  switch (t.status) {
    case 'translating':
      translation.replaceChildren(status('Translating…'))
      return
    case 'downloading':
      translation.replaceChildren(downloading(c, t.progress, t.size))
      return
    case 'failed':
      translation.replaceChildren(...failed(t.message))
      return
  }
}

function renderState(): void {
  const c = state.card
  const s = c?.state
  const done = s?.status === 'done'
  list.hidden = !done
  stateView.hidden = done || !s
  if (!c || !s) return
  if (s.status === 'done') {
    // The English stays as it is while its translation comes in: the voice reads on.
    if (state.shownId !== c.id || body.dataset.html !== s.html) {
      if (player.reads(body)) player.stop()
      body.replaceChildren(html(s.html))
      body.dataset.html = s.html
      hover.refresh()
    }
    renderTranslation(c, s.translation)
    note.textContent = s.note ?? ''
    note.hidden = !s.note
    if (state.shownId !== c.id) window.scrollTo({ top: 0 })
    state.shownId = c.id
    autoRead(c)
    return
  }
  state.shownId = c.id
  switch (s.status) {
    case 'reading':
      stateView.replaceChildren(status('Reading the text on the screen…'))
      return
    case 'translating':
      stateView.replaceChildren(status('Translating…'))
      return
    case 'downloading':
      stateView.replaceChildren(downloading(c, s.progress, s.size))
      return
    case 'empty':
      stateView.replaceChildren(
        el('p', { class: 'empty-title' }, 'No text here'),
        el('p', { class: 'empty-text' }, 'The piece of the screen holds no text 2Talker can read. Snip a piece with words in it.'),
      )
      return
    case 'no-ocr':
      stateView.replaceChildren(
        el('p', { class: 'empty-title' }, 'Windows cannot read text yet'),
        el(
          'p',
          { class: 'empty-text' },
          `Add text recognition for ${c.native} or English: Settings → Time & language → Language & region → the language → Language options → Optical character recognition.`,
        ),
        el('p', {}, el('button', { class: 'primary-btn', onclick: () => post({ type: 'openLanguageSettings' }) }, 'Open language settings')),
      )
      return
    case 'failed':
      stateView.replaceChildren(...failed(s.message))
      return
  }
}

/** A new translation is read once, when "Read aloud when a card opens" is on. */
function autoRead(c: CardView): void {
  if (!c.autoRead || state.readId === c.id) return
  state.readId = c.id
  if (hasVoice()) player.play('card', [...body.querySelectorAll<HTMLElement>('span.s')], { follow: true })
}

function updatePlayButtons(): void {
  for (const button of root.querySelectorAll<HTMLElement>('[data-play]')) {
    const playing = player.key !== null && button.dataset.key === player.key
    button.classList.toggle('is-playing', playing)
    setIcon(button.querySelector('.codicon'), playing ? 'debug-stop' : 'play')
    const label = button.querySelector('.listen-label')
    if (label) label.textContent = playing ? 'Stop' : 'Listen'
    button.setAttribute('aria-label', playing ? 'Stop' : 'Listen')
    button.title = playing ? 'Stop' : 'Listen'
  }
}

// ---------------------------------------------------------------- interaction

function toggleTranslation(): void {
  state.showTranslation = !state.showTranslation
  renderChrome()
}

function togglePin(): void {
  state.pinned = !state.pinned
  post({ type: 'pin', on: state.pinned })
  renderChrome()
}

let hintTimer: number | undefined
function showHint(content: (Node | string)[], ms = 6000): void {
  hint.replaceChildren(...content)
  hint.hidden = false
  window.clearTimeout(hintTimer)
  hintTimer = window.setTimeout(() => (hint.hidden = true), ms)
}

function noVoiceHint(): void {
  const target = state.card?.target ?? 'English'
  showHint(
    [
      `No ${target} voice on this computer. ${voiceSteps(target, state.platform)} `,
      canOpenSpeechSettings(state.platform)
        ? el('button', { class: 'link', onclick: () => post({ type: 'openSpeechSettings' }) }, 'Open speech settings')
        : '',
    ],
    15_000,
  )
}

/** Marks sentence `i` in both halves, the English and its other side; undefined clears the mark. */
function markPair(i: string | undefined): void {
  for (const marked of list.querySelectorAll('.pair')) marked.classList.remove('pair')
  if (i !== undefined) for (const side of list.querySelectorAll(`[data-i="${i}"]`)) side.classList.add('pair')
}

root.addEventListener('click', event => {
  const target = event.target as HTMLElement
  // The word card's own buttons.
  if (target.closest('.word-card')) return
  const playButton = target.closest<HTMLElement>('[data-play]')
  if (playButton) {
    event.stopPropagation()
    const key = playButton.dataset.key ?? ''
    if (player.key === key) {
      player.stop()
      return
    }
    state.listened = true
    state.naturalJustReady = false
    renderVoiceBanner()
    if (!hasVoice() || !player.play(key, [...body.querySelectorAll<HTMLElement>('span.s')], { follow: true })) noVoiceHint()
    return
  }
  const sentence = target.closest<HTMLElement>('span.s, span.t')
  markPair(sentence && list.contains(sentence) ? sentence.dataset.i : undefined)
  hover.showAt(event.clientX, event.clientY)
})

// Esc puts the card away, and the voice with it.
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') post({ type: 'close' })
})

for (const kind of ['wheel', 'touchmove']) window.addEventListener(kind, () => player.userScrolled(), { passive: true })

// ---------------------------------------------------------------- messages

window.addEventListener('message', (event: MessageEvent<ToView>) => {
  if (event.source !== window) return
  const m = event.data
  switch (m.type) {
    case 'card': {
      const changedPair = state.card !== undefined && state.card.native !== m.card.native
      // A new text: whatever was being read stops.
      if (state.card && state.card.id !== m.card.id) player.stop()
      state.card = m.card
      state.config = m.config
      state.pinned = m.pinned
      if (changedPair) hover.forget()
      renderChrome()
      renderState()
      markRareWords()
      updatePlayButtons()
      return
    }
    case 'gloss':
      hover.onGloss(m)
      return
    case 'ipa':
      hover.onIpa(m.word, m.ipa)
      return
    case 'saved':
      hover.onSaved(m.word, m.saved)
      return
    case 'common':
      state.common = new Set(m.words)
      markRareWords()
      return
    case 'app':
      return
    case 'dictReady':
      hover.forget()
      return
    case 'hostVoices':
      state.hostVoices = m.voices
      state.hostCanSpeak = m.canSpeak
      state.platform = m.platform
      renderChrome()
      return
    case 'progress':
      player.onHostProgress(m.id, m.pos, m.len)
      return
    case 'speakDone':
      player.onHostDone(m.id)
      return
    case 'stop':
      player.stop()
      return
    case 'natural': {
      const was = state.natural
      if (was?.status === 'downloading' && m.state.status === 'ready') state.naturalJustReady = true
      state.natural = m.state
      renderChrome()
      return
    }
    case 'naturalAudio':
      player.onNaturalAudio(m.id, m.index, m.samples, m.words)
      return
    case 'naturalFailed':
      player.onNaturalFailed(m.id, m.message)
      return
  }
})

if ('speechSynthesis' in window) {
  const refresh = () => {
    state.webVoices = window.speechSynthesis.getVoices()
    renderChrome()
  }
  refresh()
  window.speechSynthesis.addEventListener('voiceschanged', refresh)
}

post({ type: 'ready' })
