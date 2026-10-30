// The app window, Krya's back office. A sidebar holds every place in groups
// (Home; the actions; the library; the person's lists; Krya itself), the
// open one lit, and a search over every line of every page. The bar over the
// content says where the person is (a second-level page as a crumb), carries
// the action's keys, Back, and the window's buttons. Home comes first, always:
// one line that shows what Krya does (on the first opening it plays as a
// moment: a word typed in the wrong layout is fixed, translated and read
// aloud, each step lighting the person's own key; then the line rises into
// Home's head and the keys drop into their actions), whether the translator
// and the voice are here, and the actions with their keys. Back and Esc go
// back through the places visited, as a browser does (from a transcript, to
// the library first). Everything shown comes from the main process in one
// `app` message, sent again whenever any of it changes; every change goes back
// as a message.

import { NATURAL_PREFIX, NATURAL_VOICES, naturalLabel } from '../natural'
import { DOUBLE_MS, HotkeyRecorder, hotkeyLabel, type Recorded } from '../hotkey'
import type { AppTab, AppView, DiffPart, KeyboardLayout, MistakeEntry, SavedWord, Settings, StorageId, StoragePart, StorageView, ToView, TutorHost } from '../protocol'
import { LANGUAGES } from '../languages'
import { translationAdvice, type LevelFit } from '../hardware'
import { DEFAULTS, keptForm, LEVEL_NAMES, myLanguages, RATES, type AppRule, type LlmModel, type ThemeMode, type TranslationLevel } from '../settings'
import type { AppPart } from '../typist'
import { parseEntry } from '../vocabulary'
import { changesOf, wordDiff } from '../worddiff'
import { logo, tile } from './brand'
import { el, icon, setIcon } from './dom'
import { glyph } from './glyphs'
import { caps, COPY_TWICE } from './keycaps'
import { lucide, type LucideName } from './lucide'
import { aside, bad, bar, btn, card, chip, grp, ib, link, linkBtn, listPage, liveField, navCard, post, row, seg, select, toggle, toggleCard, toggleKnob, warn } from './ui'
import { seconds } from '../speechplan'
import { resetSetup, setupNodes } from './setup'
import { api, cardNote, computerRows, DEVICE_NAMES, diarizationOf, engineRows, engineSettings, fault, forgetEngine, hasPart, installed, modelRows, onRedraw, pickKb, running, saveEngine, size as speechSize, speakerRows, testOffer, toast } from './speech'
import { backToList, enterTranscripts, leaveTranscripts, newRows, openTranscript, setTranscriptHooks, transcriptsBody, transcriptsCap } from './transcripts'

declare global {
  interface Window {
    tutorHost: TutorHost
  }
}

const save = (patch: Partial<Settings>) => post({ type: 'saveSettings', patch })
/** Where new versions are: downloaded by hand, nothing installs itself (main.ts LINKS has it). */
const RELEASES = 'https://github.com/ikstro/krya/releases'

type Action = 'listen' | 'translate' | 'check' | 'screen' | 'dictate' | 'transcribe' | 'keyboard'
type Page = Action | 'words' | 'mistakes' | 'transcripts' | 'translations' | 'phrases' | 'vocabulary' | 'kept' | 'learned' | 'programs' | 'layouts' | 'settings' | 'engine' | 'storage' | 'computer' | 'about' | 'search'

const ACTIONS: readonly Action[] = ['listen', 'translate', 'check', 'screen', 'dictate', 'transcribe', 'keyboard']
const isAction = (name: Page): name is Action => (ACTIONS as readonly string[]).includes(name)
/** Each action's icon, on its Home card and its page. */
const ICONS: Record<Action, LucideName> = { listen: 'volume-2', translate: 'languages', check: 'graduation-cap', screen: 'scan', dictate: 'mic', transcribe: 'audio-lines', keyboard: 'keyboard' }
const TITLES: Record<Page, string> = {
  listen: 'Listen',
  translate: 'Translate',
  check: 'Check',
  screen: 'Screen',
  dictate: 'Dictate',
  transcribe: 'Transcribe',
  keyboard: 'Keyboard',
  words: 'Words',
  mistakes: 'Mistakes',
  transcripts: 'Transcripts',
  translations: 'Translations',
  phrases: 'Phrases',
  vocabulary: 'Words to spell',
  kept: 'Kept as typed',
  learned: 'Learned words',
  programs: 'Programs',
  layouts: 'Layouts',
  settings: 'Settings',
  engine: 'Speech engine',
  storage: 'Storage',
  computer: 'This computer',
  about: 'About',
  search: 'Search',
}

let view: AppView | undefined
/** A place asked for before the first `app` message. */
let askedTab: AppTab | undefined
/** A transcript asked for before the first `app` message. */
let askedTranscript = ''
let search = ''
/** What is typed in the sidebar's search: the Search page lists every line that has it. */
let finding = ''
/** Why the last key recorded was not kept: by the setting's name, or a layout's id. */
let keyTrouble: { name: string; text: string } | undefined
/** The program whose page is open (Keyboard › Programs › one of them). */
let programOpen = ''
/** The programs with a window open now, asked when the Programs page opens. */
let runningApps: string[] = []

const reduced = matchMedia('(prefers-reduced-motion: reduce)')
// #t= freezes the moment at a time (seconds), for pictures of it, the way the
// design's own frames were made.
const frozenAt = (name: string) => {
  const m = new RegExp(`(?:^#|&)${name}=([\\d.]+)`).exec(location.hash)
  return m ? parseFloat(m[1] as string) : undefined
}
const FROZEN_T = frozenAt('t')

// ---------------------------------------------------------------- motion

const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const prog = (t: number, a: number, b: number) => clamp((t - a) / (b - a))
const lerp = (a: number, b: number, p: number) => a + (b - a) * p
/** A spring with a small overshoot (about 5 %), settled at 1. */
const spring = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-8 * x) * (Math.cos(8.5 * x) + (8 / 8.5) * Math.sin(8.5 * x)))
/** A livelier one for the play button (about 12 %). */
const pop = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-6.5 * x) * Math.cos(10 * x))

type Box = { x: number; y: number; w: number; h: number }

const root = document.getElementById('root') as HTMLDivElement
/** The column right of the sidebar: the bar, then Home or a page; the moment plays over it. */
const mainCol = el('section', { class: 'main' })

/** Where a node is, in the content column. */
function rel(node: Element): Box {
  const w = mainCol.getBoundingClientRect()
  const b = node.getBoundingClientRect()
  return { x: b.left - w.left, y: b.top - w.top, w: b.width, h: b.height }
}

const fontOf = (node: Element) => parseFloat(getComputedStyle(node).fontSize) || 16

// ---------------------------------------------------------------- keys

/** The person's line for the moment: a word typed in the wrong layout and the same keys in theirs. */
type Sample = { typed: string; fixed: string; from: string; to: string }
const SAMPLES: Record<string, Sample> = {
  Russian: { typed: 'ghbdtn vbh', fixed: 'привет мир', from: 'EN', to: 'RU' },
  Ukrainian: { typed: 'ghbdsn cdsn', fixed: 'привіт світ', from: 'EN', to: 'UK' },
}
// The fix only means something between Latin and Cyrillic layouts; other languages see the Russian line.
const sampleOf = (native: string): Sample => SAMPLES[native] ?? (SAMPLES.Russian as Sample)

/** A hotkey in a sentence: "Ctrl + C twice", "Left Ctrl twice", "Ctrl+Alt+T". */
const said = (hotkey: string) => (hotkey === COPY_TWICE ? 'Ctrl + C twice' : hotkeyLabel(hotkey))
/** How a key is used, in a few words: a modifier alone is tapped, anything else pressed. */
const usage = (hotkey: string) => `${/^(Left|Right)(Control|Shift|Alt|Super)(\*2)?$/.test(hotkey) ? 'tap' : 'press'} ${said(hotkey)}`

/** The Chrome extension's key for recording a meeting (extension/manifest.json). */
const MEET_KEY = 'Alt+Shift+M'

type KeyLine = { label: string; hotkey: string; chain?: 'listen' | 'translate' | 'fix' }

/** The keys an action shows by its name, the person's own; the chain marks the three the moment lights. */
function keyLines(action: Action, s: Settings): KeyLine[] {
  switch (action) {
    case 'listen':
      // One action: its key, else Ctrl+C twice.
      return [{ label: 'selection', hotkey: s.selectKey || (s.doubleCopy ? COPY_TWICE : ''), chain: 'listen' }]
    case 'translate':
      return [
        { label: 'selection', hotkey: s.translateKey, chain: 'translate' },
        ...(s.typeKey ? [{ label: 'type', hotkey: s.typeKey }] : []),
        { label: 'paste back', hotkey: 'Enter' },
      ]
    case 'check':
      return [
        { label: 'selection', hotkey: s.checkKey },
        ...(s.typeCheckKey ? [{ label: 'type', hotkey: s.typeCheckKey }] : []),
        { label: 'by voice', hotkey: s.practiceKey },
      ]
    case 'screen':
      return [
        { label: 'listen', hotkey: s.snipKey },
        { label: 'translate', hotkey: s.textKey },
      ]
    case 'dictate':
      return [
        { label: 'dictate', hotkey: s.dictateKey },
        { label: 'note', hotkey: s.noteKey },
      ]
    case 'transcribe':
      return [{ label: 'in Meet', hotkey: MEET_KEY }]
    case 'keyboard':
      return [
        { label: 'switch', hotkey: s.switchKey },
        { label: 'fix', hotkey: s.fixKey, chain: 'fix' },
      ]
  }
}

/** An action's keys as caps; `setOnly` leaves out those not set (the bar, where "not set" only crowds the title). */
function keysOf(action: Action, s: Settings, chained = false, setOnly = false): HTMLElement[] {
  return keyLines(action, s)
    .filter(k => !setOnly || k.hotkey)
    .flatMap(k => [el('span', { class: 'kl' }, k.label), caps(k.hotkey, chained ? k.chain : undefined)])
}

/** The layouts the keys go through, in order: those chosen that Windows has, or all of them. */
function cycleOf(v: AppView): KeyboardLayout[] {
  const chosen = v.settings.layouts.map(id => v.layouts.find(l => l.id === id)).filter((l): l is KeyboardLayout => !!l)
  if (chosen.length > 0) return chosen
  // As the keyboard thread goes (typist.ts cycle): the layouts in the person's languages, when two or more are.
  const languages = myLanguages(v.settings)
  const mine = v.layouts.filter(l => languages.includes(l.lang))
  return mine.length >= 2 ? mine : v.layouts
}

/** The natural voice reads: it is here and chosen (Automatic picks it). */
const naturalOn = (v: AppView) => v.natural.status === 'ready' && (v.settings.voice === '' || v.settings.voice.startsWith(NATURAL_PREFIX))
const pairOf = (v: AppView) => `${v.settings.native} ⇄ English`

/** What Dictate runs on, and how quick it is here: the speech engine's model, once the engine is here. */
function engineCap(v: AppView): string {
  const p = v.speech.pack
  if (p.status === 'installing' && !installed(v)) return `downloading ${Math.round((p.progress ?? 0) * 100)}%`
  if (!installed(v)) return 'downloads once'
  if (!running(v)) return 'speech to text'
  const c = v.speech.plan.dictation.chosen
  return `speech to text · on your ${c.device === 'cuda' ? 'graphics card' : 'processor'}`
}

/** What an action is called, what it runs on, and what it does. */
function actionText(action: Action, v: AppView): { title: string; cap: string; desc: string } {
  const title = TITLES[action]
  switch (action) {
    case 'listen':
      return { title, cap: naturalOn(v) ? 'natural voice' : 'Windows voice', desc: 'Reads English text aloud and shows its translation.' }
    case 'translate':
      return { title, cap: pairOf(v), desc: 'Translates the selected text; Enter pastes the translation back.' }
    case 'check':
      return { title, cap: checkCap(v), desc: 'Marks the mistakes in your English and shows the fix.' }
    case 'screen':
      return { title, cap: 'text from the screen', desc: 'Draw a box around text you can’t select, then listen or translate.' }
    case 'dictate':
      return { title, cap: engineCap(v), desc: `Speak and it types where the cursor is. Speak ${v.settings.native}, get English.` }
    case 'transcribe':
      return { title, cap: 'files · microphone · Meet', desc: 'Talks and meetings into text, speaker by speaker.' }
    case 'keyboard':
      return {
        title,
        cap: cycleOf(v)
          .map(l => l.short)
          .join(' · '),
        desc: v.settings.autoFix ? 'Fixes words typed in the wrong layout as you type.' : 'Switches the layout and fixes text typed in the wrong one.',
      }
  }
}

// ---------------------------------------------------------------- skeleton
// The window has no Windows frame: the sidebar's mark and the bar's empty
// parts drag it, and the bar ends in the window's own minimize, maximize and
// close. Every place is in the sidebar, in groups, each once.

/** A place in the sidebar: what it opens, its icon and name, and a quiet value after it (a count). */
type NavItem = { page: Page | 'home'; icon: LucideName; title: string; value?: (v: AppView) => string }

const many = (n: number) => (n ? String(n) : '')

const NAV: { label: string; items: NavItem[] }[] = [
  { label: '', items: [{ page: 'home', icon: 'house', title: 'Home' }] },
  { label: 'Actions', items: ACTIONS.map(a => ({ page: a, icon: ICONS[a], title: TITLES[a] })) },
  {
    label: 'Library',
    items: [
      { page: 'words', icon: 'book-open', title: 'Words', value: v => many(v.words.length) },
      { page: 'mistakes', icon: 'list-checks', title: 'Mistakes', value: v => many(v.mistakes.length) },
      { page: 'transcripts', icon: 'file-text', title: 'Transcripts' },
      { page: 'translations', icon: 'clock', title: 'Translations', value: v => many(v.translations.length) },
      { page: 'phrases', icon: 'message-square-text', title: 'Phrases', value: v => many(v.dictation.recent.length) },
    ],
  },
  {
    label: 'Your lists',
    items: [
      { page: 'vocabulary', icon: 'spell-check', title: 'Words to spell', value: v => many(v.settings.vocabulary.length) },
      { page: 'kept', icon: 'lock', title: 'Kept as typed', value: v => many(v.settings.keepWords.length) },
      { page: 'learned', icon: 'sparkles', title: 'Learned words', value: v => many(v.learned.alwaysFix.length + v.learned.myWords.length) },
      { page: 'programs', icon: 'monitor', title: 'Programs', value: v => many(v.settings.apps.length) },
      { page: 'layouts', icon: 'list-ordered', title: 'Layouts', value: v => cycleOf(v).map(l => l.short).join('·') },
    ],
  },
  {
    label: 'Krya',
    items: [
      { page: 'settings', icon: 'settings', title: 'Settings' },
      { page: 'engine', icon: 'hard-drive', title: 'Speech engine' },
      { page: 'storage', icon: 'database', title: 'Storage', value: v => (v.storage?.parts.length ? speechSize(downloadsMb(v.storage)) : '') },
      { page: 'computer', icon: 'cpu', title: 'This computer' },
      { page: 'about', icon: 'info', title: 'About' },
    ],
  },
]

const findField = el('input', {
  type: 'text',
  placeholder: 'Search settings',
  spellcheck: 'false',
  autocomplete: 'off',
  'aria-label': 'Search settings',
  oninput: () => find(findField.value),
  onkeydown: (event: Event) => {
    const key = (event as KeyboardEvent).key
    if (key === 'Escape') {
      event.preventDefault()
      findField.value = ''
      find('')
      findField.blur()
    } else if (key === 'Enter') {
      event.preventDefault()
      pBody.querySelector<HTMLElement>('.row.found')?.click()
    }
  },
})
const tree = el('nav', { class: 'tree' })
const navValues = new Map<Page | 'home', HTMLElement>()
for (const g of NAV) {
  if (g.label) tree.append(el('div', { class: 'gl' }, g.label))
  for (const i of g.items) {
    const value = el('span', { class: 'v' })
    navValues.set(i.page, value)
    const page = i.page
    tree.append(el('button', { class: 'it', 'data-nav': page, title: i.title, onclick: () => (page === 'home' ? goHome() : go(page)) }, lucide(i.icon), el('span', { class: 'lb' }, i.title), value))
  }
}
const side = el(
  'aside',
  { class: 'side' },
  // The text logo; a narrow sidebar has room for the icon only.
  el('div', { class: 'brand' }, logo(), tile(28)),
  el('label', { class: 'find', title: 'Search settings (Ctrl+F)' }, lucide('search', 's'), findField, el('span', { class: 'key' }, 'Ctrl F')),
  tree,
)

const maxButton = el('button', { class: 'icon-btn max', title: 'Maximize', 'aria-label': 'Maximize', onclick: () => post({ type: 'window', action: 'maximize' }) }, glyph('maximize'))
const winButtons = el(
  'div',
  { class: 'wbtns' },
  el('button', { class: 'icon-btn', title: 'Minimize', 'aria-label': 'Minimize', onclick: () => post({ type: 'window', action: 'minimize' }) }, glyph('minimize')),
  maxButton,
  el('button', { class: 'icon-btn', title: 'Close', 'aria-label': 'Close', onclick: () => post({ type: 'window', action: 'close' }) }, glyph('close')),
)

