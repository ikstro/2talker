// The card: one picked text or one snipped piece of the screen, in English
// on top and translated under it. Listen highlights the spoken sentence and
// word, from a cursor the arrows move; "one by one" reads a sentence and
// waits; each paragraph has its own play button in the margin. A click on an
// English word shows its meanings (Shift+hover too), and a click on a
// sentence marks its other side. The HTML of both halves arrives rendered
// from the main process. A text card holds a text read from the screen as it
// is: the person fixes it, copies it or translates it into any language.

import { hotkeyLabel } from '../hotkey'
import { findLanguage, labelCode, langCode, voiceMatches } from '../languages'
import { chosenNatural } from '../natural'
import type { CardKind, CardState, CardView, HostVoice, NaturalState, TextResult, ToHost, ToView, TranslationState, TutorHost, ViewConfig } from '../protocol'
import { el, html, icon } from './dom'
import { glyph } from './glyphs'
import { WordHover } from './hover'
import { Player } from './player'
import { markRare } from './rare'
import { canOpenSpeechSettings, voiceSteps } from './voices'

declare global {
  interface Window {
    tutorHost: TutorHost
  }
}

const post = (message: ToHost) => window.tutorHost.post(message)

const state = {
  card: undefined as CardView | undefined,
  config: { voice: '', rate: 1, wordHint: 'shift', rareWords: true, oneAtATime: false } as ViewConfig,
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
  /** The English sentence Listen starts from, and the first sentence of the reading under way (-1: a word, not the text). */
  cursor: 0,
  readFrom: -1,
  reading: '' as string,
  /** The text card whose text is in the field: later messages for it keep the person's edits and languages. */
  textId: -1,
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
    entered: index => {
      if (state.readFrom < 0) return
      state.cursor = state.readFrom + index
      markCursor()
    },
    // The whole text read through: Listen starts over. One by one, the cursor stays for a repeat.
    finished: () => {
      if (state.reading === 'card' && !state.config.oneAtATime) state.cursor = 0
      markCursor()
    },
  },
  () => updatePlayButtons(),
)

// ---------------------------------------------------------------- skeleton

/** The key that called the card, as lit keycaps ("Control+C*2": Ctrl C ×2); the function's name follows it. */
function viaKeys(via: string | undefined): HTMLElement | null {
  if (!via) return null
  const parts = via.split('+').filter(Boolean)
  const twice = parts.some(p => p.endsWith('*2'))
  const keys = parts.map(p => hotkeyLabel(p.replace(/\*2$/, '')))
  return el(
    'span',
    { class: 'via', title: `Opened by ${keys.join('+')}${twice ? ' twice' : ''}` },
    ...keys.map(k => el('span', { class: 'key lit' }, k)),
    twice ? el('span', { class: 'x2' }, '×2') : null,
  )
}

const root = document.getElementById('root') as HTMLDivElement

const kindLabel = el('span', { class: 'card-kind' })
const translationButton = el('button', { class: 'toggle', 'aria-pressed': 'true', onclick: () => toggleTranslation() }, 'RU')
const pinButton = el('button', { class: 'icon-btn', 'aria-pressed': 'false', onclick: () => togglePin() }, glyph('pin'))
const closeButton = el('button', { class: 'icon-btn', title: 'Close (Esc)', 'aria-label': 'Close', onclick: () => post({ type: 'close' }) }, glyph('close'))
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
const listenButton = el('button', { class: 'listen', 'data-play': 'message', 'data-key': 'card' }, glyph('play'), el('span', { class: 'listen-label' }, 'Listen'))
const prevButton = el('button', { class: 'icon-btn', title: 'Previous sentence (←)', 'aria-label': 'Previous sentence', onclick: () => step(-1) }, glyph('prev'))
const nextButton = el('button', { class: 'icon-btn', title: 'Next sentence (→)', 'aria-label': 'Next sentence', onclick: () => step(1) }, glyph('next'))
const oneButton = el('button', { class: 'chip', 'aria-pressed': 'false', onclick: () => toggleOneAtATime() }, 'One by one')
// The keyboard is the interface: Space's job, next to the buttons it stands for.
const spaceLabel = el('span', { class: 'kl' }, 'listen')
const spaceHint = el('span', { class: 'space-hint', 'aria-hidden': 'true' }, spaceLabel, el('span', { class: 'key' }, 'Space'))
const note = el('span', { class: 'status-line' })
const translation = el('div', { class: 'translation' })
const remote = el('div', { class: 'remote' }, prevButton, listenButton, nextButton, oneButton, spaceHint)
const article = el('article', { class: 'msg assistant' }, body, el('footer', { class: 'msg-foot' }, remote, note), translation)
const list = el('main', { class: 'list', hidden: true }, article)

/** After an edit, the text is translated again once typing pauses this long. */
const RETRANSLATE_MS = 700

// The translator: the text in a field (fixed by hand, as Windows misreads some letters), Copy, the two languages and Swap, the translation under them with Copy and Paste.
let retranslate: number | undefined
/** Paste was pressed while the translation was still coming: it is pasted once in. */
let pasteWhenReady = false
const textField = el('textarea', {
  class: 'text-field',
  rows: 2,
  spellcheck: 'false',
  dir: 'auto',
  'aria-label': 'The text',
  oninput: () => {
    fitTextField()
    updateTextButtons()
    pasteWhenReady = false
    window.clearTimeout(retranslate)
    retranslate = window.setTimeout(() => {
      retranslate = undefined
      translateText()
    }, RETRANSLATE_MS)
  },
  // Enter pastes, as a chat sends; Shift+Enter is a new line.
  onkeydown: event => {
    const key = event as KeyboardEvent
    if (key.key === 'Enter' && !key.shiftKey && canPaste()) {
      key.preventDefault()
      // An Enter held down repeats: it pastes once.
      if (!key.repeat) paste()
    }
  },
})
const textCopy = copyButton(() => textField.value)
const fromSelect = el('select', { 'aria-label': 'From', title: 'The language of the text', onchange: () => pickLanguage('from') })
const toSelect = el('select', { 'aria-label': 'Into', title: 'The language to translate into', onchange: () => pickLanguage('to') })
const swapButton = el('button', { class: 'swap-btn', title: 'Swap the languages: the translation becomes the text', onclick: () => swapLanguages() }, icon('arrow-swap'), el('span', {}, 'Swap'))
/** A list of languages drawn as a pill: the select itself, its arrow over it. */
const pill = (select: HTMLSelectElement) => el('span', { class: 'select-pill' }, select, icon('chevron-down'))
const textResult = el('div', { class: 'text-result', hidden: true })
// Nothing leaves the computer, and the card says so where the translation is made.
const textFoot = el('footer', { class: 'card-foot' })
const textView = el(
  'main',
  { class: 'text-view', hidden: true },
  textField,
  el(
    'div',
    { class: 'text-bar' },
    textCopy,
    el('span', { class: 'text-langs' }, pill(fromSelect), el('span', { class: 'to', 'aria-hidden': 'true' }, '→'), pill(toSelect), swapButton),
  ),
  textResult,
  textFoot,
)
const hint = el('div', { class: 'toast', role: 'status', hidden: true })

root.append(header, voiceBanner, stateView, list, textView, hint)

const hover = new WordHover({
  host: root,
  area: list,
  post,
  // A text card's words are the person's to fix: no word card.
  blocked: () => state.card?.state.status === 'text',
  nativeName: () => state.card?.native ?? 'your language',
  mode: () => state.config.wordHint,
  // A word alone, read by the same voice as the text; the text's reading stops for it.
  speak: word => {
    state.readFrom = -1
    state.reading = 'word'
    if (!hasVoice() || !player.play('word', [el('span', {}, word)])) noVoiceHint()
  },
})

function markRareWords(): void {
  markRare(body, state.common, state.config.rareWords)
}

// The window is as tall as the card's content, with the page's border above and below.
new ResizeObserver(() => post({ type: 'height', px: Math.ceil(document.body.getBoundingClientRect().height) + 2 })).observe(document.body)
// A wider or narrower card wraps the field's lines anew.
window.addEventListener('resize', () => fitTextField())

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
    state.card?.kind !== 'text' &&
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

/** The header's name for the card: its function, and the screen when the text was read from it. */
const KINDS: Record<CardKind, [string, string?]> = {
  selection: ['Listen'],
  screenshot: ['Listen', 'screen'],
  translate: ['Translate'],
  text: ['Translate', 'screen'],
}