/** The window was maximized or put back (by the button, a double click on the bar, Win+↑): the button shows the other way. */
function windowState(maximized: boolean): void {
  const label = maximized ? 'Restore' : 'Maximize'
  maxButton.replaceChildren(glyph(maximized ? 'restore' : 'maximize'))
  maxButton.title = label
  maxButton.setAttribute('aria-label', label)
  root.classList.toggle('maxed', maximized)
}
// The bar says where the person is: Back, the page's name (a second-level page as a crumb), a few words on it, the action's keys.
const pBack = el('button', { class: 'icon-btn back', title: 'Back (Esc)', 'aria-label': 'Back', onclick: () => back() }, lucide('arrow-left', 's'))
const pTitle = el('div', { class: 'ptitle' })
const pCap = el('span', { class: 'pcap' })
const pKeys = el('div', { class: 'pkeys' })
// The logo in the bar is for the setup, which has no sidebar.
const barMark = el('div', { class: 'brand bb' }, logo())
const top = el('header', { class: 'top' }, barMark, pBack, pTitle, pCap, el('span', { class: 'gap' }), pKeys, winButtons)
const home = el('main', { class: 'home' })
const pBody = el('div', { class: 'pbody' })

mainCol.append(top, home, pBody)
root.append(side, mainCol)

/** The transcript the engine is making now and how far it has got: the sidebar's live line by Transcripts. */
let making: { id: string; progress: number } | undefined

function updateNav(): void {
  const lit = open?.name ?? 'home'
  for (const b of tree.querySelectorAll<HTMLElement>('.it')) b.classList.toggle('on', b.dataset.nav === lit)
  const v = view
  if (!v) return
  for (const g of NAV) for (const i of g.items) if (i.value) navValues.get(i.page)?.replaceChildren(i.value(v))
  const busy = running(v) ? v.speech.health?.busy : null
  const live = navValues.get('transcripts')
  if (!live) return
  live.classList.toggle('live', !!busy)
  live.title = busy ? 'A transcript is being made' : ''
  live.replaceChildren(...(busy ? [el('span', { class: 'dot' }), making?.id === busy ? `${Math.round(making.progress * 100)}%` : ''] : []))
}

/** While the engine makes a transcript, how far it has got, asked every few seconds while the window is up. */
async function followMaking(): Promise<void> {
  const id = view && running(view) ? view.speech.health?.busy : null
  if (!id) {
    if (making) (making = undefined), updateNav()
    return
  }
  if (document.hidden) return
  try {
    const r = await api<{ row: { status: string; progress: number } }>('GET', `/transcripts/${id}`)
    making = r.row.status === 'done' ? undefined : { id, progress: r.row.progress }
  } catch {
    // the engine is away for a moment; the dot stays
  }
  updateNav()
}
window.setInterval(() => void followMaking(), 3000)

// ---------------------------------------------------------------- home

function readiness(v: AppView): (Node | string)[] {
  const translator = {
    ready: 'ready',
    absent: 'downloads on first use',
    downloading: 'downloading',
    failed: 'could not download; tries again on the next translation',
    unsupported: 'has no offline translator yet',
  }[v.translator]
  const n = v.natural
  const voice: (Node | string)[] =
    n.status === 'downloading'
      ? [el('b', {}, 'natural voice'), ` ${Math.round(n.progress * 100)}%`]
      : n.status === 'failed'
        ? [el('b', {}, 'Windows voice'), ' ready (the natural voice could not download)']
        : [el('b', {}, naturalOn(v) ? 'natural voice' : 'Windows voice'), ' ready']
  const sp = v.speech
  const speech: (Node | string)[] = !installed(v)
    ? sp.pack.status === 'installing'
      ? [', ', el('b', {}, 'speech'), ` ${Math.round((sp.pack.progress ?? 0) * 100)}%`]
      : []
    : [', ', el('b', {}, 'speech'), running(v) ? ' ready' : sp.service === 'down' ? ' stopped' : ' starting']
  return [el('b', {}, pairOf(v)), ` ${translator}, `, ...voice, ...speech, '. Everything runs on this computer.']
}

function homeRow(action: Action, v: AppView): HTMLElement {
  const t = actionText(action, v)
  const open = () => go(action)
  return el(
    'li',
    {
      class: 'act',
      'data-page': action,
      role: 'button',
      tabindex: 0,
      onclick: open,
      onkeydown: (event: Event) => {
        const key = (event as KeyboardEvent).key
        if (key === 'Enter' || key === ' ') (event.preventDefault(), open())
      },
    },
    lucide(ICONS[action]),
    el('div', {}, el('div', { class: 'an' }, el('b', {}, t.title), el('i', {}, t.cap)), el('div', { class: 'ad' }, t.desc)),
    el('div', { class: 'keys' }, ...keysOf(action, v.settings, true)),
    lucide('chevron-right', 'chev'),
  )
}

/** Krya is paused: every key and reaction is off until Resume, here or in the tray. */
function pausedNotice(v: AppView): HTMLElement | null {
  if (!v.settings.paused) return null
  return el(
    'div',
    { class: 'row notice paused' },
    lucide('pause'),
    el('div', { class: 'l' }, 'Krya is paused', el('small', {}, 'shortcuts and layout fixing are off until you resume')),
    btn('Resume', () => save({ paused: false }), 'primary'),
  )
}

function homeNodes(v: AppView): HTMLElement[] {
  const sample = sampleOf(v.settings.native)
  return [
    el(
      'div',
      { class: 'head' },
      el(
        'div',
        { class: 'hline' },
        el('span', { class: 'hs h1' }, sample.typed),
        el('span', { class: 'arr a1' }, '→'),
        el('span', { class: 'hs h2' }, sample.fixed),
        el('span', { class: 'arr a2' }, '→'),
        el('span', { class: 'hs h3' }, 'hello world'),
        el('button', { class: 'replay', title: 'Play the line again', onclick: () => playMoment(false) }, icon('play'), el('span', {}, 'Replay')),
      ),
      el('p', { class: 'hcap' }, ...readiness(v)),
    ),
    pausedNotice(v),
    el('ul', { class: 'acts' }, ...ACTIONS.map(a => homeRow(a, v))),
    el('p', { class: 'foot' }, 'Tap an action to change its keys.'),
  ].filter((n): n is HTMLElement => n !== null)
}

function renderHome(force = false): void {
  // While the moment plays Home stays as it is; the moment's end draws it.
  if (!view || moment) return
  const next = el('div', {}, ...homeNodes(view))
  if (!force && next.innerHTML === home.innerHTML) return
  home.replaceChildren(...next.childNodes)
}

// ---------------------------------------------------------------- the moment
// One line through fix → translate → listen, on the person's keys; then the
// line travels up into the header and each key drops into its action.

const T_END = 5.7
const TYPE0 = 0.2
const TYPE_STEP = 0.09 // the wrong layout, letter by letter
const FIX = 1.3 // the fix key
const FLIP0 = 1.36
const FLIP_STEP = 0.045
const FLIP_D = 0.3
const TR = [2.12, 2.26] as const // the translate key, twice
const SWAP = 2.32 // the fixed line → English
const LI = [3.02, 3.15] as const // Ctrl C, twice
const WORDS = [
  [3.3, 3.76],
  [3.76, 4.26],
] as const // each word lit while it is said
const TRAVEL = 4.4

type Cell = { c: HTMLElement; a: HTMLElement; b: HTMLElement; wa: number; wb: number }
type Moment = {
  raf: number
  markSeen: boolean
  sample: Sample
  stage: HTMLElement
  cells: Cell[]
  caret: HTMLElement
  badge: HTMLElement
  t1: HTMLElement
  t2: HTMLElement
  line: HTMLElement
  line2: HTMLElement
  w1: HTMLElement
  w2: HTMLElement
  play: HTMLElement
  playIcon: HTMLElement
  eyebrow: HTMLElement
  smalls: HTMLElement[]
  rail: { fix: HTMLElement; translate: HTMLElement; listen: HTMLElement }
  /** Home's own pieces, which the travellers become. */
  h: {
    head: HTMLElement
    h1: HTMLElement
    h2: HTMLElement
    h3: HTMLElement
    arrows: HTMLElement[]
    replay: HTMLElement
    replayLabel: HTMLElement
    hcap: HTMLElement
    foot: HTMLElement
    rows: HTMLElement[]
    kf: HTMLElement
    kt: HTMLElement
    kl: HTMLElement
  }
  g: Record<'t1' | 't2' | 'line' | 'line2' | 'play' | 'h1' | 'h2' | 'h3' | 'replay' | 'rf' | 'rt' | 'rl' | 'kf' | 'kt' | 'kl', Box>
  /** Font sizes: the trail, the big line, the header line. */
  f: { trail: number; big: number; head: number }
}

let moment: Moment | undefined

function buildMoment(v: AppView, markSeen: boolean): Moment | undefined {
  const q = <T extends HTMLElement>(s: string) => home.querySelector<T>(s)
  const head = q('.head'), h1 = q('.h1'), h2 = q('.h2'), h3 = q('.h3'), replay = q('.replay'), hcap = q('.hcap'), foot = q('.foot')
  const kf = q('[data-chain=fix]'), kt = q('[data-chain=translate]'), kl = q('[data-chain=listen]')
  if (!head || !h1 || !h2 || !h3 || !replay || !hcap || !foot || !kf || !kt || !kl) return undefined
  const s = v.settings
  const sample = sampleOf(s.native)
  const cells = [...sample.typed].map((ch, i) => {
    const a = el('span', {}, ch === ' ' ? ' ' : ch)
    const b = el('span', {}, sample.fixed[i] === ' ' ? ' ' : (sample.fixed[i] ?? ''))
    return { c: el('span', { class: 'cell' }, a, b), a, b, wa: 0, wb: 0 }
  })
  const caret = el('span', { class: 'caret' })
  const badge = el('span', { class: 'badge' }, sample.from)
  const line = el('div', { class: 'big' }, ...cells.map(k => k.c), caret, badge)
  const w1 = el('span', { class: 'w' }, 'hello')
  const w2 = el('span', { class: 'w' }, 'world')
  const line2 = el('div', { class: 'big' }, w1, ' ', w2)
  const playIcon = icon('play')
  const play = el('div', { class: 'play' }, playIcon)
  const t1 = el('div', { class: 'trail t1' }, sample.typed)
  const t2 = el('div', { class: 'trail t2' }, sample.fixed)
  const eyebrow = el('div', { class: 'eyebrow' }, 'One line, three keys')
  const listenKey = keyLines('listen', s)[0]?.hotkey ?? ''
  const step = (n: number, hotkey: string, what: string) => {
    const keys = caps(hotkey)
    const small = el('small', {}, el('em', {}, String(n)), what)
    return { keys, small, node: el('div', { class: 'step' }, keys, small) }
  }
  const sf = step(1, s.fixKey, 'fix'), st = step(2, s.translateKey, 'translate'), sl = step(3, listenKey, 'listen')
  const rail = el('div', { class: 'rail' }, sf.node, st.node, sl.node)
  const stage = el('div', { class: 'stage' }, eyebrow, t1, t2, line, line2, play, rail)
  // The composition is drawn for a 620 px window; a shorter or taller one keeps it in the middle.
  stage.style.top = `${Math.round(Math.max(-40, Math.min(80, (mainCol.clientHeight - 620) / 2)))}px`
  mainCol.append(stage)

  // Measure everything where it ends, before anything moves.
  for (const k of cells) {
    k.wa = k.a.getBoundingClientRect().width
    k.wb = k.b.getBoundingClientRect().width
  }
  const l2 = rel(line2)
  play.style.left = `${l2.x + l2.w + 18}px`
  play.style.top = `${l2.y - (parseFloat(stage.style.top) || 0) + (l2.h - 40) / 2}px`
  const m: Moment = {
    raf: 0,
    markSeen,
    sample,
    stage,
    cells,
    caret,
    badge,
    t1,
    t2,
    line,
    line2,
    w1,
    w2,
    play,
    playIcon,
    eyebrow,
    smalls: [sf.small, st.small, sl.small],
    rail: { fix: sf.keys, translate: st.keys, listen: sl.keys },
    h: { head, h1, h2, h3, arrows: [...home.querySelectorAll<HTMLElement>('.arr')], replay, replayLabel: replay.querySelector('span') ?? replay, hcap, foot, rows: [...home.querySelectorAll<HTMLElement>('.act')], kf, kt, kl },
    g: {
      t1: rel(t1),
      t2: rel(t2),
      line: rel(line),
      line2: l2,
      play: rel(play),
      h1: rel(h1),
      h2: rel(h2),
      h3: rel(h3),
      replay: rel(replay),
      rf: rel(sf.keys),
      rt: rel(st.keys),
      rl: rel(sl.keys),
      kf: rel(kf),
      kt: rel(kt),
      kl: rel(kl),
    },
    f: { trail: fontOf(t1), big: fontOf(line), head: fontOf(h3) },
  }
  root.classList.add('playing')
  return m
}

const press = (t: number, at: number) => t >= at && t < at + 0.11

function lightKeys(group: HTMLElement, lit: boolean, down: boolean): void {
  for (const k of group.querySelectorAll('.key')) {
    k.classList.toggle('lit', lit)
    k.classList.toggle('down', down)
  }
  group.classList.toggle('lit', lit)
}

function setStyle(node: HTMLElement, opacity: number, transform = ''): void {
  node.style.opacity = String(opacity)
  node.style.transform = transform
}

const shown = (node: HTMLElement, on: boolean) => (node.style.visibility = on ? 'visible' : 'hidden')

/** Moves a node from one box towards another, centre-left to centre-left, scaling it to `s1`. */
function move(node: HTMLElement, from: Box, to: Box, p: number, s1: number): void {
  const s = lerp(1, s1, p)
  const dx = (to.x - from.x) * p
  const dy = (to.y + to.h / 2 - (from.y + (from.h / 2) * s1)) * p
  node.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`
}

function renderMoment(m: Moment, t: number): void {
  const { g, h, f } = m

  // Typing in the wrong layout; the fix rolls each letter into the right one.
  m.cells.forEach((k, i) => {
    k.c.style.display = t >= TYPE0 + i * TYPE_STEP ? '' : 'none'
    const p = spring(prog(t, FLIP0 + i * FLIP_STEP, FLIP0 + i * FLIP_STEP + FLIP_D))
    k.c.style.width = `${lerp(k.wa, k.wb, clamp(p))}px`
    setStyle(k.a, 1 - clamp(p * 2.2), `translateY(${-p * 26}px)`)
    setStyle(k.b, clamp((p - 0.25) * 1.6), `translateY(${(1 - p) * 26}px)`)
  })
  const typing = t >= TYPE0 && t < TYPE0 + m.cells.length * TYPE_STEP + 0.05
  m.caret.style.opacity = t < SWAP && (typing || Math.floor(t * 2.4) % 2 === 0) ? '1' : '0'
  // The layout badge rides the caret: the wrong layout while typing, the right one once fixed.
  const out = prog(t, SWAP - 0.1, SWAP + 0.1)
  m.badge.textContent = t < FIX + 0.25 ? m.sample.from : m.sample.to
  const pulse = t >= FIX + 0.25 ? 1 + 0.18 * Math.sin(Math.PI * prog(t, FIX + 0.25, FIX + 0.5)) : 1
  setStyle(m.badge, 1 - out, `scale(${pulse * (1 - out)})`)

  // Each earlier form lifts out of the line into the trail above it.
  const big = f.big / f.trail
  const p1 = spring(prog(t, FIX + 0.04, FIX + 0.8))
  move(m.t1, g.t1, g.line, 1 - p1, big)
  m.t1.style.opacity = t < FIX + 0.04 ? '0' : String(clamp(p1 * 2.2))
  const p2 = spring(prog(t, SWAP, SWAP + 0.75))
  move(m.t2, g.t2, g.line, 1 - p2, big)
  m.t2.style.opacity = t < SWAP ? '0' : '1'

  // The fixed line lifts as the trail's copy, and the English comes up in its place.
  m.line.style.opacity = t < SWAP ? '1' : '0'
  const inn = spring(prog(t, SWAP + 0.14, SWAP + 0.8))
  setStyle(m.line2, clamp(inn * 2), `translateY(${(1 - inn) * 34}px)`)

  // Listen: play turns into stop in place; each word lights while it is said.
  const speaking = t >= WORDS[0][0] && t < WORDS[1][1]
  m.w1.classList.toggle('on', t >= WORDS[0][0] && t < WORDS[0][1])
  m.w2.classList.toggle('on', t >= WORDS[1][0] && t < WORDS[1][1])
  setIcon(m.playIcon, speaking ? 'primitive-square' : 'play')
  m.play.classList.toggle('speaking', speaking)

  // The keys under the line light as their step runs.
  lightKeys(m.rail.fix, t >= FIX && t < SWAP, press(t, FIX))
  lightKeys(m.rail.translate, t >= TR[0] && t < LI[0], press(t, TR[0]) || press(t, TR[1]))
  lightKeys(m.rail.listen, t >= LI[0] && t < WORDS[1][1] + 0.1, press(t, LI[0]) || press(t, LI[1]))

  // Travel: the line goes up into the header, the keys down to their actions.
  const T = (d: number, dur = 0.8) => spring(prog(t, TRAVEL + d, TRAVEL + d + dur))
  if (t >= TRAVEL) {
    move(m.line2, g.line2, g.h3, T(0), f.head / f.big)
    move(m.t2, g.t2, g.h2, T(0.06), f.head / f.trail)
    move(m.t1, g.t1, g.h1, T(0.12), f.head / f.trail)
    m.t1.style.opacity = '1'
    m.t2.style.opacity = '1'
  }
  // The play button lands as the start of Replay.
  if (t < TRAVEL) setStyle(m.play, t >= LI[0] ? 1 : 0, `scale(${pop(prog(t, LI[0] + 0.02, LI[0] + 0.5))})`)
  else {
    m.play.style.opacity = '1'
    move(m.play, g.play, { x: g.replay.x, y: g.replay.y, w: 28, h: 28 }, T(0.02), 28 / 40)
  }
  const flights: [HTMLElement, Box, Box, number][] = [
    [m.rail.listen, g.rl, g.kl, 0],
    [m.rail.translate, g.rt, g.kt, 0.06],
    [m.rail.fix, g.rf, g.kf, 0.12],
  ]
  for (const [node, from, to, d] of flights) {
    const p = T(0.1 + d)
    node.style.transform = t >= TRAVEL ? `translate(${(to.x - from.x) * p}px, ${(to.y - from.y) * p}px)` : ''
  }
  // The moment's captions give way.
  const fade = 1 - prog(t, TRAVEL, TRAVEL + 0.25)
  m.eyebrow.style.opacity = String(fade)
  for (const s of m.smalls) s.style.opacity = String(fade)

  // Home settles around them.
  h.rows.forEach((row, i) => {
    const p = spring(prog(t, TRAVEL + 0.22 + i * 0.06, TRAVEL + 0.92 + i * 0.06))
    setStyle(row, clamp(p * 1.3), `translateY(${(1 - p) * 14}px)`)
  })
  const hp = spring(prog(t, TRAVEL + 0.45, TRAVEL + 1.0))
  for (const a of h.arrows) setStyle(a, hp, `translateX(${(1 - hp) * -8}px)`)
  setStyle(h.hcap, hp, `translateY(${(1 - hp) * 6}px)`)
  h.head.style.borderBottomColor = `color-mix(in srgb, var(--border-soft) ${hp * 100}%, transparent)`
  h.foot.style.opacity = String(spring(prog(t, TRAVEL + 0.8, TRAVEL + 1.2)))

  // Each traveller gives way to the real thing once it has landed.
  const landed = (d: number) => t >= TRAVEL + d + 0.8
  shown(h.h3, landed(0)), shown(m.line2, !landed(0))
  shown(h.h2, landed(0.06)), shown(m.t2, !landed(0.06))
  shown(h.h1, landed(0.12)), shown(m.t1, !landed(0.12))
  shown(h.kl, landed(0.1)), shown(m.rail.listen, !landed(0.1))
  shown(h.kt, landed(0.16)), shown(m.rail.translate, !landed(0.16))
  shown(h.kf, landed(0.22)), shown(m.rail.fix, !landed(0.22))
  shown(m.play, !landed(0.02))
  // Replay grows out of the landed play button.
  const rp = spring(prog(t, TRAVEL + 0.82, TRAVEL + 1.3))
  shown(h.replay, landed(0.02))
  h.replay.style.width = `${lerp(28, g.replay.w, rp)}px`
  h.replayLabel.style.opacity = String(rp)
}

/** Plays the moment (from `at`, frozen there when it is given). */
function playMoment(markSeen: boolean, at?: number): void {
  if (!view) return
  if (moment) finishMoment()
  closePage()
  const v = view
  void document.fonts.ready.then(() => {
    if (moment) return
    renderHome(true)
    const m = buildMoment(v, markSeen)
    if (!m) return
    moment = m
    // The first frame now, so the settled Home never flashes before the moment.
    renderMoment(m, Math.min(at ?? 0, T_END))
    if (at !== undefined) return
    const t0 = performance.now()
    const tick = (now: number) => {
      const t = (now - t0) / 1000
      if (t >= T_END) return finishMoment()
      renderMoment(m, t)
      m.raf = requestAnimationFrame(tick)
    }
    m.raf = requestAnimationFrame(tick)
  })
}

/** Ends the moment where it ends (also when it is cut short by a click or a key). */
function finishMoment(): void {
  const m = moment
  if (!m) return
  cancelAnimationFrame(m.raf)
  m.stage.remove()
  root.classList.remove('playing')
  moment = undefined
  renderHome(true)
  if (m.markSeen) save({ introSeen: true })
}

// ---------------------------------------------------------------- places
// A place is a page, or a second-level page on it (opened from a card with a
// chevron: the body slides over, the bar's title becomes a crumb). Every move
// is kept, so Back and Esc go back through the places visited, each where it
// was scrolled to, as a browser does.

/** A page of a page: a long part of it, opened from a card with a chevron. */
type SubId = 'model' | 'meet' | 'speakers' | 'fixing' | 'program' | 'languages'

type Place = { name: Page; sub?: SubId }

/** The open page and its second-level page; none: Home. */
let open: Place | undefined
/** The places left, each with where it was scrolled to: Back goes to the last. */
const visited: { place: Place | undefined; scroll: number }[] = []

const samePlace = (a: Place | undefined, b: Place | undefined) => a?.name === b?.name && a?.sub === b?.sub
const scroller = () => (open ? pBody : home)

/** Goes to a page, or a second-level page of it; `flash` lights the line with that title once there (a search's find). */
function go(name: Page, sub?: SubId, flash = ''): void {
  if (!view) return
  const next: Place = sub ? { name, sub } : { name }
  if (samePlace(open, next)) return flash ? flashRow(flash) : undefined
  visited.push({ place: open && { ...open }, scroll: scroller().scrollTop })
  if (visited.length > 50) visited.shift()
  show(next, open?.name === name ? (sub ? 1 : -1) : 0)
  if (flash) flashRow(flash)
}

/** Home, kept in the way back like any place. */
function goHome(): void {
  if (!open) return
  visited.push({ place: { ...open }, scroll: pBody.scrollTop })
  show(undefined, 0)
}

/** Home without a step back: the moment, the setup. */
function closePage(): void {
  if (open) show(undefined, 0)
}

/** Back (or Esc): from a transcript to the library, else to the place before. */
function back(): void {
  if (open?.name === 'transcripts' && !open.sub && backToList()) return
  let last = visited.pop()
  while (last && samePlace(last.place, open)) last = visited.pop()
  if (!last) return closePage()
  const from = open
  const dir = last.place && from && last.place.name === from.name ? (from.sub && !last.place.sub ? -1 : 1) : 0
  show(last.place, dir, last.scroll)
  // Back from a second-level page: the card that opened it has the focus again.
  if (dir === -1 && from?.sub) pBody.querySelector<HTMLElement>(`[data-sub="${from.sub}"]`)?.focus({ preventScroll: true })
}

/** Draws a place: Home or the page, the body sliding over (`dir`) on the same page, a short fade to another. */
function show(place: Place | undefined, dir: 1 | -1 | 0, scroll = 0): void {
  if (!view) return
  if (moment) finishMoment()
  const was = open
  if (was?.name === 'transcripts' && place?.name !== 'transcripts') leaveTranscripts()
  open = place
  keyTrouble = undefined
  if (place?.name !== was?.name) search = ''
  // The search's words stay for Back to the results; the field shows them only there.
  findField.value = place?.name === 'search' ? finding : ''
  if (place?.name === 'transcripts' && was?.name !== 'transcripts') enterTranscripts()
  if (place?.name === 'programs' && !place.sub) askRunningApps()
  // Sizes are measured each time the page opens: a download or a removal elsewhere changes them.
  if (place?.name === 'storage' && was?.name !== 'storage') post({ type: 'storage' })
  root.classList.toggle('page-open', !!place)
  fillHeader()
  updateNav()
  if (!place) {
    renderHome()
    home.scrollTop = scroll
    return fade(home)
  }
  if (dir && was) slideBody(dir)
  else {
    bodyPending = false
    pBody.replaceChildren(...bodyOf(view))
    fade(pBody)
  }
  pBody.scrollTop = scroll
}

/** A place comes in: a short fade up, unless motion is reduced. */
function fade(node: HTMLElement): void {
  if (reduced.matches) return
  node.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 160, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
}

/** A line found by the search, lit for a moment where it is. */
function flashRow(title: string): void {
  const row = [...pBody.querySelectorAll<HTMLElement>('.row')].find(r => lineTitle(r) === title)
  if (!row) return
  row.scrollIntoView({ block: 'center' })
  row.classList.add('flash')
  window.setTimeout(() => row.classList.remove('flash'), 1600)
}

type Sub = { title: string | (() => string); cap?: (v: AppView) => string; body: (v: AppView) => HTMLElement[]; valid?: (v: AppView) => boolean }

const SUBS: Record<SubId, Sub> = {
  model: { title: 'Speech model', body: modelPage, valid: running },
  meet: { title: 'Google Meet', cap: () => 'the Krya extension for Chrome', body: meetPage },
  speakers: { title: 'Who spoke when', cap: () => 'the voices told apart', body: speakerRows, valid: installed },
  fixing: { title: 'Fixing as I type', cap: () => 'what else Krya sets right while you type', body: fixingPage },
  program: { title: () => programOpen, body: programPage, valid: () => !!programOpen },
  languages: { title: 'Languages you use', body: languagesPage },
}
const subTitle = (id: SubId) => {
  const t = SUBS[id].title
  return typeof t === 'string' ? t : t()
}

/** A few words by the page's name in the bar. */
const CAPS: Partial<Record<Page, (v: AppView) => string>> = {
  words: v => (v.words.length ? `${v.words.length} saved · from your cards` : 'none yet · from your cards'),
  mistakes: () => 'from Check · on this computer',
  transcripts: () => transcriptsCap(),
  translations: () => 'kept 30 days on this computer',
  phrases: () => 'dictated lately · kept 30 days on this computer',
  vocabulary: () => 'for Dictate and Transcribe',
  kept: () => 'never fixed by themselves',
  learned: () => 'on this computer only',
  programs: () => 'left out of parts, or with a layout of their own',
  layouts: () => 'in the order the keys go through them',
  storage: v => (v.storage?.measuring ? 'measuring…' : v.storage ? `${speechSize(v.storage.freeMb)} free on ${v.storage.drive}` : 'what Krya keeps on this computer'),
  about: v => `Krya ${v.version}`,
}

let sliding: Animation[] = []

/** Draws the body again with the old one sliding out of the way: right to left opening (`dir` 1), back when closing. */
function slideBody(dir: 1 | -1): void {
  if (!view || !open) return
  for (const a of sliding) a.finish()
  sliding = []
  const ghost = el('div', { class: 'pbody pghost', inert: true, 'aria-hidden': 'true' })
  const scroll = pBody.scrollTop
  ghost.append(...pBody.childNodes)
  mainCol.append(ghost)
  ghost.scrollTop = scroll
  bodyPending = false
  pBody.replaceChildren(...bodyOf(view))
  if (reduced.matches) return ghost.remove()
  const easing = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
  const duration = 220
  const out = ghost.animate([{ transform: 'none', opacity: 1 }, { transform: `translateX(${-48 * dir}px)`, opacity: 0 }], { duration, easing, fill: 'forwards' })
  const inn = pBody.animate([{ transform: `translateX(${48 * dir}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration, easing })
  out.onfinish = () => ghost.remove()
  sliding = [out, inn]
}

/** A second-level page of the open page. */
function openSub(id: SubId): void {
  if (open) go(open.name, id)
}

function fillHeader(): void {
  if (!view) return
  const v = view
  pBack.hidden = !open && visited.length === 0
  if (!open) {
    pTitle.replaceChildren('Home')
    pCap.textContent = ''
    pKeys.replaceChildren()
    return
  }
  const name = open.name
  if (open.sub) {
    const sub = SUBS[open.sub]
    pTitle.replaceChildren(el('button', { class: 'pcrumb', onclick: () => go(name) }, TITLES[name]), el('span', { class: 'psep' }, '›'), subTitle(open.sub))
    pCap.textContent = sub.cap?.(v) ?? ''
    pKeys.replaceChildren()
    return
  }
  pTitle.replaceChildren(TITLES[name])
  pCap.textContent = isAction(name) ? actionText(name, v).cap : name === 'search' ? searchCap(v) : (CAPS[name]?.(v) ?? '')
  const keys = isAction(name) ? keysOf(name, v.settings, false, true) : []
  const next = el('div', {}, ...keys)
  if (next.innerHTML !== pKeys.innerHTML) pKeys.replaceChildren(...next.childNodes)
}

/** Set when the body changed while it was in use (a key being recorded, a box typed in): drawn once it is let go. */
let bodyPending = false
let pointerDown = false

function busy(): boolean {
  const a = document.activeElement
  return !!a && pBody.contains(a) && (a.matches('input[type=text]:not([data-live]), input[type=search], input[type=password], input[type=range]') || (a as HTMLElement).isContentEditable || a.classList.contains('recording'))
}

/**
 * The fields that keep what was typed across a redraw (`data-live`, the add
 * fields of a list): the ones in use or holding text move into the new body in
 * place of their fresh twins, so an item added shows at once under the field.
 */
function carryFields(next: HTMLElement): HTMLInputElement[] {
  const carried: HTMLInputElement[] = []
  for (const old of pBody.querySelectorAll<HTMLInputElement>('input[data-live]')) {
    if (!old.value && document.activeElement !== old) continue
    const fresh = next.querySelector<HTMLInputElement>(`input[data-live="${old.dataset.live}"]`)
    if (!fresh) continue
    fresh.replaceWith(old)
    carried.push(old)
  }
  return carried
}

function renderBody(): void {
  if (!view || !open) return
  if (open.sub && SUBS[open.sub].valid?.(view) === false) {
    open.sub = undefined
    fillHeader()
  }
  const next = el('div', {}, ...bodyOf(view))
  if (next.innerHTML === pBody.innerHTML) return
  if (busy()) {
    bodyPending = true
    return
  }
  bodyPending = false
  const scroll = pBody.scrollTop
  const focused = document.activeElement
  const carried = carryFields(next)
  pBody.replaceChildren(...next.childNodes)
  pBody.scrollTop = scroll
  const live = carried.find(f => f === focused)
  if (live) live.focus({ preventScroll: true })
}

// A redraw waits for the click that took the focus away, so the click lands on what it was aimed at.
pBody.addEventListener('focusout', () => {
  if (!bodyPending) return
  const later = () => window.setTimeout(renderBody, 0)
  if (pointerDown) window.addEventListener('pointerup', later, { once: true })
  else later()
})
window.addEventListener('pointerdown', () => (pointerDown = true), true)
window.addEventListener('pointerup', () => (pointerDown = false), true)

function bodyOf(v: AppView): HTMLElement[] {
  if (!open) return []
  if (open.sub) return SUBS[open.sub].body(v)
  switch (open.name) {
    case 'listen':
      return listenPage(v)
    case 'translate':
      return translatePage(v)
    case 'check':
      return checkPage(v)
    case 'screen':
      return screenPage(v)
    case 'dictate':
      return dictatePage(v)
    case 'transcribe':
      return transcribePage(v)
    case 'keyboard':
      return keyboardPage(v)
    case 'words':
      return wordsPage(v)
    case 'mistakes':
      return mistakesPage(v)
    case 'transcripts':
      return transcriptsBody(v)
    case 'translations':
      return translationsPage(v)
    case 'phrases':
      return recentPage(v)
    case 'vocabulary':
      return vocabularyPage(v)
    case 'kept':
      return keptPage(v)
    case 'learned':
      return learnedPage(v)
    case 'programs':
      return programsPage(v)
    case 'layouts':
      return layoutsPage(v)
    case 'settings':
      return settingsPage(v)
    case 'engine':
      return enginePage(v)
    case 'storage':
      return storagePage(v)
    case 'computer':
      return computerPage(v)
    case 'about':
      return aboutPage(v)
    case 'search':
      return searchPage(v)
  }
}

// ---------------------------------------------------------------- search
// Every line of every page that sets something, found by its name or its
// note; a find opens its page with the line lit. The lists of things saved
// (words, transcripts, translations, phrases) have searches of their own.

/** The places the search reads, second-level pages too. */
const SEARCHED: Place[] = [
  ...ACTIONS.map(name => ({ name })),
  { name: 'keyboard', sub: 'fixing' },
  { name: 'dictate', sub: 'model' },
  { name: 'transcribe', sub: 'model' },
  { name: 'transcribe', sub: 'speakers' },
  { name: 'transcribe', sub: 'meet' },
  { name: 'vocabulary' },
  { name: 'kept' },
  { name: 'learned' },
  { name: 'programs' },
  { name: 'layouts' },
  { name: 'settings' },
  { name: 'settings', sub: 'languages' },
  { name: 'engine' },
  { name: 'storage' },
  { name: 'computer' },
]

type Line = { place: Place; section: string; title: string; note: string }

/** A line's name: the first thing in its text. */
const lineTitle = (row: Element) => (row.querySelector(':scope > .l')?.firstChild?.textContent ?? '').trim()

/** A place's body drawn aside, as it would be if it were open. */
function bodyFor(v: AppView, place: Place): HTMLElement[] {
  const was = open
  open = place
  try {
    return bodyOf(v)
  } catch {
    return []
  } finally {
    open = was
  }
}

let lineCache: { view: AppView; lines: Line[] } | undefined

/** Every line of the searched places, read from their bodies once per snapshot. */
function linesOf(v: AppView): Line[] {
  if (lineCache?.view === v) return lineCache.lines
  const lines: Line[] = []
  for (const place of SEARCHED) {
    if (place.sub && SUBS[place.sub].valid?.(v) === false) continue
    let section = ''
    for (const node of bodyFor(v, place)) {
      if (node.classList.contains('grp')) {
        section = (node.firstChild?.textContent ?? '').trim()
        continue
      }
      for (const row of node.matches('.row') ? [node] : [...node.querySelectorAll('.row')]) {
        const title = lineTitle(row)
        const note = [...row.querySelectorAll(':scope > .l > small')].map(s => s.textContent ?? '').join(' · ')
        if (title) lines.push({ place, section, title, note })
      }
    }
  }
  lineCache = { view: v, lines }
  return lines
}