/** The translator's kinds: the text as it is, with its translation. */
const translator = (c: CardView | undefined) => c?.kind === 'translate' || c?.kind === 'text'

function renderChrome(): void {
  const c = state.card
  const [kindName, source] = KINDS[c?.kind ?? 'selection']
  kindLabel.replaceChildren(viaKeys(c?.via) ?? '', el('span', { class: 'kind-name' }, kindName, source ? el('span', { class: 'kind-source' }, ` · ${source}`) : null))
  // The translator has no translation under an English text to hide.
  translationButton.hidden = translator(c)
  translationButton.textContent = labelCode(c?.native)
  translationButton.setAttribute('aria-pressed', String(state.showTranslation))
  translationButton.title = state.showTranslation ? `Hide the ${c?.native ?? ''} translation` : `Show the ${c?.native ?? ''} translation`
  pinButton.setAttribute('aria-pressed', String(state.pinned))
  pinButton.title = state.pinned ? 'Unpin: close when another window is clicked' : 'Pin: keep open'
  document.body.classList.toggle('no-translation', !state.showTranslation)
  oneButton.setAttribute('aria-pressed', String(state.config.oneAtATime))
  oneButton.title = state.config.oneAtATime ? 'Listen reads one sentence and waits; ← → step' : 'Read one sentence at a time'
  document.body.classList.toggle('no-voice', !hasVoice())
  renderVoiceBanner()
  updatePlayButtons()
}

function status(text: string): HTMLElement {
  return el('p', { class: 'empty-text status-line' }, icon('loading', 'codicon-modifier-spin'), text)
}

/** A first use: the translator for a pair comes once, with how much of it is in and what happens meanwhile. */
function downloading(pair: string, progress: number, size: number, meanwhile = ''): HTMLElement {
  const done = Math.min(1, Math.max(0, progress))
  const bar = el('i')
  bar.style.width = `${(done * 100).toFixed(1)}%`
  return el(
    'div',
    { class: 'download', role: 'status' },
    el('div', { class: 'kl' }, 'first use · once'),
    el('div', { class: 'download-head' }, el('b', {}, `Translator, ${pair}`), el('span', { class: 'kl' }, `${(done * size).toFixed(1)} of ${size} MB`)),
    el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(done * 100) }, bar),
    el('p', {}, `Downloads once from Mozilla, then translates on this computer.${meanwhile ? ' ' + meanwhile : ''}`),
  )
}

function failed(message: string, retry: () => void = () => post({ type: 'retry' })): HTMLElement[] {
  return [
    el('p', { class: 'empty-title' }, 'Not translated'),
    el('p', { class: 'empty-text' }, message),
    el('p', {}, el('button', { class: 'primary-btn', onclick: () => retry() }, 'Try again')),
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
      translation.replaceChildren(downloading(`${c.native} ⇄ English`, t.progress, t.size, 'The English is read meanwhile.'))
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
  const text = s?.status === 'text'
  list.hidden = !done
  textView.hidden = !text
  stateView.hidden = done || text || !s
  if (!c || !s) return
  if (s.status === 'text') {
    renderText(c, s)
    return
  }
  if (s.status === 'done') {
    // The English stays as it is while its translation comes in: the voice reads on.
    if (state.shownId !== c.id || body.dataset.html !== s.html) {
      if (player.reads(body)) player.stop()
      body.replaceChildren(html(s.html))
      body.dataset.html = s.html
      addParagraphButtons()
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
      stateView.replaceChildren(downloading(`${c.native} ⇄ English`, s.progress, s.size))
      return
    case 'empty':
      stateView.replaceChildren(
        el('p', { class: 'empty-title' }, 'No text here'),
        el('p', { class: 'empty-text' }, 'The piece of the screen holds no text Altype can read. Snip a piece with words in it.'),
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

// ---------------------------------------------------------------- text card

function languageName(code: string): string {
  return findLanguage(code)?.name ?? code.toUpperCase()
}

/**
 * A text card. The field and the two languages are filled once per card: a
 * later message for it (the translation coming in) keeps what the person
 * typed, the caret and the languages picked. The result follows the state.
 */
function renderText(c: CardView, s: Extract<CardState, { status: 'text' }>): void {
  if (state.textId !== c.id) {
    state.textId = c.id
    lastOut = undefined
    pasteWhenReady = false
    window.clearTimeout(retranslate)
    retranslate = undefined
    textField.value = s.text
    fillLanguages(s.languages, s.from, s.to)
    textField.lang = fromSelect.value
    delete textResult.dataset.key
    hover.hide()
    window.scrollTo({ top: 0 })
  }
  state.shownId = c.id
  renderTextResult(s.result, !!s.canPaste)
  textFoot.textContent = s.canPaste ? 'Translated on this computer · Shift+Enter, a new line' : 'Translated on this computer'
  // Said under a translation, or one on its way; not under nothing, or a failure.
  textFoot.hidden = s.result.status === 'none' || s.result.status === 'failed'
  fitTextField()
  updateTextButtons()
}

/** Both lists by name; a code the list lacks falls back to English. */
function fillLanguages(codes: string[], from: string, to: string): void {
  const sorted = [...codes].sort((a, b) => languageName(a).localeCompare(languageName(b)))
  const fallback = codes.includes('en') ? 'en' : (sorted[0] ?? '')
  for (const [select, code] of [
    [fromSelect, from],
    [toSelect, to],
  ] as const) {
    select.replaceChildren(...sorted.map(c => el('option', { value: c }, languageName(c))))
    select.value = codes.includes(code) ? code : fallback
    select.dataset.was = select.value
  }
}

/** A language picked on one side: if the other side had it, the two swap. Once a translation was asked for, it follows at once. */
function pickLanguage(side: 'from' | 'to'): void {
  const [changed, other] = side === 'from' ? [fromSelect, toSelect] : [toSelect, fromSelect]
  if (other.value === changed.value && changed.dataset.was) other.value = changed.dataset.was
  fromSelect.dataset.was = fromSelect.value
  toSelect.dataset.was = toSelect.value
  textField.lang = fromSelect.value
  const s = state.card?.state
  if (s?.status === 'text' && s.result.status !== 'none') translateText()
}

/**
 * The two languages change places, as in DeepL: a translation in, it becomes
 * the text, translated back; else the text is translated the other way.
 */
function swapLanguages(): void {
  const s = state.card?.state
  ;[fromSelect.value, toSelect.value] = [toSelect.value, fromSelect.value]
  fromSelect.dataset.was = fromSelect.value
  toSelect.dataset.was = toSelect.value
  textField.lang = fromSelect.value
  if (s?.status === 'text' && s.result.status === 'ready') {
    textField.value = s.result.text
    fitTextField()
    updateTextButtons()
  }
  translateText()
}

/** The text as it stands in the field, maybe fixed by hand, from and into the languages picked. */
function translateText(): void {
  const c = state.card
  if (!c || !textField.value.trim()) return
  post({ type: 'translateText', id: c.id, text: textField.value, from: fromSelect.value, to: toSelect.value })
}

/** The card's last translation: shown faded while a newer one comes, so editing the text does not blank it. */
let lastOut: { text: string; to: string } | undefined

/** The translation with Copy, and Paste when it came from a selection; `ready`: Paste may be pressed. */
function outBlock(out: { text: string; to: string }, canPaste: boolean, ready: boolean): HTMLElement[] {
  // Its key, Enter, is drawn on it by card.css, so the button's name stays "Paste".
  const pasteButton = el('button', { class: 'paste-btn', title: 'Paste over the selection (Enter)', disabled: !ready, onclick: () => paste() }, 'Paste')
  return [
    el('p', { class: `text-out${ready ? '' : ' stale'}`, lang: out.to, dir: 'auto' }, out.text),
    el('div', { class: 'text-bar' }, copyButton(() => out.text), canPaste ? el('span', { class: 'grow' }) : null, canPaste ? pasteButton : null),
  ]
}

/** Under the bar: what the translation is doing, or the translation with its own Copy and Paste. The same result is left as it is, so a selection in it stays. */
function renderTextResult(r: TextResult, canPaste: boolean): void {
  const key = JSON.stringify([r, canPaste])
  if (textResult.dataset.key === key) return
  textResult.dataset.key = key
  textResult.hidden = r.status === 'none'
  switch (r.status) {
    case 'none':
      textResult.replaceChildren()
      return
    case 'translating':
      textResult.replaceChildren(status('Translating…'), ...(lastOut ? outBlock(lastOut, canPaste, false) : []))
      return
    case 'downloading':
      textResult.replaceChildren(downloading(`${languageName(r.language)} ⇄ English`, r.progress, r.size))
      return
    case 'ready':
      lastOut = { text: r.text, to: r.to }
      textResult.replaceChildren(...outBlock(lastOut, canPaste, true))
      if (pasteWhenReady) {
        pasteWhenReady = false
        paste()
      }
      return
    case 'failed':
      textResult.replaceChildren(...failed(r.message, () => translateText()))
      return
  }
}

/** The field is as tall as its text, up to a limit (card.css) past which it scrolls. */
function fitTextField(): void {
  if (textView.hidden) return
  const y = window.scrollY
  textField.style.height = 'auto'
  textField.style.height = `${textField.scrollHeight + textField.offsetHeight - textField.clientHeight}px`
  window.scrollTo({ top: y })
}

/** An empty field has nothing to copy or translate. */
function updateTextButtons(): void {
  const empty = !textField.value.trim()
  textCopy.disabled = empty
  swapButton.disabled = empty
}

/** The translation, pasted over the selection it was made from; only once it is in. */
function canPaste(): boolean {
  const s = state.card?.state
  return s?.status === 'text' && !!s.canPaste
}

/**
 * The translation, pasted over the selection it was made from. One still
 * coming (or an edit not yet sent to be translated) is pasted once it is in.
 */
function paste(): void {
  const c = state.card
  const s = c?.state
  if (!c || s?.status !== 'text' || !s.canPaste) return
  if (retranslate !== undefined) {
    window.clearTimeout(retranslate)
    retranslate = undefined
    pasteWhenReady = true
    return translateText()
  }
  if (s.result.status === 'ready') return post({ type: 'pasteText', id: c.id, text: s.result.text })
  if (s.result.status === 'translating' || s.result.status === 'downloading') pasteWhenReady = true
}

function copyButton(text: () => string): HTMLButtonElement {
  return el('button', { class: 'quiet-btn', title: 'Copy', onclick: () => copy(text()) }, icon('copy'), el('span', {}, 'Copy'))
}

function copy(text: string): void {
  post({ type: 'copyText', text })
  showHint(['Copied'], 1500)
}

// ---------------------------------------------------------------- reading

/** The sentences the English voice reads: those with Latin letters; one left untranslated in another script is skipped. */
function englishSentences(): HTMLElement[] {
  return [...body.querySelectorAll<HTMLElement>('span.s')].filter(s => /\p{Script=Latin}/u.test(s.textContent ?? ''))
}

/** With two paragraphs or more, each gets a play button in the margin, outside its words. */
function addParagraphButtons(): void {
  const paragraphs = [...body.querySelectorAll<HTMLElement>(':scope > p')]
  const several = paragraphs.length > 1
  list.classList.toggle('paragraphs', several)
  if (!several) return
  paragraphs.forEach((p, i) =>
    p.prepend(
      el('button', { class: 'para-play', 'data-play': 'paragraph', 'data-key': `p:${i}`, title: 'Listen to this paragraph', 'aria-label': 'Listen to this paragraph' }, glyph('play')),
    ),
  )
}

/**
 * Starts reading `els`, the first being English sentence `from`; `asked`: the
 * person pressed a button. The sentence after the reading is made ahead, so a
 * step forward, or the next paragraph, starts at once.
 */
function read(key: string, els: HTMLElement[], from: number, asked: boolean): void {
  if (els.length === 0) return
  if (asked) {
    state.listened = true
    state.naturalJustReady = false
    renderVoiceBanner()
  }
  state.readFrom = from
  state.reading = key
  const after = englishSentences()[from + els.length]
  if (!hasVoice() || !player.play(key, els, { follow: true, ahead: after ? [after] : [] })) {
    if (asked) noVoiceHint()
  }
}

/** Listen: from the cursor to the end, or the cursor's sentence alone, one by one. */
function listen(asked = true): void {
  const all = englishSentences()
  if (all.length === 0) return
  state.cursor = Math.min(Math.max(0, state.cursor), all.length - 1)
  const at = all[state.cursor]
  read('card', state.config.oneAtATime && at ? [at] : all.slice(state.cursor), state.cursor, asked)
}

/** The previous or the next sentence, read at once. */
function step(by: number): void {
  const all = englishSentences()
  if (all.length === 0) return
  state.cursor = Math.min(Math.max(0, state.cursor + by), all.length - 1)
  markCursor()
  listen()
}

function readParagraph(p: Element | null): void {
  if (!p) return
  const all = englishSentences()
  const els = all.filter(s => p.contains(s))
  const first = els[0]
  if (first) read(`p:${[...body.querySelectorAll(':scope > p')].indexOf(p)}`, els, all.indexOf(first), true)
}

/** One by one, the sentence Listen reads next is marked. */
function markCursor(): void {
  for (const marked of body.querySelectorAll('span.s.at')) marked.classList.remove('at')
  if (state.config.oneAtATime) englishSentences()[state.cursor]?.classList.add('at')
}

function toggleOneAtATime(): void {
  state.config = { ...state.config, oneAtATime: !state.config.oneAtATime }
  post({ type: 'saveSettings', patch: { oneAtATime: state.config.oneAtATime } })
  renderChrome()
  markCursor()
}

/** A new translation is read once, when "Read aloud when a card opens" is on; a text card never reads by itself. */
function autoRead(c: CardView): void {
  if (!c.autoRead || translator(c) || state.readId === c.id) return
  state.readId = c.id
  state.cursor = 0
  listen(false)
}

function updatePlayButtons(): void {
  for (const button of root.querySelectorAll<HTMLElement>('[data-play]')) {
    const playing = player.key !== null && button.dataset.key === player.key
    button.classList.toggle('is-playing', playing)
    // Play turns into stop in place.
    const shape = button.querySelector<SVGSVGElement>('svg.glyph')
    if (shape && shape.dataset.shape !== (playing ? 'stop' : 'play')) shape.replaceWith(glyph(playing ? 'stop' : 'play'))
    const label = button.querySelector('.listen-label')
    if (label) label.textContent = playing ? 'Stop' : 'Listen'
    button.setAttribute('aria-label', playing ? 'Stop' : 'Listen')
    button.title = playing ? 'Stop' : 'Listen'
  }
  spaceLabel.textContent = player.key === 'card' ? 'stop' : 'listen'
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
    if (player.key === key) player.stop()
    else if (playButton.dataset.play === 'paragraph') readParagraph(playButton.closest('p'))
    else listen()
    return
  }
  const sentence = target.closest<HTMLElement>('span.s, span.t')
  markPair(sentence && list.contains(sentence) ? sentence.dataset.i : undefined)
  hover.showAt(event.clientX, event.clientY)
})

// Esc puts the card away, and the voice with it. Space plays or stops, the arrows step through the sentences.
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') return post({ type: 'close' })
  // Enter in the translator pastes; a button or a list of languages keeps its own Enter, the text field has its own.
  if (event.key === 'Enter' && !event.shiftKey && canPaste()) {
    if (event.target instanceof Element && event.target.closest('button, select, textarea')) return
    event.preventDefault()
    if (!event.repeat) paste()
    return
  }
  if (list.hidden || event.ctrlKey || event.altKey || event.metaKey) return
  if (event.target instanceof Element && event.target.closest('button, input, select, textarea')) return
  if (event.key === ' ') {
    event.preventDefault()
    if (player.key === 'card') player.stop()
    else listen()
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    step(event.key === 'ArrowLeft' ? -1 : 1)
  }
})

for (const kind of ['wheel', 'touchmove']) window.addEventListener(kind, () => player.userScrolled(), { passive: true })

// ---------------------------------------------------------------- messages

window.addEventListener('message', (event: MessageEvent<ToView>) => {
  if (event.source !== window) return
  const m = event.data
  switch (m.type) {
    case 'card': {
      const changedPair = state.card !== undefined && state.card.native !== m.card.native
      // A new text: whatever was being read stops, and Listen starts from the top.
      if (state.card && state.card.id !== m.card.id) {
        player.stop()
        state.cursor = 0
      }
      state.card = m.card
      state.config = m.config
      state.pinned = m.pinned
      if (changedPair) hover.forget()
      renderChrome()
      renderState()
      markRareWords()
      markCursor()
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