const found = (v: AppView) => {
  const q = finding.trim().toLowerCase()
  return q ? linesOf(v).filter(l => `${l.title} ${l.note}`.toLowerCase().includes(q)) : []
}

function searchCap(v: AppView): string {
  const n = found(v).length
  return finding.trim() ? `${n || 'no'} ${n === 1 ? 'place' : 'places'} for “${finding.trim()}”` : ''
}

/** Where a place is, in words, as its header says it: "Kept as typed", "Keyboard › Fixing as I type". */
function whereOf(place: Place): string {
  return place.sub ? `${TITLES[place.name]} › ${subTitle(place.sub)}` : TITLES[place.name]
}

/** A text with the words searched for marked. */
function marked(text: string, q: string): (Node | string)[] {
  const i = text.toLowerCase().indexOf(q)
  return i < 0 ? [text] : [text.slice(0, i), el('mark', {}, text.slice(i, i + q.length)), text.slice(i + q.length)]
}

function searchPage(v: AppView): HTMLElement[] {
  const q = finding.trim().toLowerCase()
  const hits = found(v)
  if (!hits.length) return [aside('search', q ? `Nothing has “${finding.trim()}”. Words, transcripts and translations have searches of their own.` : 'Type above: every line of every page is found by its name or its note.')]
  const out: HTMLElement[] = []
  let last = ''
  for (const hit of hits) {
    const where = whereOf(hit.place)
    if (where !== last) out.push(grp(where))
    last = where
    out.push(
      el(
        'button',
        { class: 'row navc found', onclick: () => go(hit.place.name, hit.place.sub, hit.title) },
        el('div', { class: 'l' }, el('span', {}, ...marked(hit.title, q)), hit.note ? el('small', {}, ...marked(hit.note, q)) : null),
        hit.section ? el('span', { class: 'v' }, hit.section) : null,
        lucide('chevron-right', 'chev'),
      ),
    )
  }
  return out
}

/** The search field changed: the Search page opens with its finds, or closes when it is empty. */
function find(text: string): void {
  finding = text
  if (!view) return
  if (!text.trim()) {
    if (open?.name === 'search') back()
    return
  }
  if (open?.name !== 'search') return go('search')
  fillHeader()
  bodyPending = false
  pBody.replaceChildren(...bodyOf(view))
}

// ---------------------------------------------------------------- page parts

/** A sample to select and try the keys on, right here. */
function tryIt(text: string, how: string): HTMLElement {
  return el('div', { class: 'try' }, el('p', {}, text), el('small', {}, how))
}

// ---------------------------------------------------------------- keys on pages

type KeyName =
  | 'selectKey'
  | 'snipKey'
  | 'translateKey'
  | 'textKey'
  | 'inPlaceKey'
  | 'checkKey'
  | 'typeKey'
  | 'typeCheckKey'
  | 'switchKey'
  | 'fixKey'
  | 'dictateKey'
  | 'englishKey'
  | 'noteKey'
  | 'againKey'
  | 'practiceKey'
  | 'pauseKey'
  | 'windowKey'

const KEY_USE: Record<KeyName, string> = {
  selectKey: 'listening to the selection',
  snipKey: 'listening to text on the screen',
  translateKey: 'translating the selection',
  textKey: 'translating text on the screen',
  inPlaceKey: 'replacing the selection with its translation',
  checkKey: 'checking your English',
  typeKey: 'typing a text to translate',
  typeCheckKey: 'typing a text to check',
  switchKey: 'switching the layout',
  fixKey: 'fixing the layout',
  dictateKey: 'dictating',
  englishKey: 'dictating in English',
  noteKey: 'dictating a note',
  againKey: 'typing the last phrase again',
  practiceKey: 'checking what you say',
  pauseKey: 'pausing Krya',
  windowKey: 'opening Krya',
}

/** What else a key is for already, besides `self` (a setting's name, or a layout's id for its own key). */
function keyTakenBy(key: string, self: string): string | undefined {
  const s = view?.settings
  // No key is nobody's: any number of them may be empty.
  if (!s || !key) return undefined
  const other = (Object.keys(KEY_USE) as KeyName[]).find(n => n !== self && s[n] === key)
  if (other) return KEY_USE[other]
  const layout = Object.entries(s.layoutKeys).find(([id, k]) => id !== self && k === key)?.[0]
  return layout ? `going to ${view?.layouts.find(l => l.id === layout)?.name ?? 'a layout'}` : undefined
}

/** Saves a key unless another use has it already. */
function saveKey(name: KeyName, key: string): void {
  const other = keyTakenBy(key, name)
  if (other) {
    keyTrouble = { name, text: `${hotkeyLabel(key)} is already for ${other}.` }
    return renderBody()
  }
  keyTrouble = undefined
  save({ [name]: key })
}

/** A key of an action, from the settings (see keyRecorder). */
function keyRow(name: KeyName, label: string, note: string, taken = false, iconName?: LucideName, extra?: HTMLElement | null): HTMLElement {
  const key = view?.settings[name] ?? ''
  const menu = menuNote(key)
  return keyRecorder(name, key, key => saveKey(name, key), label, menu ? `${note}; ${menu}` : note, taken, iconName, extra, DEFAULTS[name])
}

/** Alt or Win alone as a key: Krya keeps it from opening a menu (typist.ts), so the line says where the menu went. */
function menuNote(key: string): string {
  if (/^(Left|Right)Alt(\*2)?$/.test(key)) return 'Alt alone no longer opens menus, F10 does'
  if (/^(Left|Right)Super(\*2)?$/.test(key)) return 'Win alone no longer opens Start, Ctrl+Esc does'
  return ''
}

/** A layout's own key, which goes to that layout at once. */
function layoutKeyRow(l: KeyboardLayout, label: string, note: (string | HTMLElement)[]): HTMLElement {
  const keys = () => view?.settings.layoutKeys ?? {}
  const set = (key: string) => {
    const next = { ...keys() }
    if (key) next[l.id] = key
    else delete next[l.id]
    save({ layoutKeys: next })
  }
  const saveIt = (key: string) => {
    const other = key ? keyTakenBy(key, l.id) : undefined
    if (other) {
      keyTrouble = { name: l.id, text: `${hotkeyLabel(key)} is already for ${other}.` }
      return renderBody()
    }
    keyTrouble = undefined
    set(key)
  }
  return keyRecorder(l.id, keys()[l.id] ?? '', saveIt, label, note, false, 'keyboard')
}

/**
 * A key recorded from a press: Change (or a tap on the keys) listens for keys
 * with modifiers, a modifier tapped alone or twice (it waits a moment for a
 * second tap), modifiers pressed together, Pause or Caps Lock alone, the
 * mouse's side buttons. Esc gives up; × clears the key; ↺ brings back the key
 * it came with (`byDefault`), when it had one and has another now. `id` names
 * it for the trouble line under it; `extra` sits after its controls (a switch).
 */
function keyRecorder(
  id: string,
  current: string,
  saveKeyAs: (key: string) => void,
  label: string,
  note: string | (string | HTMLElement)[],
  taken = false,
  iconName?: LucideName,
  extra?: HTMLElement | null,
  byDefault = '',
): HTMLElement {
  const name = id
  const recorder = new HotkeyRecorder()
  let waiting: number | undefined
  const field = el('button', {
    class: 'krec',
    title: 'Click, then press the keys: Ctrl+Alt+T, Left Ctrl twice, Pause, a mouse side button…',
    'aria-label': `${label}: ${current ? hotkeyLabel(current) : 'not set'}. Click to change.`,
  })
  field.append(caps(current))
  const showing = (...nodes: HTMLElement[]) => field.replaceChildren(...nodes)
  const done = (key: string) => {
    window.clearTimeout(waiting)
    field.blur()
    saveKeyAs(key)
  }
  const recorded = (r: Recorded | undefined) => {
    window.clearTimeout(waiting)
    if (!r) return
    if (!r.more) return done(r.hotkey)
    // A tap: a second one within a moment makes it a double.
    showing(caps(r.hotkey), el('span', { class: 'x2' }, '…'))
    waiting = window.setTimeout(() => done(r.hotkey), DOUBLE_MS)
  }
  const listen = () => {
    if (field.classList.contains('recording')) return
    recorder.reset()
    field.classList.add('recording')
    showing(el('span', { class: 'key rec' }, 'Press keys…'))
  }
  // Focus starts it; so does the click itself, should the window not have the focus yet.
  field.addEventListener('focus', listen)
  field.addEventListener('click', () => (field.focus(), listen()))
  field.addEventListener('blur', () => {
    window.clearTimeout(waiting)
    field.classList.remove('recording')
    showing(caps(current))
  })
  field.addEventListener('keydown', event => {
    if (!field.classList.contains('recording')) return
    event.preventDefault()
    if (event.key === 'Escape') return field.blur()
    if (event.repeat) return
    window.clearTimeout(waiting)
    recorded(recorder.keydown(event.code, event.timeStamp))
  })
  field.addEventListener('keyup', event => {
    if (!field.classList.contains('recording')) return
    event.preventDefault()
    recorded(recorder.keyup(event.code, event.timeStamp))
  })
  field.addEventListener('mousedown', event => {
    if (document.activeElement !== field || (event.button !== 3 && event.button !== 4)) return
    event.preventDefault()
    recorded(recorder.mouse(event.button))
  })
  // The side buttons go back and forward in a page; here they are recorded instead.
  field.addEventListener('mouseup', event => {
    if (event.button === 3 || event.button === 4) event.preventDefault()
  })
  const clear = current
    ? el(
        'button',
        {
          class: 'kx',
          title: 'Clear',
          'aria-label': `Clear ${label}`,
          onclick: () => {
            keyTrouble = undefined
            saveKeyAs('')
          },
        },
        lucide('x', 's'),
      )
    : null
  const restore =
    byDefault && current !== byDefault
      ? el(
          'button',
          {
            class: 'kx',
            title: `Back to ${hotkeyLabel(byDefault)}`,
            'aria-label': `${label}: back to ${hotkeyLabel(byDefault)}`,
            onclick: () => {
              keyTrouble = undefined
              saveKeyAs(byDefault)
            },
          },
          lucide('rotate-ccw', 's'),
        )
      : null
  const trouble = keyTrouble?.name === name ? keyTrouble.text : ''
  const notes = typeof note === 'string' ? [note] : note
  const node = row(
    label,
    [...notes, taken && current ? bad('Taken by another program; choose another.') : null, trouble ? bad(trouble) : null],
    el('span', { class: 'kchg' }, field, clear, restore, linkBtn(current ? 'Change' : 'Set', () => field.click()), extra ?? null),
  )
  if (iconName) node.prepend(lucide(iconName))
  return node
}

/** A key that cannot be changed, shown where it works. */
const fixedKey = (label: string, hotkey: string, note?: string) => row(label, [note], caps(hotkey))

// ---------------------------------------------------------------- action pages

function listenPage(v: AppView): HTMLElement[] {
  const s = v.settings
  const how = s.selectKey ? `Select this text, ${usage(s.selectKey)}.` : s.doubleCopy ? 'Select this text, press Ctrl + C twice.' : 'Set a key above or turn on Ctrl + C twice, then select this text.'
  return [
    grp('Keys'),
    keyRow('selectKey', 'Listen to the selected text', 'select text anywhere, then press the key', !v.keysOk.select, 'volume-2'),
    card(
      'copy',
      'Also on Ctrl + C twice',
      ['select text, then press Ctrl + C twice, quickly; works with no key set too'],
      el('span', { class: 'kchg' }, caps(COPY_TWICE), el('span', { class: 'tgwrap' }, toggleKnob(s.doubleCopy, doubleCopy => save({ doubleCopy }), 'Ctrl + C twice'))),
    ),
    keyRow('snipKey', 'Listen to text on the screen', 'for text you can’t select: draw a box around it', !v.keysOk.snip, 'scan'),
    ...voiceRows(v),
    grp('The card'),
    toggleCard('volume-2', 'Read aloud when a card opens', s.autoRead, autoRead => save({ autoRead })),
    toggleCard('spell-check', 'Dotted line under less common words', s.rareWords, rareWords => save({ rareWords })),
    toggleCard('list', 'Listen reads one sentence at a time', s.oneAtATime, oneAtATime => save({ oneAtATime })),
    card(
      'book-open',
      'Show word meanings on',
      [],
      select(
        s.wordHint,
        [
          ['shift', 'Click, or Shift + hover'],
          ['hover', 'Click, or hover'],
          ['off', 'Click only'],
        ],
        wordHint => save({ wordHint }),
      ),
    ),
    grp('In the card'),
    card('play', 'Play, stop and step through sentences', [], el('span', { class: 'kg2' }, caps('Space'), caps('←'), caps('→'))),
    card('book-open', 'Click a word', ['see its meanings, hear it, star it to keep it in Words'], null),
    card('languages', 'Click a sentence', ['its translation is marked; ▶ in the margin reads one paragraph'], null),
    card('x', 'Close the card and stop the voice', [], caps('Esc')),
    tryIt('The morning was quiet. A small boat drifted along the river, and two children watched the ducks from the bridge.', how),
  ].filter((n): n is HTMLElement => n !== null)
}

const TRY_TRANSLATE: Record<string, string> = {
  Russian: 'Конечно, пришлю обновлённые макеты до созвона.',
  Ukrainian: 'Звісно, надішлю оновлені макети до дзвінка.',
}

function translatorChip(v: AppView): [HTMLElement, string] {
  const level = v.settings.translationLevel
  const from = level === 'fast' ? 'Mozilla' : 'Hugging Face'
  switch (v.translator) {
    case 'ready':
      return [chip('ready'), `${LEVEL_NAMES[level]} translation, works offline`]
    case 'absent':
      return [chip('on first use', 'off'), `downloads from ${from} at the first translation, then works offline`]
    case 'downloading':
      return [chip('downloading'), `downloading from ${from}, once`]
    case 'failed':
      return [chip('failed', 'bad'), 'could not download; the next translation tries again']
    case 'unsupported':
      return [chip('not offered', 'off'), 'no offline translator for this language yet']
  }
}

const LEVEL_ABOUT: Record<TranslationLevel, string> = {
  fast: 'Instant; short phrases may come out word for word',
  accurate: 'Understands the whole sentence',
  most: 'The best wording, and the slowest',
}

/** What each model is like as a checker. */
const CHECK_ABOUT: Record<LlmModel, string> = {
  accurate: 'Catches nearly every mistake, quickly',
  most: 'A little more careful, and slower',
}

/** The model behind a level, named last. */
const LEVEL_MODEL: Record<TranslationLevel, string> = {
  fast: 'Firefox Translations',
  accurate: 'Gemma 4 E4B',
  most: 'Gemma 4 12B',
}

const FIT_WHERE: Record<LevelFit['where'], string> = {
  card: 'on your graphics card',
  part: 'partly on your graphics card',
  processor: 'on your processor',
}

/** The time expected before any is measured here. */
const FIT_GUESS: Record<LevelFit['where'], string> = {
  card: 'about 1–2 s per sentence',
  part: 'possible, but slow here',
  processor: 'possible, but slow here: 30 s or more per text',
}

/** A model partly on an NVIDIA card runs on llama.cpp's CUDA build, which its download carries. */
const CUDA_GUESS = 'a few seconds for a short text, 15–20 s for a long one'
const CUDA_SIZE = 'with NVIDIA’s own build, 670 MB'

/** A sentence slower than this reads as slow. */
const SLOW_SENTENCE_S = 2

/** The wait for a model loaded again after it was let go, measured here. */
const startText = (start: number | undefined) => (start !== undefined ? `; it starts in ${seconds(start)} after 10 idle minutes` : '')

/** Where a level runs here and how long it takes: measured, once it has been, else expected. */
function levelFitText(fit: LevelFit, speed: AppView['modelSpeed'][LlmModel]): string {
  const where = FIT_WHERE[fit.where]
  const measured = speed?.sentence === undefined ? undefined : { sentence: speed.sentence, start: speed.start }
  if (!measured) return fit.cuda ? `${CUDA_GUESS}, ${where}` : fit.where === 'card' ? `${FIT_GUESS.card} ${where}` : `${FIT_GUESS[fit.where]}, ${where}`
  return `${measured.sentence > SLOW_SENTENCE_S ? 'slow here' : 'here'}: ${seconds(measured.sentence)} per sentence, ${where}${startText(measured.start)}`
}

/**
 * The three translators, one in use: Fast (Firefox's models), Accurate and
 * Most accurate (Gemma 4 E4B and 12B, run by llama.cpp on this computer: the
 * one model, which checks English too). Picking one downloads it; nothing
 * downloads before. The advice comes from this computer's graphics card
 * (hardware.ts translationAdvice).
 */
function levelRows(v: AppView): HTMLElement[] {
  const advice = translationAdvice(v.speech.device)
  const inUse = v.settings.translationLevel
  return (['fast', 'accurate', 'most'] as const).map(level => {
    const t = v.translation[level]
    const fit = level === 'fast' ? undefined : advice[level]
    const fetching = t.status === 'downloading'
    // What it is, then how it runs here, then what it downloads: a line each.
    const notes: (string | HTMLElement | null)[] = [
      `${LEVEL_ABOUT[level]} (${LEVEL_MODEL[level]})`,
      fit && level !== 'fast' ? levelFitText(fit, v.modelSpeed[level]) : null,
      level !== 'fast' && inUse === 'fast' && level === v.settings.model ? 'Check my English uses it' : null,
      t.status === 'failed'
        ? bad('the download failed; Use tries again')
        : t.status === 'ready' || fetching
          ? null
          : `${speechSize(t.size)} to download ${level === inUse ? 'with the next translation' : 'when you pick it'}${fit?.cuda ? ` (${CUDA_SIZE})` : ''}`,
      fetching ? bar(t.progress) : null,
    ]
    const label = el('span', {}, LEVEL_NAMES[level], advice.advised === level ? el('span', { class: 'chip good' }, lucide('check', 's'), 'Recommended') : null)
    const control = fetching
      ? el('span', { class: 'pct' }, `${Math.round(t.progress * 100)}%`)
      : level === inUse
        ? chip('in use', 'lit')
        : linkBtn('Use', () => post({ type: 'translationLevel', level }))
    const remove = level !== 'fast' && t.status === 'ready' ? ib('x', `Remove ${LEVEL_NAMES[level]} (${speechSize(t.size)})`, () => post({ type: 'removeModel', model: level })) : null
    return row(label, notes, control, remove)
  })
}

function translatePage(v: AppView): HTMLElement[] {
  const s = v.settings
  const [state, note] = translatorChip(v)
  const text = TRY_TRANSLATE[s.native] ?? 'Of course, I will send the updated layouts before the call.'
  const how = s.translateKey ? `Select it, ${usage(s.translateKey)}.` : 'Set a key above, then select it and press the key.'
  return [
    grp('Keys'),
    keyRow('translateKey', 'Translate the selected text', s.translateKey ? `select it anywhere, ${usage(s.translateKey)}` : 'select it anywhere, then press one key, such as Left Ctrl twice', !v.keysOk.translate, 'languages'),
    keyRow('typeKey', 'Type a text to translate', 'an empty card by the pointer, from any program; also in the tray menu', !v.keysOk.type, 'type'),
    keyRow('inPlaceKey', 'Replace the selection with its translation', 'no card', !v.keysOk.inPlace, 'wand-sparkles'),
    keyRow('textKey', 'Translate text on the screen', 'for text you can’t select: draw a box around it', !v.keysOk.text, 'scan'),
    fixedKey('In the card: paste the translation back', 'Enter'),
    grp('Translation'),
    ...levelRows(v),
    aside('info', 'Accurate and Most accurate also check your English: the one you pick here is the one Check uses.'),
    grp('Languages'),
    card('globe', pairOf(v), [note], state),
    languagesCard(v),
    grp('History'),
    navCard('clock', 'Recent translations', 'kept for 30 days, on this computer only', v.translations.length ? String(v.translations.length) : 'none', () => go('translations'), 'translations'),
    tryIt(text, how),
  ]
}

/** The texts translated lately (translationlog.ts), each to copy; Krya forgets them after 30 days by itself. */
function translationsPage(v: AppView): HTMLElement[] {
  const list = v.translations
  return [
    grp('Translations', list.length || undefined, list.length ? linkBtn('Clear', () => post({ type: 'clearTranslations' })) : null),
    ...(list.length
      ? list.map(e =>
          el(
            'div',
            { class: 'row phrase' },
            el(
              'div',
              { class: 'l' },
              el('span', { class: 'said', title: `${e.text}\n\n${e.translation}` }, e.translation),
              el('small', {}, `${e.text.length > 80 ? `${e.text.slice(0, 80)}…` : e.text} · ${whenSaid(e.at, Date.now())}`),
            ),
            linkBtn('Copy', () => copyText(e.translation)),
          ),
        )
      : [aside('info', 'Nothing yet. Translations are kept here 30 days, 200 at most.')]),
  ]
}

// ---------------------------------------------------------------- check my English

/** Mistakes made by learners whose own language is Russian or Ukrainian: the page's text to try. */
const TRY_CHECK = 'I want to learn English and can we made tutor option? I dictate or tupe in English and you show my my mistake.'

/** A text slower than this to check reads as slow. */
const SLOW_CHECK_S = 4

/** Where the checker runs here and how long a text takes: measured, once it has been, else expected. */
function checkFitText(fit: LevelFit, speed: AppView['modelSpeed'][LlmModel]): string {
  const where = FIT_WHERE[fit.where]
  if (speed?.text === undefined) return fit.where === 'card' ? `about 1 s per text ${where}` : `possible, but slow here: several seconds per text, ${where}`
  return `${speed.text > SLOW_CHECK_S ? 'slow here' : 'here'}: ${seconds(speed.text)} per text, ${where}${startText(speed.start)}`
}

/** What the checker does, for the bar and Home: the language it checks, or its model's download. */
function checkCap(v: AppView): string {
  const t = v.models[v.settings.model]
  if (t.status === 'downloading') return `downloading ${Math.round(t.progress * 100)}%`
  return t.status === 'ready' ? `English · notes in ${v.settings.native}` : 'downloads once'
}

/**
 * The two models, one in use (the settings' `model`, which translates too
 * unless Translate is on Fast): Use picks one and downloads it, the one in use
 * downloads now with Download or at the first check; a cross removes one;
 * Recommended on a card that holds it, its time here.
 */
function checkModelRows(v: AppView): HTMLElement[] {
  const advice = translationAdvice(v.speech.device)
  const inUse = v.settings.model
  return (['accurate', 'most'] as const).map(model => {
    const t = v.models[model]
    const fetching = t.status === 'downloading'
    const notes: (string | HTMLElement | null)[] = [
      `${CHECK_ABOUT[model]} (${LEVEL_MODEL[model]})`,
      checkFitText(advice[model], v.modelSpeed[model]),
      t.status === 'failed'
        ? bad('the download failed; Use tries again')
        : t.status === 'ready' || fetching
          ? null
          : `${speechSize(t.size)} to download ${model === inUse ? 'with Download or at your first check' : 'when you pick it'}${advice[model].cuda ? ` (${CUDA_SIZE})` : ''}`,
      fetching ? bar(t.progress) : null,
    ]
    const label = el('span', {}, LEVEL_NAMES[model], advice.advised === model ? el('span', { class: 'chip good' }, lucide('check', 's'), 'Recommended') : null)
    const control = fetching
      ? el('span', { class: 'pct' }, `${Math.round(t.progress * 100)}%`)
      : model !== inUse
        ? linkBtn('Use', () => post({ type: 'useModel', model }))
        : t.status === 'ready'
          ? chip('in use', 'lit')
          : linkBtn('Download', () => post({ type: 'useModel', model }))
    const remove = t.status === 'ready' ? ib('x', `Remove ${LEVEL_NAMES[model]} (${speechSize(t.size)})`, () => post({ type: 'removeModel', model })) : null
    return row(label, notes, control, remove)
  })
}

function checkPage(v: AppView): HTMLElement[] {
  const s = v.settings
  const typed = s.typeCheckKey ? `${usage(s.typeCheckKey)} and type it` : 'use Check my English… in the tray menu'
  const how = s.checkKey ? `This text has mistakes on purpose. Select it, ${usage(s.checkKey)}, or ${typed}.` : `This text has mistakes on purpose. Select it and press your key, or ${typed}.`
  return [
    grp('Keys'),
    keyRow('checkKey', 'Check the selected text', s.checkKey ? `select it anywhere, ${usage(s.checkKey)}` : 'select it anywhere, then press one key, such as Right Ctrl twice', !v.keysOk.check, 'graduation-cap'),
    keyRow('typeCheckKey', 'Type a text to check', 'an empty card by the pointer, from any program; also in the tray menu', !v.keysOk.typeCheck, 'type'),
    keyRow('practiceKey', 'Check what I say', installed(v) ? 'press, say a phrase in English, press again' : 'needs the speech engine (see Dictate)', !v.speech.keysOk.practice, 'mic'),
    fixedKey('In the card: paste the corrected text back', 'Enter'),
    aside('info', 'Speech recognition fixes some mistakes as it writes, so typing shows more of them.'),
    grp('Model'),
    ...checkModelRows(v),
    aside('info', 'The same model translates when Translate is set to Accurate or Most accurate.'),
    grp('History'),
    navCard('list-checks', 'Mistakes', 'what Check found in your texts, repeated ones first', v.mistakes.length ? String(v.mistakes.length) : 'none', () => go('mistakes'), 'mistakes'),
    tryIt(TRY_CHECK, how),
  ]
}

/** The changes of each kept text, worked out once (worddiff.ts). */
const diffs = new Map<string, DiffPart[]>()
function partsOf(e: MistakeEntry): DiffPart[] {
  const key = `${e.text}\u0000${e.corrected}`
  let parts = diffs.get(key)
  if (!parts) diffs.set(key, (parts = wordDiff(e.text, e.corrected)))
  return parts
}

/** A text with its mistakes, as the card marks them: struck out, then set right. */
function withMarks(parts: readonly DiffPart[]): Node[] {
  return parts.flatMap((p, i) =>
    p.kind === 'same'
      ? [document.createTextNode(p.text)]
      : [el(p.kind, {}, p.text), ...(p.kind === 'del' && parts[i + 1]?.kind === 'ins' ? [document.createTextNode(' ')] : [])],
  )
}

/** One change on its own: "made → make", "+ a", "about" struck out. */
function changeText(wrong: string, right: string): HTMLElement {
  return el('span', { class: 'said marks' }, wrong ? el('del', {}, wrong) : '+', ' ', right ? el('ins', {}, right) : '')
}

/**
 * Library › Mistakes: the changes made more than once, most first, then every
 * checked text that had a mistake, newest first, marked as in the card, with
 * its note; searched by the words; a cross forgets one, Clear all of them.
 */
function mistakesPage(v: AppView): HTMLElement[] {
  // A mistake repeats when the same words are struck out again ("made" → "make", "make a"); a word only missing, when the same one is put in.
  const counts = new Map<string, { wrong: string; rights: string[] }>()
  for (const e of v.mistakes)
    for (const c of changesOf(partsOf(e))) {
      const key = c.wrong ? c.wrong.toLowerCase() : `+${c.right.toLowerCase()}`
      const known = counts.get(key)
      if (known) known.rights.push(c.right)
      else counts.set(key, { wrong: c.wrong, rights: [c.right] })
    }
  // Shown with its commonest fix, the shortest of equals.
  const commonest = (rights: string[]) =>
    rights.slice().sort((a, b) => rights.filter(r => r === b).length - rights.filter(r => r === a).length || a.length - b.length)[0] ?? ''
  const repeated = [...counts.values()]
    .filter(c => c.rights.length > 1)
    .sort((a, b) => b.rights.length - a.rights.length)
    .slice(0, 12)
    .map(c => ({ wrong: c.wrong, right: commonest(c.rights), n: c.rights.length }))
  const list = el('div', {})
  const fill = () => {
    // The newest mistakes: this list may outlive the message it was drawn from.
    const all = view?.mistakes ?? v.mistakes
    const q = search.trim().toLowerCase()
    const shown = q ? all.filter(e => `${e.text} ${e.corrected} ${e.note}`.toLowerCase().includes(q)) : all
    list.replaceChildren(
      ...(shown.length
        ? shown.map(e =>
            el(
              'div',
              { class: 'row phrase mistake' },
              el('div', { class: 'l' }, el('span', { class: 'said marks', title: e.corrected }, ...withMarks(partsOf(e))), el('small', {}, [e.note, whenSaid(e.at, Date.now())].filter(Boolean).join(' · '))),
              linkBtn('Copy', () => copyText(e.corrected)),
              ib('x', 'Forget it', () => post({ type: 'forgetMistake', at: e.at })),
            ),
          )
        : [aside('info', all.length ? 'No such mistake.' : 'Nothing yet. The texts Check my English set right are kept here, on this computer.')]),
    )
  }
  fill()
  return [
    ...(repeated.length ? [grp('You repeat'), ...repeated.map(c => row(changeText(c.wrong, c.right), [`${c.n} times`]))] : []),
    grp('Mistakes', v.mistakes.length || undefined, v.mistakes.length ? linkBtn('Clear', () => post({ type: 'clearMistakes' })) : null),
    ...(v.mistakes.length
      ? [
          el(
            'div',
            { class: 'tools' },
            el(
              'label',
              { class: 'search' },
              icon('search'),
              el('input', {
                type: 'search',
                placeholder: 'Search your mistakes',
                value: search,
                oninput: event => {
                  search = (event.target as HTMLInputElement).value
                  fill()
                },
              }),
            ),
          ),
        ]
      : []),
    list,
  ]
}

function screenPage(v: AppView): HTMLElement[] {
  return [
    grp('Keys'),
    keyRow('snipKey', 'Listen to text on the screen', 'for text you can’t select: draw a box around it', !v.keysOk.snip, 'volume-2'),
    keyRow('textKey', 'Translate text on the screen', 'for text you can’t select: draw a box around it', !v.keysOk.text, 'languages'),
    grp('How it works'),
    card('scan', 'Draw a box around the text', ['Windows dims the screen while you draw'], null),
    card('type', 'Krya reads the text on this computer', ['it reads the languages Windows has installed; add more there (Windows OCR)'], linkBtn('Languages…', () => post({ type: 'openLanguageSettings' }))),
    card('spell-check', 'Fix misread words in the card', ['then listen or translate'], null),
  ]
}

/** A folder or file, in a note: its end shows when it is long. */
const pathNote = (path: string) => el('small', { class: 'path', title: path }, el('bdi', {}, path))


/** Where notes go: the knowledge base folder and the folder inside it, the engine's own settings. */
function kbRows(v: AppView): HTMLElement[] {
  const e = engineSettings(v)
  if (!running(v) || !e) return [card('folder', 'Notes folder', [installed(v) ? 'shown once the speech engine runs' : 'chosen once the speech engine is installed'], null)]
  const inbox = el('input', {
    type: 'text',
    class: 'field',
    value: e.kbInbox,
    placeholder: 'the folder itself',
    'aria-label': 'Folder for notes',
    onkeydown: (event: Event) => (event as KeyboardEvent).key === 'Enter' && (event.target as HTMLInputElement).blur(),
    onchange: (event: Event) => void saveEngine({ kbInbox: (event.target as HTMLInputElement).value.trim() }),
  })
  return [
    card('folder', 'Notes folder', [e.kbDir ? pathNote(e.kbDir) : 'not chosen yet; notes need a folder (an Obsidian vault will do)'], linkBtn(e.kbDir ? 'Change' : 'Choose…', () => void pickKb())),
    card('notebook-pen', 'Subfolder for notes', ['a folder inside it; leave empty to use the folder itself'], inbox),
  ]
}

/** The card that opens the words to spell: how many there are. */
function vocabularyCard(v: AppView): HTMLElement {
  const n = v.settings.vocabulary.length
  return navCard('spell-check', 'Words to spell', 'names and terms, written the way you want them', n ? `${n} ${n === 1 ? 'word' : 'words'}` : 'none yet', () => go('vocabulary'), 'vocabulary')
}

/** The card that opens a feature's speech models: the one in use. */
function modelCard(v: AppView, feature: 'dictation' | 'transcripts'): HTMLElement | null {
  if (!running(v)) return null
  const p = feature === 'dictation' ? v.speech.plan.dictation : v.speech.plan.transcripts
  const how = feature === 'dictation' ? `about ${seconds(p.chosen.estimate)} per phrase` : `about ${minutesText(p.chosen.estimate)} per hour of recording`
  return navCard('cpu', 'Speech model', `${how} on this computer`, p.pinned ? p.chosen.label : `Automatic · ${p.chosen.label}`, () => openSub('model'), 'model')
}

/** "3 min", "1 h 10 min": an estimate of minutes. */
const minutesText = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.max(1, Math.round(m))} min`)

function dictatePage(v: AppView): HTMLElement[] {
  const s = v.settings
  const k = v.speech.keysOk
  const offer = engineRows(v, 'Dictate')
  const recent = v.dictation.recent
  return [
    ...(offer.length ? [grp('Speech engine'), ...offer] : []),
    testOffer(v),
    grp('Keys'),
    keyRow('dictateKey', 'Type what I say', 'press, speak, press again; the words appear where the cursor is', !k.dictate, 'mic'),
    keyRow('englishKey', 'Type what I say, in English', `press, speak ${s.native}, press again; English is typed`, !k.english, 'languages'),
    keyRow('noteKey', 'Dictate a note', 'saved as a Markdown file in your notes folder', !k.note, 'notebook-pen'),
    keyRow('againKey', 'Type the last phrase again', 'repeats it where the cursor is', !k.again, 'rotate-cw'),
    keyRow('practiceKey', 'Check what I say', 'press, say a phrase in English, press again', !k.practice, 'graduation-cap'),
    aside('info', 'The words appear as you speak. Esc cancels the phrase before it is typed.'),
    grp('Notes'),
    ...kbRows(v),
    grp('Words and phrases'),
    vocabularyCard(v),
    navCard('clock', 'Recent phrases', 'phrases you dictated lately, to copy again', recent.length ? recent[0]?.text ?? '' : 'none yet', () => go('phrases'), 'phrases'),
    modelCard(v, 'dictation'),
    el('p', { class: 'privacy' }, lucide('lock', 's'), 'Speech is recognized on this computer; nothing is sent anywhere.'),
  ].filter((n): n is HTMLElement => n !== null)
}

/**
 * Words to spell: names and terms dictation and transcripts write as the
 * person does, each with what it may be heard as (vocabulary.ts). Krya's own
 * setting, sent to the engine with its plan, so it can be filled in before the
 * engine is here. Two fields add one: the word as written, and the heard
 * forms; a tap on a word puts it back into the fields to change it.
 */
function vocabularyPage(v: AppView): HTMLElement[] {
  const s = v.settings
  const wordOf = (line: string) => parseEntry(line).word.toLowerCase()
  const word = liveField('word', 'Word, as it should be written', 'Word to spell', key => (key === 'Enter' ? add() : clear()))
  const heard = liveField('heard', 'Heard as (optional): кря, края', 'What it is heard as', key => (key === 'Enter' ? add() : clear()))
  const clear = () => {
    word.value = ''
    heard.value = ''
    word.focus()
  }
  const add = () => {
    const w = word.value.replace(/\s+/g, ' ').trim()
    const h = heard.value.replace(/\s+/g, ' ').replace(/[()]/g, '').trim()
    if (!w) return word.focus()
    const line = h ? `${w} (${h})` : w
    if (!parseEntry(line).word) return
    // The same word again is the person correcting it: the new line replaces the old.
    const lines = (view?.settings.vocabulary ?? s.vocabulary).filter(l => wordOf(l) !== w.toLowerCase())
    clear()
    save({ vocabulary: [...lines, line] })
  }
  const edit = (line: string) => {
    const { word: w, heard: hs } = parseEntry(line)
    word.value = w
    heard.value = hs.join(', ')
    word.focus()
  }
  const items = s.vocabulary.map(line => {
    const { word: w, heard: hs } = parseEntry(line)
    return el(
      'div',
      { class: 'row' },
      el('button', { class: 'l', title: 'Change it', onclick: () => edit(line) }, w, hs.length ? el('small', {}, `heard as ${hs.join(', ')}`) : null),
      ib('x', `Remove ${w}`, () => save({ vocabulary: (view?.settings.vocabulary ?? s.vocabulary).filter(l => l !== line) })),
    )
  })
  return [
    grp('Add a word'),
    el(
      'div',
      { class: 'row add' },
      el('div', { class: 'fields' }, word, heard, btn([lucide('plus', 's'), 'Add'], add, 'primary')),
      el('small', {}, 'A name or a term; dictation and transcripts write it this way, and a heard form is replaced wherever it is said.'),
    ),
    grp('Words', items.length || undefined, items.length ? linkBtn('Clear all', () => save({ vocabulary: [] })) : null),
    ...(items.length ? items : [aside('info', 'Nothing yet. Add a name or a word above.')]),
    aside('info', 'Shared by Dictate and Transcribe.'),
  ]
}

/** The phrases typed lately (dictationlog.ts), each to copy; Krya forgets them after 30 days by itself. */
function recentPage(v: AppView): HTMLElement[] {
  const recent = v.dictation.recent
  return [
    grp('Phrases', recent.length || undefined, recent.length ? linkBtn('Clear', () => post({ type: 'clearDictation' })) : null),
    ...(recent.length
      ? recent.map(e =>
          el(
            'div',
            { class: 'row phrase' },
            el('div', { class: 'l' }, el('span', { class: 'said', title: e.heard ? `${e.text}\n\nSaid: ${e.heard}` : e.text }, e.text), el('small', {}, whenSaid(e.at, Date.now()))),
            linkBtn('Copy', () => copyText(e.text)),
          ),
        )
      : [aside('info', 'Nothing yet. Dictated phrases (not notes) are kept here 30 days, 200 at most.')]),
  ]
}

/** The speech models of the open action's feature: Dictate's, or Transcribe's. */
function modelPage(v: AppView): HTMLElement[] {
  const feature = open?.name === 'dictate' ? 'dictation' : 'transcripts'
  return [
    grp(feature === 'dictation' ? 'For dictation' : 'For transcripts'),
    ...modelRows(v, feature),
    aside('info', feature === 'dictation' ? 'Transcripts have a model of their own, on the Transcribe page.' : 'Dictation has a model of its own, on the Dictate page.'),
  ]
}

/** "12:41" today, "yesterday 18:02", else "26 Oct 18:02". */
function whenSaid(iso: string, now: number): string {
  const at = new Date(iso)
  const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(new Date(now)) - day(at)) / 86_400_000)
  if (days === 0) return time
  if (days === 1) return `yesterday ${time}`
  return `${at.getDate()} ${at.toLocaleDateString('en-GB', { month: 'short' })} ${time}`
}

const copyText = (text: string) => void window.tutorHost.call({ call: 'copy', text }).then(() => toast(`Copied: ${text}`), fault)

/** "just now", "4 min ago", "2 h ago", "yesterday", "26 Oct": a moment, as of now. */
function ago(epochSeconds: number): string {
  const s = Math.max(0, Date.now() / 1000 - epochSeconds)
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`
  if (s < 2 * 86_400) return 'yesterday'
  const d = new Date(epochSeconds * 1000)
  return `${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`
}

/**
 * Chrome's own page: Krya opens a new Chrome window and types the address into it. When the window did not
 * come to the front, or there is no Chrome, the address is copied for the person to paste.
 */
function openChrome(url: string): void {
  void window.tutorHost.call({ call: 'openChrome', url }).then(opened => {
    if (opened === 'typed') return
    const say = opened === 'opened' ? 'Chrome is open: the address is copied, paste it into its address bar and press Enter.' : 'Chrome was not found. The address is copied: paste it into Chrome’s address bar.'
    void window.tutorHost.call({ call: 'copy', text: url }).then(() => toast(say), fault)
  }, fault)
}

/** The extension as the engine last saw it: it says hello when Chrome starts it, and every quarter of an hour. */
const extensionSeen = (v: AppView) => v.speech.health?.extension ?? null

/** 0.2.0 before 0.2.1: the version parts compared as numbers. */
function olderVersion(a: string, b: string): boolean {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0)
    if (d) return d < 0
  }
  return false
}

/** Chrome runs an older copy of the extension than the one in Krya's folder: Reload brings the new one in. */
const extensionStale = (v: AppView) => {
  const ext = extensionSeen(v)
  return !!ext && !!v.speech.extensionShipped && olderVersion(ext.version, v.speech.extensionShipped)
}

/** The first version with a fixed id (the manifest's key, engine/auth.py): an older copy is refused, and Reload cannot help. */
const FIXED_ID_SINCE = '0.4.0'
/** Chrome runs a copy from before the fixed id: it must be removed and loaded again. */
const extensionReload = (v: AppView) => {
  const ext = extensionSeen(v)
  return !!ext && olderVersion(ext.version, FIXED_ID_SINCE)
}

/** The extensions page, at Krya's own card when Chrome has told its id. */
const extensionsPage = (v: AppView) => {
  const id = extensionSeen(v)?.id
  return id && /^[a-p]{32}$/.test(id) ? `chrome://extensions/?id=${id}` : 'chrome://extensions/'
}

/** The card that opens the Google Meet page: whether the extension is in Chrome. */
function meetCard(v: AppView): HTMLElement {
  const ext = extensionSeen(v)
  const stale = extensionStale(v)
  const value = !ext
    ? 'set up in Chrome'
    : extensionReload(v)
      ? `Load again in Chrome · v${ext.version} → v${v.speech.extensionShipped}`
      : stale
        ? `Reload in Chrome · v${ext.version} → v${v.speech.extensionShipped}`
        : `Installed · v${ext.version}`
  return navCard('video', 'Google Meet', 'record a call in Chrome with the Krya extension', value, () => openSub('meet'), 'meet', !!ext && !stale)
}

/** How to record a Google Meet call: the Chrome extension, loaded from Krya's folder, and whether it is there. */
function meetPage(v: AppView): HTMLElement[] {
  const dir = v.speech.extensionDir
  const ext = extensionSeen(v)
  const offer = engineRows(v, 'Google Meet')
  const status = !ext
    ? card('video', 'Not set up yet', [running(v) ? 'three steps in Chrome, once; this line says when the extension is in' : 'the speech engine must run for the extension to work'], null)
    : extensionReload(v)
      ? card(
          'rotate-cw',
          `Chrome runs v${ext.version}, which Krya no longer takes recordings from`,
          ['remove it on Chrome’s extensions page (Remove on its card), then Load unpacked again: steps 1 and 2 below; Chrome asks for the microphone once more'],
          btn('Open in Chrome', () => openChrome('chrome://extensions/'), 'primary'),
        )
      : extensionStale(v)
      ? card('rotate-cw', `Chrome runs v${ext.version}; Krya has v${v.speech.extensionShipped}`, ['press Reload on the extension’s card in Chrome: Open in Chrome goes straight to it'], btn('Open in Chrome', () => openChrome(extensionsPage(v)), 'primary'))
      : card('circle-check', `Installed in Chrome · v${ext.version}`, [el('small', { class: 'ok' }, `seen ${ago(ext.seen)} · the call’s sound and your microphone go to the speech engine on this computer`)], caps(MEET_KEY))
  return [
    ...(offer.length ? [grp('Speech engine'), ...offer] : []),
    grp('Chrome extension'),
    status,
    grp('Set it up'),
    card('external-link', '1 · Open Chrome’s extensions page and turn on Developer mode', ['chrome://extensions · the switch is at the top right'], btn('Open in Chrome', () => openChrome('chrome://extensions/'))),
    card(
      'folder',
      '2 · Load unpacked, paste the folder’s path',
      [pathNote(dir), 'Ctrl+V into the folder picker’s address line, then Select folder'],
      el('span', { class: 'kchg' }, linkBtn('Show the folder', () => post({ type: 'showInFolder', path: dir })), btn([lucide('copy', 's'), 'Copy path'], () => copyText(dir), 'primary')),
    ),
    card('mic', '3 · In a meeting: the Krya icon → Record, or the key', ['the call’s sound and your microphone · the transcript appears in Transcripts'], caps(MEET_KEY)),
    grp('If something is off'),
    card('keyboard', 'The key does nothing', ['set it at chrome://extensions/shortcuts'], btn('Open in Chrome', () => openChrome('chrome://extensions/shortcuts'))),
    card('rotate-cw', 'After Krya updates, press Reload on the extension', ['Chrome keeps the old copy until then'], btn('Open in Chrome', () => openChrome(extensionsPage(v)))),
  ].filter((n): n is HTMLElement => n !== null)
}

/** The card that opens who spoke when: where it runs, whether it is here, its model's state. */
function speakersCard(v: AppView): HTMLElement | null {
  if (!installed(v)) return null
  const s = v.speech
  const note = 'the words are recognized already; this tells the voices apart'
  const open = () => openSub('speakers')
  const work = s.pack.status === 'installing' && s.pack.installing?.includes('speakers')
  if (work) return navCard('users', 'Who spoke when', note, 'downloading…', open, 'speakers')
  if (!hasPart(v, 'speakers')) {
    const sz = s.speakers.sizes[s.speakers.on]
    return navCard('users', 'Who spoke when', note, `not installed · ≈${speechSize(sz.download)}`, open, 'speakers')
  }
  const on = DEVICE_NAMES[s.pack.speakersOn ?? 'cpu']
  if (!running(v)) return navCard('users', 'Who spoke when', note, `on the ${on}`, open, 'speakers')
  const state = diarizationOf(v)
  const STATES: Record<typeof state, [string, boolean]> = {
    ready: ['ready', true],
    missing: ['key saved', true],
    checking: ['checking…', false],
    downloading: ['downloading…', false],
    'needs-token': ['needs a key', false],
    'bad-token': ['the key failed', false],
    'no-access': ['no access yet', false],
    failed: ['could not check', false],
  }
  const [value, ok] = STATES[state]
  return navCard('users', 'Who spoke when', note, ok ? `${value} · ${on}` : value, open, 'speakers', ok)
}

function transcribePage(v: AppView): HTMLElement[] {
  const offer = engineRows(v, 'Transcribe')
  return [
    ...(offer.length ? [grp('Speech engine'), ...offer] : []),
    testOffer(v),
    ...(running(v) ? [grp('New transcription'), ...newRows(v)] : []),
    grp('Setup'),
    speakersCard(v),
    vocabularyCard(v),
    meetCard(v),
    modelCard(v, 'transcripts'),
    grp('Library'),
    navCard('file-text', 'Transcripts', 'every transcript, searched by its words', null, () => go('transcripts')),
  ].filter((n): n is HTMLElement => n !== null)
}

/** Windows' layouts in the order the keys go through them: each moved earlier or later, left out, another added. */
function layoutsPage(v: AppView): HTMLElement[] {
  const cycle = cycleOf(v)
  const ids = cycle.map(l => l.id)
  const rest = v.layouts.filter(l => !ids.includes(l.id))
  const own = v.settings.layouts.length > 0
  const move = (id: string, to: number) => {
    const next = ids.filter(x => x !== id)
    next.splice(to, 0, id)
    save({ layouts: next })
  }
  return [
    grp('In this order', cycle.length),
    ...cycle.map((l, i) =>
      card(
        'keyboard',
        `${i + 1} · ${l.name}`,
        [l.short],
        el(
          'span',
          { class: 'kchg' },
          ib('arrow-up', 'Earlier', () => move(l.id, i - 1), i === 0),
          ib('arrow-down', 'Later', () => move(l.id, i + 1), i === ids.length - 1),
          // The last one left cannot go: the keys need a layout to go to.
          linkBtn('Leave out', () => save({ layouts: ids.filter(id => id !== l.id) }), ids.length === 1),
        ),
      ),
    ),
    rest.length
      ? card(
          'plus',
          'Add a layout',
          ['one Windows has; it goes last'],
          select<string>('', [['', 'Pick a layout'], ...rest.map((l): [string, string] => [l.id, l.name])], id => id && save({ layouts: [...ids, id] })),
        )
      : null,
    aside('info', own ? 'Your own order. Leave every layout out to go back to the languages you use.' : 'The order comes from the languages you use (Settings); move one or leave one out to set your own.'),
    grp('A key of its own'),
    ...cycle.map(l => layoutKeyRow(l, l.name, ['goes straight to it'])),
  ].filter((n): n is HTMLElement => n !== null)
}

/** What fixing as one types also sets right, and how. */
function fixingPage(v: AppView): HTMLElement[] {
  const s = v.settings
  return [
    grp('Capitals'),
    toggleCard('type', 'Fix two capitals at the start', s.fixTwoCaps, fixTwoCaps => save({ fixTwoCaps }), 'ПРивет → Привет; IDs and URLs stay'),
    toggleCard('type', 'Fix a word typed with Caps Lock on', s.fixCapsLock, fixCapsLock => save({ fixCapsLock }), 'пРИВЕТ → Привет, and Caps Lock is turned off'),
    toggleCard('lock', 'Leave words in capitals as typed', s.keepCaps, keepCaps => save({ keepCaps }), 'abbreviations in capitals are never fixed'),
    grp('When'),
    toggleCard('clock', 'Also fix after a pause', s.fixOnPause, fixOnPause => save({ fixOnPause }), 'a clearly wrong word is fixed about a second after you stop typing'),
    toggleCard('volume-2', 'Play a quiet click when a word is fixed', s.fixSound, fixSound => save({ fixSound })),
    aside('info', 'Short words are fixed together with the word after them: z rfr → я как. After you switch the layout yourself, the next word is left as typed.'),
  ]
}

/** The programs with parts of the keyboard helper left out, or a layout of their own: one card each, opening its page. */
function programsPage(v: AppView): HTMLElement[] {
  const s = v.settings
  const apps = () => view?.settings.apps ?? s.apps
  const add = (exe: string) => {
    if (!apps().some(a => a.exe === exe)) save({ apps: [...apps(), { exe, off: ['fix'], layout: '' }] })
  }
  const known = new Set(s.apps.map(a => a.exe))
  const running = runningApps.filter(exe => !known.has(exe))
  const suggest = v.lastApp && !known.has(v.lastApp) ? v.lastApp : ''
  const addTyped = (field: HTMLInputElement) => {
    const name = field.value.trim().toLowerCase()
    field.value = ''
    if (name) add(/\.exe$/.test(name) ? name : `${name}.exe`)
  }
  const field = liveField('add', 'program.exe', 'Add a program', (key, f) => (key === 'Enter' ? addTyped(f) : ((f.value = ''), f.blur())))
  return [
    grp('Add a program'),
    el(
      'div',
      { class: 'row add' },
      el('div', { class: 'fields' }, field, btn([lucide('plus', 's'), 'Add'], () => addTyped(field), 'primary')),
      el('small', {}, 'The name of its .exe. It starts with fixing as you type left out; open it to choose more.'),
    ),
    suggest ? card('plus', `Add ${suggest}`, ['the program in front a moment ago'], btn('Add', () => add(suggest))) : null,
    running.length
      ? card(
          'plus',
          'Add a running program',
          ['one with a window open now'],
          select<string>('', [['', 'Pick a program'], ...running.map((exe): [string, string] => [exe, exe])], exe => exe && add(exe)),
        )
      : null,
    grp('Programs', s.apps.length || undefined),
    ...(s.apps.length
      ? s.apps.map(a =>
          navCard(
            'monitor',
            a.exe,
            programNote(v, a),
            null,
            () => {
              programOpen = a.exe
              go('programs', 'program')
            },
            `program-${a.exe}`,
          ),
        )
      : [aside('info', 'None yet. Add a program above: Krya leaves out what you choose there, or switches to its own layout when it comes to the front.')]),
  ].filter((n): n is HTMLElement => n !== null)
}

const APP_PART_NAMES: Record<AppPart, string> = { fix: 'fixing as you type', switch: 'the switch keys', badge: 'the badge', keys: 'every key of Krya' }

/** What a program's rule does, in a few words. */
function programNote(v: AppView, a: AppRule): string {
  const off = a.off.length ? `left out: ${a.off.map(p => APP_PART_NAMES[p]).join(', ')}` : ''
  const layout = a.layout ? `starts in ${v.layouts.find(l => l.id === a.layout)?.name ?? a.layout}` : ''
  return [off, layout].filter(Boolean).join(' · ') || 'nothing left out'
}

/** One program: the parts left out there, its own layout, or out of the list. */
function programPage(v: AppView): HTMLElement[] {
  const rule = v.settings.apps.find(a => a.exe === programOpen)
  if (!rule) return [aside('info', 'This program is no longer in the list.')]
  const apps = () => view?.settings.apps ?? v.settings.apps
  const change = (next: Partial<AppRule>) => save({ apps: apps().map(a => (a.exe === rule.exe ? { ...a, ...next } : a)) })
  const part = (p: AppPart, iconName: LucideName, label: string, note: string) =>
    toggleCard(iconName, label, !rule.off.includes(p), on => change({ off: on ? rule.off.filter(x => x !== p) : [...rule.off, p] }), note)
  return [
    grp('Here, Krya'),
    part('fix', 'spell-check', 'Fixes words as you type', 'off: words stay as typed; the fix key still works'),
    part('switch', 'keyboard', 'Switches the layout by its keys', 'the switch key and the layouts\' own keys'),
    part('badge', 'type', 'Shows the layout by the cursor', 'the badge'),
    part('keys', 'circle-alert', 'Hears its keys at all', 'off: none of Krya\'s keys works here, but the pause key'),
    grp('Layout'),
    card(
      'globe',
      'Starts in',
      ['each time the program comes to the front'],
      select<string>(rule.layout, [['', 'As it was'], ...v.layouts.map((l): [string, string] => [l.id, l.name])], layout => change({ layout })),
    ),
    card(
      'trash-2',
      'Out of the list',
      ['everything works here again'],
      linkBtn('Remove', () => {
        save({ apps: apps().filter(a => a.exe !== rule.exe) })
        back()
      }),
    ),
  ]
}

/** What Krya learned from the person's typing: words it fixes always, words of theirs; each can go, or everything. */
function learnedPage(v: AppView): HTMLElement[] {
  const { alwaysFix, myWords } = v.learned
  const name = (code: string) => languageName(code)
  const item = (list: 'alwaysFix' | 'myWords', w: { word: string; lang: string }, note: string) =>
    card(list === 'alwaysFix' ? 'wand-sparkles' : 'book-open', w.word, [note], ib('x', `Forget ${w.word}`, () => post({ type: 'unlearn', list, word: w.word })))
  return [
    toggleCard('sparkles', 'Learn from my typing', v.settings.learn, learn => save({ learn }), 'never in a password field, a program left out of fixing, or on the full screen'),
    grp('Fixed always', alwaysFix.length || undefined),
    ...(alwaysFix.length ? alwaysFix.map(w => item('alwaysFix', w, `into ${name(w.lang)}`)) : [aside('info', 'A word you fix by hand twice (the fix key, or erased and typed again in the other layout) is fixed by itself from then on.')]),
    grp('Your words', myWords.length || undefined),
    ...(myWords.length ? myWords.map(w => item('myWords', w, `${name(w.lang)} · never fixed, and fixed into`)) : [aside('info', 'A word in no dictionary that you type right three times becomes yours: Krya leaves it as typed, and fixes it into when it is typed in the wrong layout. Until then only an unreadable fingerprint of it is kept.')]),
    grp('Never fixed'),
    navCard('lock', 'Kept as typed', 'words never fixed by themselves', String(v.settings.keepWords.length || 'none'), () => go('kept'), 'kept'),
    alwaysFix.length || myWords.length
      ? card('trash-2', 'Forget all', ['what Krya learned goes; Kept as typed stays'], linkBtn('Forget', () => post({ type: 'forgetLearned' })))
      : null,
  ].filter((n): n is HTMLElement => n !== null)
}

/** Words never fixed by themselves: Backspace after a fix adds one, and so can the person, before the fix ever happens. */
function keptPage(v: AppView): HTMLElement[] {
  const s = v.settings
  const words = () => view?.settings.keepWords ?? s.keepWords
  return listPage({
    label: 'Add a word',
    placeholder: 'word, as you type it',
    note: 'Backspace right after a fix adds the word too.',
    items: s.keepWords,
    count: 'Words',
    empty: 'None yet. Add a word above, or press Backspace right after a fix you did not want.',
    normalize: keptForm,
    add: word => save({ keepWords: [...words(), word] }),
    remove: word => save({ keepWords: words().filter(w => w !== word) }),
  })
}

/** Other programs at the keyboard, named calmly: no harm, so the person knows who else is there. */
function othersLine(v: AppView): HTMLElement | null {
  const presses = 'presses keys by itself; Krya ignores those.'
  const text = v.keyboardApps.length
    ? `Also using the keyboard: ${v.keyboardApps.join(', ')}.${v.foreignKeys ? ` One of them ${presses}` : ''}`
    : v.foreignKeys
      ? `A program ${presses}`
      : ''
  return text ? aside('info', text) : null
}

/** The programs with a window open now, asked of main for the Programs page; it is drawn again with them. */
function askRunningApps(): void {
  void window.tutorHost.call({ call: 'runningApps' }).then(list => {
    runningApps = Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
    if (open?.name === 'programs' && !open.sub) renderBody()
  }, fault)
}

function keyboardPage(v: AppView): HTMLElement[] {
  const s = v.settings
  const sample = sampleOf(s.native)
  const [typed = '', fixed = ''] = [sample.typed.split(' ')[0], sample.fixed.split(' ')[0]]
  const count = (n: number, one: string) => (n ? `${n} ${n === 1 ? one : one + 's'}` : 'none')
  const ownKeys = Object.keys(s.layoutKeys).length
  const learnedCount = v.learned.alwaysFix.length + v.learned.myWords.length
  const onOff = (on: boolean, key: 'switchOn' | 'fixKeyOn', label: string, has: boolean) => (has ? el('span', { class: 'tgwrap' }, toggleKnob(on, next => save({ [key]: next }), label)) : null)
  return [
    grp('Keys'),
    keyRow(
      'switchKey',
      'Switch to the next layout',
      s.switchKey && usage(s.switchKey).startsWith('tap') ? 'tap the key, nothing else' : 'goes to the next of the layouts listed below',
      false,
      'keyboard',
      onOff(s.switchOn, 'switchOn', 'Switching by keys', !!s.switchKey || ownKeys > 0),
    ),
    keyRow('fixKey', 'Fix the last words', 'retypes words that came out in the wrong layout; press again for the next one', false, 'rotate-cw', onOff(s.fixKeyOn, 'fixKeyOn', 'The fix key', !!s.fixKey)),
    grp('As you type'),
    toggleCard('spell-check', 'Fix words as I type', s.autoFix, autoFix => save({ autoFix }), `${typed} → ${fixed} when you press space; Backspace undoes it`),
    s.autoFix ? navCard('type', 'Fixing as I type', 'capitals, short words, fixing after a pause', null, () => openSub('fixing'), 'fixing') : null,
    toggleCard('type', 'Show the layout by the cursor', s.layoutBadge, layoutBadge => save({ layoutBadge }), 'a small badge appears when the layout or Caps Lock changes'),
    toggleCard('keyboard', 'Show the layout in the tray', s.trayLayout, trayLayout => save({ trayLayout }), 'the tray icon shows the current layout, such as en or ru'),
    toggleCard('monitor', 'Stay off in full screen', s.quietFullScreen, quietFullScreen => save({ quietFullScreen }), 'games, presentations, videos'),
    grp('Lists'),
    navCard('keyboard', 'Layouts', ownKeys ? `the layouts the switch key goes through; ${ownKeys} with a key of their own` : 'the layouts the switch key goes through, in order', cycleOf(v).map(l => l.short).join(' · '), () => go('layouts'), 'layouts'),
    navCard('monitor', 'Programs', 'turn parts of Krya off in a program, or give it its own layout', count(s.apps.length, 'program'), () => go('programs'), 'programs'),
    navCard('sparkles', 'Learned words', s.learn ? 'words Krya learned from your typing' : 'learning from your typing is off', count(learnedCount, 'word'), () => go('learned'), 'learned'),
    navCard('lock', 'Kept as typed', 'words Krya never fixes by itself', count(s.keepWords.length, 'word'), () => go('kept'), 'kept'),
    v.rivals.length ? warn(`${v.rivals.join(' and ')} ${v.rivals.length > 1 ? 'are' : 'is'} running: turn off its layout switching, or words get fixed twice.`) : null,
    v.elevatedApp ? warn(`${v.elevatedApp} runs as administrator: Windows keeps its keys from Krya, so nothing is fixed or switched there.`) : null,
    v.keyboardTrouble ? warn(`The keyboard helper: ${v.keyboardTrouble}`) : null,
    othersLine(v),
    el('p', { class: 'privacy' }, lucide('lock', 's'), 'Krya reads your keystrokes only to fix the layout, and sends nothing anywhere. It keeps only the words it learned, on this computer.'),
  ].filter((n): n is HTMLElement => n !== null)
}

// ---------------------------------------------------------------- words

const matches = (w: SavedWord, q: string) => `${w.word} ${w.base} ${w.sentence} ${w.senses.map(s => s[1]).join(' ')}`.toLowerCase().includes(q)

function dateOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'today'
  return d.toLocaleDateString('en-US', d.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

/** The sentence, with the word as it was met in it marked. */
function sentenceOf(w: SavedWord): HTMLElement {
  const at = w.word ? w.sentence.toLowerCase().indexOf(w.word.toLowerCase()) : -1
  if (at < 0) return el('div', { class: 'ws' }, w.sentence)
  return el('div', { class: 'ws' }, w.sentence.slice(0, at), el('mark', {}, w.sentence.slice(at, at + w.word.length)), w.sentence.slice(at + w.word.length))
}

function wordRow(w: SavedWord): HTMLElement {
  const senses = w.senses.map(([, t]) => t).join('; ')
  const full = w.senses.map(([pos, t]) => (pos ? `${pos}: ${t}` : t)).join('\n')
  return el(
    'li',
    { class: 'wi' },
    el(
      'div',
      { class: 'wh' },
      el('b', {}, w.base),
      w.word.toLowerCase() !== w.base.toLowerCase() ? el('span', { class: 'form' }, `from ${w.word}`) : null,
      el('span', { class: 'tr', title: full }, senses),
    ),
    w.sentence ? sentenceOf(w) : null,
    el(
      'div',
      { class: 'wr' },
      el('button', { class: 'star', title: 'Remove from Words', 'aria-label': `Remove ${w.base} from Words`, onclick: () => post({ type: 'removeWord', id: w.id }) }, icon('star-full')),
      el('span', { class: 'd' }, dateOf(w.addedAt)),
    ),
  )
}

function wordsPage(v: AppView): HTMLElement[] {
  const list = el('ul', { class: 'wl' })
  const fill = () => {
    // The newest words: this list may outlive the message it was drawn from.
    const words = view?.words ?? v.words
    const q = search.trim().toLowerCase()
    const shown = q ? words.filter(w => matches(w, q)) : words
    list.replaceChildren(
      ...(shown.length ? shown.map(wordRow) : [el('li', { class: 'empty' }, words.length ? 'No such word.' : 'No words yet. Click a word in a card and tap its star.')]),
    )
  }
  fill()
  const none = v.words.length === 0
  return [
    el(
      'div',
      { class: 'tools' },
      el(
        'label',
        { class: 'search' },
        icon('search'),
        el('input', {
          type: 'search',
          placeholder: 'Search words and sentences',
          value: search,
          oninput: event => {
            search = (event.target as HTMLInputElement).value
            fill()
          },
        }),
      ),
      el('button', { class: 'btn', disabled: none, onclick: () => post({ type: 'exportWords' }) }, icon('export'), 'Export for Anki…'),
      el('button', { class: 'btn', disabled: none, onclick: () => post({ type: 'copyWords' }) }, icon('copy'), 'Copy'),
    ),
    list,
  ]
}

// ---------------------------------------------------------------- settings

function voiceOptions(v: AppView): [string, string][] {
  const options: [string, string][] = [['', 'Automatic']]
  if (v.natural.status === 'ready') for (const voice of NATURAL_VOICES) options.push([NATURAL_PREFIX + voice.id, naturalLabel(voice)])
  for (const h of v.hostVoices) if (/^en\b/i.test(h.lang)) options.push([h.name, h.name])
  return options
}

/** The natural voice when it is not here yet: its download, its progress, or why it failed. */
function naturalRow(v: AppView): HTMLElement | null {
  const n = v.natural
  const download = (text: string) => linkBtn(text, () => post({ type: 'downloadNatural' }))
  switch (n.status) {
    case 'absent':
      return row('Natural voice', [`${n.size} MB to download, then it reads offline (Kokoro)`], download('Download'))
    case 'failed':
      return row('Natural voice', [bad('The download failed.')], download('Try again'))
    case 'downloading': {
      const bar = el('i', { class: 'fill' })
      bar.style.width = `${Math.round(n.progress * 100)}%`
      return row('Natural voice', [el('span', { class: 'bar' }, bar)], el('span', { class: 'pct' }, `${Math.round(n.progress * 100)}%`))
    }
    default:
      return null
  }
}

/** Remove was tapped once: it asks. */
let removingSpeech = false

/** The speech engine: its parts, the card, the service, where things live, Restart and Remove. */
function enginePage(v: AppView): HTMLElement[] {
  const sp = v.speech
  const p = sp.pack
  const h = sp.health
  if (!installed(v)) {
    const offer = engineRows(v, 'Dictate and Transcribe')
    if (p.status === 'installing' || p.status === 'removing') return [grp('Download'), ...offer]
    return [grp('Download'), ...offer]
  }
  const out: (HTMLElement | null)[] = [grp('On this computer')]
  const busy = p.status !== 'ready'
  const here = (text: string) => el('small', { class: 'ok' }, text)
  const speakersOnCard = p.speakersOn === 'cuda'
  out.push(
    card('mic', 'Speech to text', [here(`Installed · ≈${speechSize(sp.installed.core)}`), 'Whisper and Parakeet on the processor: Dictate and Transcribe'], null),
    p.nvidia
      ? card(
          'monitor',
          'The graphics card’s part',
          [
            hasPart(v, 'gpu') ? here(speakersOnCard ? 'Installed · inside the speakers’ PyTorch' : `Installed · ≈${speechSize(sp.installed.gpu)}`) : `Not installed · ≈${speechSize(sp.download.gpu)} download`,
            'speech on the NVIDIA card, several times quicker',
          ],
          hasPart(v, 'gpu') ? null : Object.assign(btn('Add', () => post({ type: 'installSpeech', parts: ['gpu'] })), { disabled: busy }),
        )
      : null,
    navCard(
      'users',
      'Who spoke when',
      sp.speakers.model ? 'PyTorch and pyannote · the voices’ model is here already' : 'PyTorch and pyannote · the voices’ model comes with a free Hugging Face key',
      hasPart(v, 'speakers') ? `Installed · ${DEVICE_NAMES[p.speakersOn ?? 'cpu']}` : `Not installed · ≈${speechSize(sp.speakers.sizes[sp.speakers.on].download)}`,
      () => go('transcribe', 'speakers'),
      'speakers',
      hasPart(v, 'speakers'),
    ),
    ...engineRows(v, ''),
    card('monitor', 'Graphics card', [cardNote(v)], null),
    card(
      'cpu',
      'Speech models',
      [v.settings.speechPrefer === 'speed' ? 'quicker ones, a little less accurate' : 'the most accurate ones this computer runs in time'],
      seg(
        v.settings.speechPrefer,
        [
          ['accuracy', 'Accuracy'],
          ['speed', 'Speed'],
        ],
        speechPrefer => post({ type: 'saveSettings', patch: { speechPrefer } }),
      ),
    ),
    grp('Service'),
  )
  const service = { off: 'off', starting: 'starting…', ready: h?.busy ? 'running · transcribing now' : 'running', down: 'stopped' }[sp.service]
  out.push(card('play', 'Service', [`${service} · 127.0.0.1:${sp.port}`, sp.trouble ? bad(sp.trouble) : null], linkBtn('Restart', () => post({ type: 'restartSpeech' }), p.status !== 'ready')))
  if (h) {
    out.push(
      card('folder', 'Transcripts are kept in', [pathNote(h.dataDir)], linkBtn('Open', () => post({ type: 'openPath', path: h.dataDir }))),
      card('folder', 'Notes go to', [h.kbDir ? pathNote(h.kbDir) : 'no knowledge base folder yet'], linkBtn(h.kbDir ? 'Change' : 'Choose…', () => void pickKb())),
    )
  }
  out.push(
    grp('Remove'),
    card(
      'trash-2',
      'Remove the speech engine',
      [removingSpeech ? 'its parts and models go; transcripts and notes stay. Remove?' : 'gives the space back · transcripts and notes stay'],
      removingSpeech
        ? el(
            'span',
            { class: 'kchg' },
            linkBtn('Keep', () => ((removingSpeech = false), renderBody())),
            btn('Remove', () => ((removingSpeech = false), post({ type: 'removeSpeech' })), 'danger'),
          )
        : linkBtn('Remove…', () => ((removingSpeech = true), renderBody()), p.status !== 'ready'),
    ),
  )
  return out.filter((n): n is HTMLElement => n !== null)
}

/** This computer (the sidebar's Krya group): what it is, the speed test, and what speech runs on. */
function computerPage(v: AppView): HTMLElement[] {
  const rows = computerRows(v)
  const first = rows[0]
  if (first) first.prepend(lucide('monitor'))
  return [grp('Hardware'), ...rows, testOffer(v), card('cpu', 'Graphics card', [cardNote(v)], null)].filter((n): n is HTMLElement => n !== null)
}

/** The parts of the Storage page: what each is, in plain words, the model's name in brackets at the end. */
const STORED: Record<StorageId, { icon: LucideName; title: string; note: string }> = {
  fast: { icon: 'languages', title: 'Fast translation', note: 'the models for your languages (Firefox Translations)' },
  voice: { icon: 'volume-2', title: 'Natural voice', note: 'reads English aloud (Kokoro)' },
  dict: { icon: 'book-open', title: 'Word meanings', note: 'the dictionary for your language (Wiktionary)' },
  accurate: { icon: 'languages', title: 'Accurate model', note: 'translates and checks your English (Gemma 4 E4B)' },
  most: { icon: 'languages', title: 'Most accurate model', note: 'translates and checks your English (Gemma 4 12B)' },
  unused: { icon: 'database', title: 'Models no longer used', note: 'an older Krya’s translation models; nothing uses them now (TranslateGemma)' },
  llama: { icon: 'cpu', title: 'The models’ runner', note: 'runs the models above; goes with the last of them (llama.cpp)' },
  speech: { icon: 'audio-lines', title: 'Speech engine', note: 'Dictate and Transcribe: the program and its speech models' },
  yours: { icon: 'file-text', title: 'Your settings and lists', note: 'words, mistakes, what Krya learned, logs' },
  transcripts: { icon: 'folder', title: 'Transcripts', note: 'yours: the text and a small copy of the sound' },
}

/** What Krya downloaded, in MB: everything in its one folder. */
const DOWNLOADED: readonly StorageId[] = ['fast', 'voice', 'dict', 'accurate', 'most', 'unused', 'llama', 'speech']
const downloadsMb = (s: StorageView) => s.parts.filter(p => DOWNLOADED.includes(p.id)).reduce((mb, p) => mb + p.bytes / 1e6, 0)

/** Where everything Krya keeps lives and how big it is: the downloads in one folder, each with ×; the person's own things to open. */
function storagePage(v: AppView): HTMLElement[] {
  const s = v.storage
  if (!s?.parts.length) return [aside('loader', 'Measuring what Krya keeps…')]
  const busy: Partial<Record<StorageId, boolean>> = {
    fast: v.translation.fast.status === 'downloading',
    voice: v.natural.status === 'downloading',
    dict: v.dictionary.status === 'downloading',
    accurate: v.models.accurate.status === 'downloading',
    most: v.models.most.status === 'downloading',
  }
  const remove: Partial<Record<StorageId, () => void>> = {
    fast: () => post({ type: 'removeDownload', part: 'fast' }),
    voice: () => post({ type: 'removeDownload', part: 'voice' }),
    dict: () => post({ type: 'removeDownload', part: 'dict' }),
    accurate: () => post({ type: 'removeModel', model: 'accurate' }),
    most: () => post({ type: 'removeModel', model: 'most' }),
    unused: () => post({ type: 'removeDownload', part: 'unused' }),
  }
  const mb = (p: StoragePart) => p.bytes / 1e6
  // A part still outside Krya's folder says where it is.
  const where = (p: StoragePart) => (p.away ? pathNote(p.path) : null)
  const line = (p: StoragePart): HTMLElement => {
    const { icon: name, title, note } = STORED[p.id]
    // The speech engine is removed on its own page, which asks first.
    if (p.id === 'speech') {
      const shared = p.shared / 1e6
      // Files it shares with a developer's own uv (hard links): there, and not freed by removing it.
      const freed = shared >= 100 ? `; removing it frees ${speechSize(mb(p) - shared)}, as ${speechSize(shared)} of its files are shared with other Python tools here` : ''
      return navCard(name, title, [`${note}${freed}`, where(p)], speechSize(mb(p)), () => go('engine'), 'storage-speech')
    }
    const x = remove[p.id]
    const control = x && !busy[p.id] ? ib('x', `Remove; it downloads again when needed`, x) : null
    const open = DOWNLOADED.includes(p.id) ? null : linkBtn('Open', () => post({ type: 'openPath', path: p.path }))
    return card(name, title, [note, where(p)], el('span', { class: 'kchg' }, el('span', { class: 'v num' }, speechSize(mb(p))), control, open))
  }
  const got = s.parts.filter(p => DOWNLOADED.includes(p.id) && p.bytes > 0)
  const own = s.parts.filter(p => p.id === 'yours' || p.id === 'transcripts')
  return [
    oldNotice(s),
    grp('Downloads'),
    card(
      'database',
      `Everything Krya downloads: ${speechSize(downloadsMb(s))}`,
      [`${got.some(p => p.away) ? 'in Krya’s folder, but for the parts that say where they are' : 'in one folder'} · ${speechSize(s.freeMb)} free on ${s.drive}`, pathNote(s.root)],
      linkBtn('Open folder', () => post({ type: 'openPath', path: s.root })),
    ),
    ...(got.length ? got.map(line) : [aside('info', 'Nothing downloaded yet: each part downloads when you first use it.')]),
    grp('Yours'),
    ...own.map(line),
  ].filter((n): n is HTMLElement => n !== null)
}

/**
 * Parts Krya still uses from outside its folder (the old Altype one, mostly): how much, which, why the last
 * move left them, and Move to Krya, which stops what uses them, moves them and starts Krya again.
 */
function oldNotice(s: StorageView): HTMLElement | null {
  const away = s.parts.filter(p => p.away)
  if (!s.old || !away.length) return null
  const total = speechSize(away.reduce((sum, p) => sum + p.bytes / 1e6, 0))
  const inOld = away.every(p => p.path.toLowerCase().startsWith(s.old!.dir.toLowerCase()))
  const names = away.map(p => STORED[p.id].title).join(', ')
  return el(
    'div',
    { class: 'row notice old' },
    lucide('folder'),
    el(
      'div',
      { class: 'l' },
      inOld ? `${total} still in the old Altype folder` : `${total} still outside Krya’s folder`,
      el('small', {}, `${names}: Krya uses them from there. Moving stops the speech engine and the model, then starts Krya again`),
      s.old.why ? el('small', { class: 'bad' }, `Not moved: ${s.old.why}`) : null,
    ),
    s.old.moving ? el('span', { class: 'v' }, 'Moving…') : btn('Move to Krya', () => post({ type: 'moveToKrya' }), 'primary'),
  )
}

const languageName = (code: string) => LANGUAGES.find(l => l.code === code)?.name ?? code

/** The card that opens the languages the person uses: their names. */
function languagesCard(v: AppView): HTMLElement {
  return navCard('globe', 'Languages you use', 'when Krya hears or reads a text, it guesses among these', myLanguages(v.settings).map(languageName).join(', '), () => go('settings', 'languages'), 'languages')
}

/** The languages the person uses: their own and English always, others added; what dictation, the translator and the screen's text are read as. */
function languagesPage(v: AppView): HTMLElement[] {
  const s = v.settings
  const used = myLanguages(s)
  const rest = LANGUAGES.filter(l => !used.includes(l.code))
  const mine = () => view?.settings.languages ?? s.languages
  return [
    grp('Add a language'),
    card(
      'plus',
      'Add a language',
      ['dictation never picks another; translation and the screen’s text guess among them'],
      select<string>('', [['', 'Pick a language'], ...rest.map((l): [string, string] => [l.code, `${l.name} · ${l.native}`])], code => code && save({ languages: [...mine(), code] })),
    ),
    grp('Languages', used.length),
    card('globe', languageName(used[0] ?? ''), ['your language · changed in Settings'], null),
    card('globe', 'English', ['always: the language Krya teaches'], null),
    ...s.languages.map(code => card('globe', languageName(code), [], ib('x', `Remove ${languageName(code)}`, () => save({ languages: mine().filter(c => c !== code) })))),
  ]
}

/** The voice that reads, the natural one's download, and the speed: Listen's, as the card reads with them. */
function voiceRows(v: AppView): (HTMLElement | null)[] {
  const s = v.settings
  const rtf = v.natural.rtf
  const windows = v.hostVoices.find(h => /^en/i.test(h.lang))
  // The natural voice slower than it speaks here pauses between sentences: said plainly, with the instant Windows voice offered.
  const slow = naturalOn(v) && rtf !== undefined && rtf > 1
  const voiceNote: (string | HTMLElement)[] = !naturalOn(v)
    ? ['reads with a Windows voice']
    : slow
      ? [`natural voice, ${v.natural.size} MB on this computer`, bad('it prepares speech slower than it plays, so it pauses between sentences; a Windows voice is instant')]
      : [`natural voice, ${v.natural.size} MB on this computer${rtf ? ` · prepares speech ${Math.max(1, Math.round(1 / rtf))}× faster than it plays` : ''}`]
  return [
    grp('Voice'),
    card('volume-2', 'Voice', voiceNote, slow && windows ? linkBtn(`Use ${windows.name.replace(/^Microsoft /, '').replace(/ Desktop$/, '')}`, () => save({ voice: windows.name })) : null, select(s.voice, voiceOptions(v), voice => save({ voice }))),
    naturalRow(v),
    card(
      'play',
      'Speed',
      ['how fast it reads'],
      seg(
        s.rate,
        RATES.map(r => [r, String(r)]),
        rate => save({ rate }),
        true,
      ),
    ),
  ]
}

function settingsPage(v: AppView): HTMLElement[] {
  const s = v.settings
  return [
    grp('Language'),
    card(
      'languages',
      'Your language',
      ['Krya translates into it and shows word meanings in it'],
      select(
        s.native,
        v.languages.map(l => [l.name, `${l.native} · ${l.name}`]),
        native => save({ native }),
      ),
    ),
    languagesCard(v),
    grp('Krya'),
    card(
      'monitor',
      'Theme',
      [],
      seg<ThemeMode>(
        s.theme,
        [
          ['system', 'As Windows'],
          ['light', 'Light'],
          ['dark', 'Dark'],
        ],
        theme => save({ theme }),
      ),
    ),
    toggleCard('power', 'Start with Windows', s.startWithWindows, startWithWindows => save({ startWithWindows })),
    toggleCard('pause', 'Pause Krya', s.paused, paused => save({ paused }), 'all shortcuts and fixing stop until you turn it back on; also in the tray menu'),
    keyRow('pauseKey', 'Pause or resume with a key', 'works while paused too', !v.keysOk.pause, 'pause'),
    keyRow('windowKey', 'Open this window with a key', 'from any program', !v.keysOk.window, 'house'),
    card('rotate-ccw', 'Reset all keys', ['every shortcut back to how it came; ↺ by a key brings back just that one'], linkBtn('Reset keys', () => post({ type: 'resetKeys' }))),
    // New versions are downloaded by hand from GitHub (the owner, 2026-10-30): nothing installs itself.
    card(
      'rotate-cw',
      `Version ${v.version}${v.dev ? ' dev' : ''}`,
      [v.dev ? `built ${v.build}` : 'new versions: download the installer from GitHub and run it; your settings and downloads stay'],
      linkBtn('New versions', () => post({ type: 'openLink', url: RELEASES })),
    ),
    grp('Backup'),
    card(
      'file-text',
      'Back up or move to another computer',
      ['settings, words, mistakes, what Krya learned from your typing, recent translations and phrases, in one file; models download again'],
      el('span', { class: 'kchg' }, linkBtn('Export', () => post({ type: 'exportBackup' })), linkBtn('Import', () => post({ type: 'importBackup' }))),
    ),
    aside('info', 'Import replaces your settings with the backup’s and adds its words and history to yours; nothing of yours is removed.'),
    card('rotate-ccw', 'Reset all settings', ['keys, switches and lists back to how they came; your words and history stay'], linkBtn('Reset', () => post({ type: 'resetSettings' }))),
  ].filter((n): n is HTMLElement => n !== null)
}

// ---------------------------------------------------------------- about

function aboutPage(v: AppView): HTMLElement[] {
  const fact = (term: string, ...detail: (HTMLElement | string)[]) => [el('dt', {}, term), el('dd', {}, ...detail)]
  return [
    el(
      'div',
      { class: 'about' },
      el('div', { class: 'mk' }, tile(88), logo()),
      el('p', { class: 'tag' }, 'Talk to the duck.'),
      // A run from source says when it was built, so it is never taken for the last release.
      el('p', { class: 'ver' }, `Version ${v.version}${v.dev ? ` dev, built ${v.build}` : ''} · free and open source, MIT`),
      el(
        'dl',
        { class: 'facts' },
        ...fact('made by', 'Yevhen Peshynskyi · Design automation engineer', el('br'), link('https://ikstro.com', 'ikstro.com')),
        ...fact(
          'runs offline',
          'Firefox Translations by Mozilla · Gemma 4 by Google (Apache 2.0), run by llama.cpp · Kokoro-82M by hexgrad, eSpeak NG · Windows OCR · WikDict, from Wiktionary · FrequencyWords by Hermit Dave ',
          el('span', { class: 'q' }, '— your text is never sent anywhere'),
        ),
        ...fact('made with', 'Inter and JetBrains Mono (SIL OFL) · Electron · VS Code icons'),
        ...fact('goes online only for', `a one-time download of each part: the translator for your language, the natural voice (${v.natural.size} MB), word meanings`),
        ...fact(
          'links',
          link(RELEASES, 'New versions and what changed'),
          ' · ',
          link('https://github.com/ikstro/krya', 'Source on GitHub'),
          ' · ',
          link('https://github.com/ikstro/krya/blob/main/NOTICE', 'Licenses'),
        ),
      ),
    ),
  ]
}

// ---------------------------------------------------------------- messages

/** A place asked for by the tray or a second start; Home is a fresh opening, with no way back. */
function showTab(tab: AppTab): void {
  if (tab !== 'home' && tab !== 'howto') return go(tab)
  visited.length = 0
  closePage()
  fillHeader()
}

/** The first `app` message: Home, the moment if it has not played yet, or the place asked for. */
function start(v: AppView): void {
  // The setup comes first; the moment plays after it.
  if (!v.settings.setupDone) return
  const asked = askedTab && askedTab !== 'home' && askedTab !== 'howto' ? askedTab : undefined
  // A place asked for wins; the moment waits for an opening that starts at Home.
  if (askedTranscript) return openTranscript(askedTranscript)
  if (asked) return go(asked)
  if (FROZEN_T !== undefined) return playMoment(false, FROZEN_T)
  if (v.settings.introSeen) return
  if (reduced.matches) return save({ introSeen: true })
  playMoment(true)
}

window.addEventListener('message', (event: MessageEvent<ToView>) => {
  if (event.source !== window) return
  const m = event.data
  if (m.type === 'appTab') {
    if (view) showTab(m.tab)
    else askedTab = m.tab
    return
  }
  if (m.type === 'openTranscript') {
    if (view) openTranscript(m.id)
    else (askedTranscript = m.id), (askedTab = 'transcripts')
    return
  }
  if (m.type === 'appWindow') return windowState(m.maximized)
  if (m.type !== 'app') return
  const first = view === undefined
  view = m.view
  if (m.view.speech.service !== 'ready') forgetEngine()
  updateNav()
  // A fresh install: the setup takes Home's place until it is finished or skipped.
  if (!m.view.settings.setupDone) {
    closePage()
    if (moment) finishMoment()
    root.classList.add('setup')
    home.classList.add('setup')
    renderSetup()
    return
  }
  if (root.classList.contains('setup')) {
    root.classList.remove('setup')
    home.classList.remove('setup')
    resetSetup()
    renderHome(true)
    // The opening moment plays once the setup is over, as it would on a first opening.
    if (!m.view.settings.introSeen) {
      if (reduced.matches) save({ introSeen: true })
      else playMoment(true)
    }
    return
  }
  renderHome()
  fillHeader()
  renderBody()
  if (first) start(m.view)
})

/** The setup's steps in Home's place, drawn again on every snapshot and on every change made in it. */
function renderSetup(): void {
  if (!view) return
  home.replaceChildren(...setupNodes(view, { save, post, redraw: renderSetup }))
}

// A click or a key during the moment takes it to its end.
window.addEventListener('pointerdown', () => moment && moment.raf && finishMoment(), true)
window.addEventListener('keydown', event => {
  if (moment?.raf) return finishMoment()
  if (event.defaultPrevented) return
  if (event.key === 'Escape' && open) {
    event.preventDefault()
    back()
  }
  // Ctrl+F: the search, unless a key is being recorded.
  if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f' && !document.querySelector('.recording') && !root.classList.contains('setup')) {
    event.preventDefault()
    findField.focus()
    findField.select()
  }
})

onRedraw(() => {
  fillHeader()
  renderBody()
})
setTranscriptHooks({
  view: () => view,
  shown: () => open?.name === 'transcripts',
  show: () => go('transcripts'),
  setup: () => go('transcribe', 'speakers'),
})

post({ type: 'appReady' })
