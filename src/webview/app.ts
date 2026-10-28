// The app window, Altype's back office. Home comes first: one line folded
// into the header that shows what Altype does (on the first opening it plays
// as a moment: a word typed in the wrong layout is fixed, translated and read
// aloud, each step lighting the person's own key; then the line rises into
// the header and the keys drop into their actions), whether the translator
// and the voice are here, and the six actions with their keys. A tapped
// action (or the Words, Transcripts, About or Settings pill) grows into its
// page over the whole window, its title and keys staying where they are as
// the page's header; Back or Esc folds it back into the same place (from a
// transcript, back to the library first). Everything shown
// comes from the main process in one `app` message, sent again whenever any
// of it changes; every change goes back as a message.

import { NATURAL_PREFIX, NATURAL_VOICES, naturalLabel } from '../natural'
import { DOUBLE_MS, HotkeyRecorder, hotkeyLabel, type Recorded } from '../hotkey'
import type { AppTab, AppView, KeyboardLayout, SavedWord, Settings, ToView, TutorHost, UpdateStatus } from '../protocol'
import { RATES, type ThemeMode } from '../settings'
import { el, icon, setIcon } from './dom'
import { glyph } from './glyphs'
import { caps, COPY_TWICE } from './keycaps'
import { bad, btn, chip, grp, link, linkBtn, post, row, seg, select, toggle, toggleKnob, warn } from './ui'
import { api, engineRows, engineSettings, fault, forgetEngine, hasPart, installed, modelRow, onRedraw, pickKb, running, saveEngine, speakerRows, toast } from './speech'
import { backToList, enterTranscripts, leaveTranscripts, newRows, openTranscript, setTranscriptHooks, transcriptsBody, transcriptsCap } from './transcripts'

declare global {
  interface Window {
    tutorHost: TutorHost
  }
}

const save = (patch: Partial<Settings>) => post({ type: 'saveSettings', patch })

type Action = 'listen' | 'translate' | 'screen' | 'dictate' | 'transcribe' | 'keyboard'
type Page = Action | 'words' | 'transcripts' | 'settings' | 'about'

const ACTIONS: readonly Action[] = ['listen', 'translate', 'screen', 'dictate', 'transcribe', 'keyboard']
const isAction = (name: Page): name is Action => (ACTIONS as readonly string[]).includes(name)
const TITLES: Record<Page, string> = {
  listen: 'Listen',
  translate: 'Translate',
  screen: 'Screen',
  dictate: 'Dictate',
  transcribe: 'Transcribe',
  keyboard: 'Keyboard',
  words: 'Words',
  transcripts: 'Transcripts',
  settings: 'Settings',
  about: 'About',
}

let view: AppView | undefined
/** A place asked for before the first `app` message. */
let askedTab: AppTab | undefined
/** A transcript asked for before the first `app` message. */
let askedTranscript = ''
let search = ''
/** Why the last key was not taken, shown under its row until another change. */
let keyTrouble: { name: KeyName; text: string } | undefined
/** The layout chip tapped on the Keyboard page: it shows how to move it or leave it out. */
let pickedLayout = ''
/** The box for a program's name on the Keyboard page is open. */
let addingApp = false

const reduced = matchMedia('(prefers-reduced-motion: reduce)')
// #t= and #pt= freeze the moment and a page's growth at a time (seconds), for
// pictures of them, the way the design's own frames were made.
const frozenAt = (name: string) => {
  const m = new RegExp(`(?:^#|&)${name}=([\\d.]+)`).exec(location.hash)
  return m ? parseFloat(m[1] as string) : undefined
}
const FROZEN_T = frozenAt('t')
const FROZEN_PT = frozenAt('pt')

// ---------------------------------------------------------------- motion

const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const prog = (t: number, a: number, b: number) => clamp((t - a) / (b - a))
const lerp = (a: number, b: number, p: number) => a + (b - a) * p
/** A spring with a small overshoot (about 5 %), settled at 1. */
const spring = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-8 * x) * (Math.cos(8.5 * x) + (8 / 8.5) * Math.sin(8.5 * x)))
/** A livelier one for the play button (about 12 %). */
const pop = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-6.5 * x) * Math.cos(10 * x))
/** A firmer one for pages: under 1 % overshoot, so titles don't wobble past their place. */
const pspring = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-9 * x) * (Math.cos(5 * x) + 1.8 * Math.sin(5 * x)))

type Box = { x: number; y: number; w: number; h: number }

const root = document.getElementById('root') as HTMLDivElement

/** Where a node is, in the window. */
function rel(node: Element): Box {
  const w = root.getBoundingClientRect()
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
      if (s.doubleCopy && s.selectKey)
        return [
          { label: 'copy', hotkey: COPY_TWICE, chain: 'listen' },
          { label: 'selection', hotkey: s.selectKey },
        ]
      return [{ label: 'selection', hotkey: s.doubleCopy ? COPY_TWICE : s.selectKey, chain: 'listen' }]
    case 'translate':
      return [
        { label: 'selection', hotkey: s.translateKey, chain: 'translate' },
        { label: 'paste', hotkey: 'Enter' },
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

function keysOf(action: Action, s: Settings, chained = false): HTMLElement[] {
  return keyLines(action, s).flatMap(k => [el('span', { class: 'kl' }, k.label), caps(k.hotkey, chained ? k.chain : undefined)])
}

/** The layouts the keys go through, in order: those chosen that Windows has, or all of them. */
function cycleOf(v: AppView): KeyboardLayout[] {
  const chosen = v.settings.layouts.map(id => v.layouts.find(l => l.id === id)).filter((l): l is KeyboardLayout => !!l)
  return chosen.length > 0 ? chosen : v.layouts
}

/** The natural voice reads: it is here and chosen (Automatic picks it). */
const naturalOn = (v: AppView) => v.natural.status === 'ready' && (v.settings.voice === '' || v.settings.voice.startsWith(NATURAL_PREFIX))
const pairOf = (v: AppView) => `${v.settings.native} ⇄ English`

/** What Dictate runs on: the speech engine, once it is here. */
function engineCap(v: AppView): string {
  const p = v.speech.pack
  if (p.status === 'installing' && !installed(v)) return `downloading ${Math.round((p.progress ?? 0) * 100)}%`
  if (!installed(v)) return 'downloads once'
  const d = v.speech.health?.device
  return d === 'cuda' ? 'Whisper · graphics card' : d === 'cpu' ? 'Whisper · processor' : 'Whisper'
}

/** What an action is called, what it runs on, and what it does. */
function actionText(action: Action, v: AppView): { title: string; cap: string; desc: string } {
  const title = TITLES[action]
  switch (action) {
    case 'listen':
      return { title, cap: naturalOn(v) ? 'natural voice' : 'Windows voice', desc: 'Reads English aloud, the translation under it.' }
    case 'translate':
      return { title, cap: pairOf(v), desc: 'Your text into English. Enter pastes it back.' }
    case 'screen':
      return { title, cap: 'Windows OCR', desc: 'Draw a box over words you can’t select.' }
    case 'dictate':
      return { title, cap: engineCap(v), desc: `Say it and it types. Say it in ${v.settings.native}, get English.` }
    case 'transcribe':
      return { title, cap: 'files · microphone · Meet', desc: 'Talks and meetings into text, speaker by speaker.' }
    case 'keyboard':
      return {
        title,
        cap: cycleOf(v)
          .map(l => l.short)
          .join(' · '),
        desc: v.settings.autoFix ? 'Fixes words typed in the wrong layout as you type.' : 'Switches the layout and fixes what was typed wrong.',
      }
  }
}

// ---------------------------------------------------------------- skeleton

const wordCount = el('span', { class: 'n' })
const pill = (page: Page | 'home', ...children: (HTMLElement | string)[]) =>
  el('button', page === 'home' ? { class: 'pill', 'data-home': true, onclick: () => closePage() } : { class: 'pill', 'data-page': page, onclick: () => openPage(page) }, ...children)
const nav = el(
  'nav',
  { class: 'nav' },
  pill('home', el('span', { class: 'lbl' }, 'Home')),
  pill('words', el('span', { class: 'lbl' }, 'Words'), wordCount),
  pill('transcripts', el('span', { class: 'lbl' }, 'Transcripts')),
  pill('about', el('span', { class: 'lbl' }, 'About')),
  el('span', { class: 'gap' }),
  pill('settings', icon('settings'), el('span', { class: 'lbl' }, 'Settings')),
)
// The window has no Windows frame: the header is its title bar (dragged by
// its empty parts) and ends in the window's own minimize and close.
const winButtons = el(
  'div',
  { class: 'wbtns' },
  el('button', { class: 'icon-btn', title: 'Minimize', 'aria-label': 'Minimize', onclick: () => post({ type: 'window', action: 'minimize' }) }, glyph('minimize')),
  el('button', { class: 'icon-btn', title: 'Close', 'aria-label': 'Close', onclick: () => post({ type: 'window', action: 'close' }) }, glyph('close')),
)
const top = el('header', { class: 'top' }, el('div', { class: 'brand' }, el('span', { class: 'key' }, 'alt'), el('span', { class: 'wm' }, 'altype')), nav, winButtons)
const home = el('main', { class: 'home' })

const pGround = el('div', { class: 'pgg' })
const pBack = el('button', { class: 'pback', onclick: () => back() }, icon('chevron-left'), 'Back', el('span', { class: 'key' }, 'Esc'))
const pTitle = el('span', { class: 'ptitle' })
const pCap = el('span', { class: 'pcap' })
const pKeys = el('div', { class: 'pkeys keys' })
const pLine = el('div', { class: 'pline' })
const pBody = el('div', { class: 'pbody' })
const pg = el('section', { class: 'pg', role: 'dialog' }, pGround, pBack, el('div', { class: 'pth' }, pTitle, pCap), pKeys, pLine, pBody)

root.append(top, home, pg)

function updateNav(): void {
  const n = view?.words.length ?? 0
  wordCount.textContent = n ? String(n) : ''
  for (const b of nav.querySelectorAll<HTMLElement>('.pill')) {
    const page = b.dataset.page
    b.classList.toggle('on', open && !isAction(open.name) ? page === open.name : b.hasAttribute('data-home'))
  }
}

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
  return [el('b', {}, pairOf(v)), ` ${translator} · `, ...voice, ' · runs on this computer']
}

function homeRow(action: Action, v: AppView): HTMLElement {
  const t = actionText(action, v)
  const go = () => openPage(action)
  return el(
    'li',
    {
      class: 'act',
      'data-page': action,
      role: 'button',
      tabindex: 0,
      onclick: go,
      onkeydown: (event: Event) => {
        const key = (event as KeyboardEvent).key
        if (key === 'Enter' || key === ' ') (event.preventDefault(), go())
      },
    },
    el('div', {}, el('div', { class: 'an' }, el('b', {}, t.title), el('i', {}, t.cap)), el('div', { class: 'ad' }, t.desc)),
    el('div', { class: 'keys' }, ...keysOf(action, v.settings, true)),
    icon('chevron-right', 'chev'),
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
    el('ul', { class: 'acts' }, ...ACTIONS.map(a => homeRow(a, v))),
    el('p', { class: 'foot' }, 'Tap an action to change its keys.'),
  ]
}

/** Set while the moment plays or a page grows: Home is redrawn once they are done. */
let homePending = false

function renderHome(force = false): void {
  if (!view) return
  if (moment || animating) {
    homePending = true
    return
  }
  homePending = false
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
  stage.style.top = `${Math.round(Math.max(-40, Math.min(80, (root.clientHeight - 620) / 2)))}px`
  root.append(stage)

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
  if (open) closePage(false)
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

// ---------------------------------------------------------------- pages
// What was tapped grows into the page: a Home row (its title and keys become
// the page's header) or a pill at the top. Back folds it back.

const PD = 0.45 // the spring's length, s (most of it lands by ~0.3 s)

type Growth = {
  source: HTMLElement
  row: boolean
  src: { ground: Box & { r: number }; title: Box; tfont: number; cap: Box | null; keys: Box | null }
  dst: { title: Box; cap: Box; keys: Box; tfont: number }
}

let open: { name: Page } | undefined
let praf = 0
let animating = false

function sourceOf(name: Page): HTMLElement | null {
  return isAction(name) ? home.querySelector<HTMLElement>(`.act[data-page="${name}"]`) : nav.querySelector<HTMLElement>(`[data-page="${name}"]`)
}

/** Where the header's pieces come from (the tapped thing) and where they land. */
function measureGrowth(source: HTMLElement): Growth {
  pTitle.style.transform = ''
  pCap.style.transform = ''
  pKeys.style.transform = ''
  const dst = { title: rel(pTitle), cap: rel(pCap), keys: rel(pKeys), tfont: fontOf(pTitle) }
  const row = source.classList.contains('act')
  const box = rel(source)
  const title = (row ? source.querySelector('.an b') : source.querySelector('.lbl')) ?? source
  const cap = row ? source.querySelector('.an i') : null
  const keys = row ? source.querySelector('.keys') : null
  return {
    source,
    row,
    src: { ground: { ...box, r: row ? 12 : box.h / 2 }, title: rel(title), tfont: fontOf(title), cap: cap ? rel(cap) : null, keys: keys ? rel(keys) : null },
    dst,
  }
}

function renderGrowth(gr: Growth, p: number): void {
  const { src, dst, source } = gr
  const q = clamp(p)
  const W = root.clientWidth
  const H = root.clientHeight
  // The ground: from the tapped thing to the whole window under the title bar.
  const B = top.offsetHeight
  const gs = src.ground
  const gx = lerp(gs.x, 0, p), gy = lerp(gs.y, B, p), gw = lerp(gs.w, W, p), gh = lerp(gs.h, H - B, p), r = lerp(gs.r, 0, q)
  const done = p >= 1
  pGround.style.left = done ? '' : `${gx}px`
  pGround.style.top = done ? '' : `${gy}px`
  pGround.style.width = done ? '' : `${gw}px`
  pGround.style.height = done ? '' : `${gh}px`
  pGround.style.borderRadius = done ? '' : `${r}px`
  // Everything on the page lives inside the growing ground.
  pg.style.clipPath = done ? '' : `inset(${gy}px ${W - gx - gw}px ${H - gy - gh}px ${gx}px round ${r}px)`
  pg.style.visibility = p <= 0 ? 'hidden' : ''
  // The title travels and grows from the row's (or pill's) own word.
  const s0 = src.tfont / dst.tfont
  const s = lerp(s0, 1, p)
  const ty = src.title.y + src.title.h / 2 - (dst.title.y + (dst.title.h * s0) / 2)
  pTitle.style.transform = done ? '' : `translate(${(src.title.x - dst.title.x) * (1 - p)}px, ${ty * (1 - p)}px) scale(${s})`
  if (src.cap) setStyle(pCap, 1, done ? '' : `translate(${(src.cap.x - dst.cap.x) * (1 - p)}px, ${(src.cap.y - dst.cap.y) * (1 - p)}px)`)
  else setStyle(pCap, clamp((p - 0.45) * 2), done ? '' : `translateX(${(1 - q) * -8}px)`)
  // The keys keep their column and only rise.
  pKeys.style.transform = src.keys && !done ? `translate(${(src.keys.x - dst.keys.x) * (1 - p)}px, ${(src.keys.y - dst.keys.y) * (1 - p)}px)` : ''
  // Back, the rule and the body arrive after the move.
  const late = clamp((p - 0.82) / 0.18)
  setStyle(pBack, late, done ? '' : `translateX(${(1 - late) * -10}px)`)
  setStyle(pLine, late, done ? '' : `scaleX(${0.6 + 0.4 * late})`)
  setStyle(pBody, late, done ? '' : `translateY(${(1 - late) * 14}px)`)
  // Home underneath: the other rows slide down and fade.
  for (const row of home.querySelectorAll<HTMLElement>('.act')) {
    if (row === source) continue
    setStyle(row, 1 - clamp(q * 1.5), `translateY(${q * 36}px)`)
  }
  // The tapped row itself is now the page; a pill stays in the title bar, lit.
  if (gr.row) source.style.visibility = p > 0 ? 'hidden' : ''
  source.classList.toggle('pressed', p <= 0)
}

function resetHome(): void {
  for (const node of root.querySelectorAll<HTMLElement>('.act, .nav .pill')) {
    node.style.transform = ''
    node.style.opacity = ''
    node.style.visibility = ''
    node.classList.remove('pressed')
  }
}

/** Runs the page's spring from closed to open (or back), then `done`. */
function grow(gr: Growth, opening: boolean, done?: () => void): void {
  cancelAnimationFrame(praf)
  if (FROZEN_PT !== undefined && opening) return renderGrowth(gr, FROZEN_PT >= PD ? 1 : pspring(FROZEN_PT / PD))
  animating = true
  const t0 = performance.now()
  const tick = (now: number) => {
    const t = (now - t0) / 1000
    const k = t >= PD ? 1 : pspring(t / PD)
    renderGrowth(gr, opening ? k : 1 - k)
    if (t < PD) praf = requestAnimationFrame(tick)
    else {
      animating = false
      done?.()
      if (homePending) renderHome()
    }
  }
  praf = requestAnimationFrame(tick)
}

function openPage(name: Page, animate = !reduced.matches): void {
  if (!view || open?.name === name) return
  if (moment) finishMoment()
  if (open) closePage(false)
  open = { name }
  search = ''
  pickedLayout = ''
  addingApp = false
  keyTrouble = undefined
  if (name === 'transcripts') enterTranscripts()
  fillHeader()
  pBody.replaceChildren()
  renderBody()
  pBody.scrollTop = 0
  root.classList.add('page-open')
  updateNav()
  const source = sourceOf(name)
  const settle = () => pBack.focus({ preventScroll: true })
  if (!source || !animate) {
    resetHome()
    for (const node of [pg, pGround, pTitle, pCap, pKeys, pBack, pLine, pBody]) node.removeAttribute('style')
    return settle()
  }
  const gr = measureGrowth(source)
  renderGrowth(gr, 0)
  grow(gr, true, settle)
}

/** Back (or Esc): from a transcript to the library first, from anything else to Home. */
function back(): void {
  if (open?.name === 'transcripts' && backToList()) return
  closePage()
}

function closePage(animate = !reduced.matches): void {
  if (!open) return
  const name = open.name
  if (name === 'transcripts') leaveTranscripts()
  const done = () => {
    root.classList.remove('page-open')
    pg.style.visibility = ''
    pg.style.clipPath = ''
    resetHome()
    open = undefined
    updateNav()
    if (homePending) renderHome()
  }
  cancelAnimationFrame(praf)
  animating = false
  const source = sourceOf(name)
  if (!source || !animate) return done()
  const back = pg.contains(document.activeElement)
  grow(measureGrowth(source), false, () => {
    done()
    if (back) source.focus({ preventScroll: true })
  })
}

function fillHeader(): void {
  if (!view || !open) return
  const name = open.name
  const v = view
  pTitle.textContent = TITLES[name]
  pCap.textContent = isAction(name)
    ? actionText(name, v).cap
    : name === 'words'
      ? v.words.length
        ? `${v.words.length} saved · from your cards`
        : 'none yet · from your cards'
      : name === 'about'
        ? `Altype ${v.version}`
        : name === 'transcripts'
          ? transcriptsCap()
          : ''
  const keys = isAction(name) ? keysOf(name, v.settings) : []
  const next = el('div', {}, ...keys)
  if (next.innerHTML !== pKeys.innerHTML) pKeys.replaceChildren(...next.childNodes)
}

/** Set when the body changed while it was in use (a key being recorded, a box typed in): drawn once it is let go. */
let bodyPending = false
let pointerDown = false

function busy(): boolean {
  const a = document.activeElement
  return !!a && pBody.contains(a) && (a.matches('input[type=text], input[type=search], input[type=password], input[type=range]') || (a as HTMLElement).isContentEditable || a.classList.contains('recording'))
}

function renderBody(): void {
  if (!view || !open) return
  const next = el('div', {}, ...bodyOf(open.name, view))
  if (next.innerHTML === pBody.innerHTML) return
  if (busy()) {
    bodyPending = true
    return
  }
  bodyPending = false
  const scroll = pBody.scrollTop
  pBody.replaceChildren(...next.childNodes)
  pBody.scrollTop = scroll
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

function bodyOf(name: Page, v: AppView): HTMLElement[] {
  switch (name) {
    case 'listen':
      return listenPage(v)
    case 'translate':
      return translatePage(v)
    case 'screen':
      return screenPage(v)
    case 'dictate':
      return dictatePage(v)
    case 'transcribe':
      return transcribePage(v)
    case 'transcripts':
      return transcriptsBody(v)
    case 'keyboard':
      return keyboardPage(v)
    case 'words':
      return wordsPage(v)
    case 'settings':
      return settingsPage(v)
    case 'about':
      return aboutPage(v)
  }
}

// ---------------------------------------------------------------- page parts

/** A sample to select and try the keys on, right here. */
function tryIt(text: string, how: string): HTMLElement {
  return el('div', { class: 'try' }, el('p', {}, text), el('small', {}, how))
}

// ---------------------------------------------------------------- keys on pages

type KeyName = 'selectKey' | 'snipKey' | 'translateKey' | 'textKey' | 'switchKey' | 'fixKey' | 'dictateKey' | 'englishKey' | 'noteKey'

const KEY_USE: Record<KeyName, string> = {
  selectKey: 'listening to the selection',
  snipKey: 'listening to a piece of the screen',
  translateKey: 'translating the selection',
  textKey: 'translating a piece of the screen',
  switchKey: 'switching the layout',
  fixKey: 'fixing the layout',
  dictateKey: 'dictating',
  englishKey: 'dictating in English',
  noteKey: 'dictating a note',
}

/** Saves a key unless another use has it already. */
function saveKey(name: KeyName, key: string): void {
  const s = view?.settings
  const other = s && (Object.keys(KEY_USE) as KeyName[]).find(n => n !== name && s[n] === key)
  if (other) {
    keyTrouble = { name, text: `${hotkeyLabel(key)} is already for ${KEY_USE[other]}.` }
    return renderBody()
  }
  keyTrouble = undefined
  save({ [name]: key })
}

/**
 * A key of an action, recorded from a press: Change (or a tap on the keys)
 * listens for keys with modifiers, a modifier tapped alone or twice (it waits
 * a moment for a second tap), modifiers pressed together, Pause or Caps Lock
 * alone, the mouse's side buttons. Esc gives up; × clears the key.
 */
function keyRow(name: KeyName, label: string, note: string, taken = false): HTMLElement {
  const current = view?.settings[name] ?? ''
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
    saveKey(name, key)
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
            save({ [name]: '' })
          },
        },
        icon('close'),
      )
    : null
  const trouble = keyTrouble?.name === name ? keyTrouble.text : ''
  return row(
    label,
    [note, taken && current ? bad('Taken by another program; choose another.') : null, trouble ? bad(trouble) : null],
    el('span', { class: 'kchg' }, field, clear, linkBtn(current ? 'Change' : 'Set', () => field.click())),
  )
}

/** A key that cannot be changed, shown where it works. */
const fixedKey = (label: string, hotkey: string, note?: string) => row(label, [note], caps(hotkey))

// ---------------------------------------------------------------- action pages

function listenPage(v: AppView): HTMLElement[] {
  const s = v.settings
  const how = s.doubleCopy ? 'Select this text, press Ctrl + C twice.' : s.selectKey ? `Select this text, press ${said(s.selectKey)}.` : 'Turn on Ctrl + C twice or set a key above, then select this text.'
  return [
    grp('Keys'),
    row(
      'Copied text',
      ['press Ctrl + C twice, quickly'],
      el('span', { class: 'kchg' }, caps(COPY_TWICE), el('span', { class: 'tgwrap' }, toggleKnob(s.doubleCopy, doubleCopy => save({ doubleCopy }), 'Ctrl + C twice'))),
    ),
    keyRow('selectKey', 'Selected text', s.selectKey ? 'Altype copies the selection itself' : 'one key, if you want one', !v.keysOk.select),
    keyRow('snipKey', 'A piece of the screen', 'draw a box over the words', !v.keysOk.snip),
    grp('In the card'),
    row('Play or stop · step through sentences', [], el('span', { class: 'kg2' }, caps('Space'), caps('←'), caps('→'))),
    row('A word: its meanings, its sound, a star to keep it in Words', ['click it'], null),
    row('A sentence: its translation marked', ['click it · ▶ in the margin reads one paragraph'], null),
    row('Close, and stop the voice', [], caps('Esc')),
    tryIt('The morning was quiet. A small boat drifted along the river, and two children watched the ducks from the bridge.', how),
  ]
}

const TRY_TRANSLATE: Record<string, string> = {
  Russian: 'Конечно, пришлю обновлённые макеты до созвона.',
  Ukrainian: 'Звісно, надішлю оновлені макети до дзвінка.',
}

function translatorChip(v: AppView): [HTMLElement, string] {
  switch (v.translator) {
    case 'ready':
      return [chip('ready'), 'translator · on this computer']
    case 'absent':
      return [chip('on first use', 'off'), 'downloads once from Mozilla on the first translation, then works offline']
    case 'downloading':
      return [chip('downloading'), 'downloading once from Mozilla']
    case 'failed':
      return [chip('failed', 'bad'), 'could not download; the next translation tries again']
    case 'unsupported':
      return [chip('not offered', 'off'), 'Firefox Translations has no offline model for this language yet']
  }
}

function translatePage(v: AppView): HTMLElement[] {
  const s = v.settings
  const [state, note] = translatorChip(v)
  const text = TRY_TRANSLATE[s.native] ?? 'Of course, I will send the updated layouts before the call.'
  const how = s.translateKey ? `Select it, ${usage(s.translateKey)}.` : 'Set a key above, then select it and press the key.'
  return [
    grp('Keys'),
    keyRow('translateKey', 'Selected text', s.translateKey ? usage(s.translateKey) : 'one key: Left Ctrl twice, for example', !v.keysOk.translate),
    keyRow('textKey', 'A piece of the screen', 'draw a box over the words', !v.keysOk.text),
    fixedKey('Paste the translation over the selection', 'Enter'),
    grp('Languages'),
    row(pairOf(v), [note], state),
    tryIt(text, how),
  ]
}

function screenPage(v: AppView): HTMLElement[] {
  return [
    grp('Keys'),
    keyRow('snipKey', 'Listen to a piece of the screen', '', !v.keysOk.snip),
    keyRow('textKey', 'Translate a piece of the screen', '', !v.keysOk.text),
    grp('How'),
    row('Windows dims the screen; draw a box over the words', [], null),
    row('Windows OCR reads them on this computer', ['in the languages Windows can read; add one there'], linkBtn('Languages…', () => post({ type: 'openLanguageSettings' }))),
    row('Fix what it misread in the card, then translate', [], null),
  ]
}

/** A folder or file, in a note: its end shows when it is long. */
const pathNote = (path: string) => el('small', { class: 'path', title: path }, el('bdi', {}, path))

async function prepareDictation(): Promise<void> {
  try {
    await api('POST', '/dictate/prepare')
  } catch (error) {
    fault(error)
  }
}

/** Where notes go: the knowledge base folder and the folder inside it, the engine's own settings. */
function kbRows(v: AppView): HTMLElement[] {
  const e = engineSettings(v)
  if (!running(v) || !e) return [row('Folder', [installed(v) ? 'shown once the speech engine runs' : 'chosen once the speech engine is here'], null)]
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
    row('Folder', [e.kbDir ? pathNote(e.kbDir) : 'not chosen · notes need one; an Obsidian vault will do'], linkBtn(e.kbDir ? 'Change' : 'Choose…', () => void pickKb())),
    row('Notes go into', ['a folder inside it · empty: the folder itself'], inbox),
  ]
}

function dictatePage(v: AppView): HTMLElement[] {
  const s = v.settings
  const k = v.speech.keysOk
  const offer = engineRows(v, 'Dictate')
  return [
    ...(offer.length ? [grp('Speech engine'), ...offer] : []),
    grp('Keys'),
    keyRow('dictateKey', 'Dictate', 'types what you say where the cursor is', !k.dictate),
    keyRow('englishKey', 'Dictate in English', `say it in ${s.native}, English is typed`, !k.english),
    keyRow('noteKey', 'A note', 'kept in the knowledge base as a .md file', !k.note),
    row('Tap the key, talk, tap it again', ['Esc while it records throws it away'], null),
    grp('Knowledge base'),
    ...kbRows(v),
    ...(running(v) ? [grp('Speech model'), modelRow('Dictation', v.speech.health?.models.dictation, 'downloads with the first phrase', () => void prepareDictation())] : []),
    el('p', { class: 'privacy' }, icon('lock'), 'Speech is recognized on this computer; nothing is sent anywhere.'),
  ].filter((n): n is HTMLElement => n !== null)
}

const copyText = (text: string) => void window.tutorHost.call({ call: 'copy', text }).then(() => toast(`Copied: ${text}`), fault)

/** How to record a Google Meet call: the Chrome extension, loaded from Altype's folder. */
function meetRows(v: AppView): HTMLElement[] {
  const dir = v.speech.extensionDir
  return [
    row('1 · In Chrome, open chrome://extensions and turn on Developer mode', [], linkBtn('Copy address', () => copyText('chrome://extensions'))),
    row('2 · Load unpacked, then pick the extension’s folder', [pathNote(dir)], linkBtn('Show the folder', () => post({ type: 'showInFolder', path: dir }))),
    row('3 · In a meeting: the Altype icon → Record, or the key', ['the call’s sound and your microphone'], caps(MEET_KEY)),
    row('4 · If the key does nothing, set it at chrome://extensions/shortcuts', [], linkBtn('Copy address', () => copyText('chrome://extensions/shortcuts'))),
  ]
}

function transcribePage(v: AppView): HTMLElement[] {
  const offer = engineRows(v, 'Transcribe')
  return [
    ...(offer.length ? [grp('Speech engine'), ...offer] : []),
    ...(running(v) ? [grp('New transcription'), ...newRows(v)] : []),
    ...(installed(v) ? [grp('Speakers'), ...speakerRows(v)] : []),
    grp('Google Meet'),
    ...meetRows(v),
    ...(running(v)
      ? [
          grp('Speech model'),
          modelRow('Transcription', v.speech.health?.models.transcripts, 'downloads with the first transcription'),
          row('Every transcript, searched by its words', [], linkBtn('Transcripts', () => openPage('transcripts'))),
        ]
      : []),
  ].filter((n): n is HTMLElement => n !== null)
}

/** Windows' layouts as chips, in the order the keys go through them; a tap on one shows how to move it or leave it out. */
function layoutChips(v: AppView): HTMLElement {
  const cycle = cycleOf(v)
  const ids = cycle.map(l => l.id)
  const rest = v.layouts.filter(l => !ids.includes(l.id))
  const at = ids.indexOf(pickedLayout)
  const move = (to: number) => {
    const next = ids.filter(id => id !== pickedLayout)
    next.splice(to, 0, pickedLayout)
    save({ layouts: next })
  }
  const pick = (id: string) => {
    pickedLayout = pickedLayout === id ? '' : id
    renderBody()
  }
  const picked = cycle[at]
  return row(
    'In this order',
    [picked ? `${picked.name} · move it, or leave it out` : 'tap one to move it or leave it out'],
    el(
      'span',
      { class: 'chips' },
      ...cycle.map(l => el('button', { class: l.id === pickedLayout ? 'chip lit' : 'chip', title: l.name, 'aria-pressed': String(l.id === pickedLayout), onclick: () => pick(l.id) }, l.short)),
      ...rest.map(l => el('button', { class: 'chip off', title: `Add ${l.name}`, onclick: () => save({ layouts: [...ids, l.id] }) }, `+ ${l.short}`)),
      picked
        ? el(
            'span',
            { class: 'chipctl' },
            el('button', { class: 'ib', title: 'Earlier', 'aria-label': 'Earlier', disabled: at === 0, onclick: () => move(at - 1) }, icon('arrow-left')),
            el('button', { class: 'ib', title: 'Later', 'aria-label': 'Later', disabled: at === ids.length - 1, onclick: () => move(at + 1) }, icon('arrow-right')),
            // The last one left cannot go: the keys need a layout to go to.
            linkBtn(
              'Leave out',
              () => {
                pickedLayout = ''
                save({ layouts: ids.filter(id => id !== picked.id) })
              },
              ids.length === 1,
            ),
          )
        : null,
    ),
  )
}

/** Removable chips: programs left out, words kept as typed. */
function chipList(items: readonly string[], remove: (item: string) => void): HTMLElement {
  return el(
    'div',
    { class: 'chiprow' },
    ...items.map(item => el('span', { class: 'chip' }, item, el('button', { class: 'ib', title: 'Remove', 'aria-label': `Remove ${item}`, onclick: () => remove(item) }, icon('close')))),
  )
}

function programsRow(v: AppView): HTMLElement[] {
  const s = v.settings
  const add = (exe: string) => {
    const name = exe.trim().toLowerCase()
    addingApp = false
    if (!name) return renderBody()
    const apps = view?.settings.fixApps ?? s.fixApps
    save({ fixApps: [...apps, /\.exe$/.test(name) ? name : `${name}.exe`] })
  }
  const input = addingApp
    ? el('input', {
        type: 'text',
        class: 'field',
        placeholder: 'program.exe',
        'aria-label': 'Program to leave out',
        onkeydown: (event: Event) => {
          const key = (event as KeyboardEvent).key
          if (key === 'Enter') add((event.target as HTMLInputElement).value)
          if (key === 'Escape') (event.preventDefault(), (addingApp = false), renderBody())
        },
      })
    : null
  if (input) window.setTimeout(() => input.focus(), 0)
  const suggest = v.lastApp && !s.fixApps.includes(v.lastApp) ? linkBtn(`Add ${v.lastApp}`, () => add(v.lastApp ?? '')) : null
  return [
    row(
      'Not in these programs',
      [s.fixApps.length ? 'words typed there are never fixed by themselves' : 'none'],
      el(
        'span',
        { class: 'kchg' },
        input,
        suggest,
        input
          ? null
          : linkBtn('Add…', () => {
              addingApp = true
              renderBody()
            }),
      ),
    ),
    s.fixApps.length ? chipList(s.fixApps, exe => save({ fixApps: s.fixApps.filter(a => a !== exe) })) : null,
  ].filter((n): n is HTMLElement => n !== null)
}

/** Other programs at the keyboard, named calmly: no harm, so the person knows who else is there. */
function othersLine(v: AppView): HTMLElement | null {
  const presses = 'presses keys by itself; Altype ignores those.'
  const text = v.keyboardApps.length
    ? `Also using the keyboard: ${v.keyboardApps.join(', ')}.${v.foreignKeys ? ` One of them ${presses}` : ''}`
    : v.foreignKeys
      ? `A program ${presses}`
      : ''
  return text ? el('p', { class: 'aside' }, icon('info'), text) : null
}

function keyboardPage(v: AppView): HTMLElement[] {
  const s = v.settings
  const sample = sampleOf(s.native)
  const [typed = '', fixed = ''] = [sample.typed.split(' ')[0], sample.fixed.split(' ')[0]]
  return [
    grp('Keys'),
    keyRow('switchKey', 'Switch the layout', s.switchKey && usage(s.switchKey).startsWith('tap') ? 'tap it alone' : 'to the next of the layouts below'),
    keyRow('fixKey', 'Fix what was typed wrong', 'since the last click, or the selection'),
    grp('Layouts'),
    layoutChips(v),
    toggle('Fix words as I type', s.autoFix, autoFix => save({ autoFix }), `${typed} → ${fixed} on the space · Backspace takes it back`),
    toggle('Show the layout by the cursor', s.layoutBadge, layoutBadge => save({ layoutBadge })),
    ...(s.autoFix ? programsRow(v) : []),
    s.keepWords.length ? row('Kept as typed', ['a fix was taken back from them']) : null,
    s.keepWords.length ? chipList(s.keepWords, word => save({ keepWords: s.keepWords.filter(w => w !== word) })) : null,
    v.rivals.length ? warn(`${v.rivals.join(' and ')} ${v.rivals.length > 1 ? 'are' : 'is'} running: turn off its layout switching, or words get fixed twice.`) : null,
    v.keyboardTrouble ? warn(`The keyboard helper: ${v.keyboardTrouble}`) : null,
    othersLine(v),
    el('p', { class: 'privacy' }, icon('lock'), 'Altype looks only at the keys of what you are typing, keeps nothing and sends nothing anywhere.'),
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
      return row('Natural voice', [`Kokoro · ${n.size} MB · downloads once, then reads on this computer`], download('Download'))
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

/** What the updater is doing, said in a few words. */
function updateText(u: UpdateStatus): string {
  switch (u.status) {
    case 'dev':
      return 'a run from source does not update'
    case 'checking':
      return 'checking…'
    case 'none':
      return 'this is the latest version'
    case 'downloading':
      return 'downloading an update…'
    case 'ready':
      return `version ${u.version} is ready: it installs when Altype quits`
    case 'failed':
      return `could not check: ${u.message}`
    default:
      return ''
  }
}

/** Remove was tapped once: it asks. */
let removingSpeech = false

const PART_NAMES = { core: 'speech to text', gpu: 'graphics card', speakers: 'speakers' } as const

/** Settings → Speech engine: its parts, the card, the service, where things live, Restart and Remove. */
function speechSettings(v: AppView): HTMLElement[] {
  const sp = v.speech
  const p = sp.pack
  const h = sp.health
  const head = grp('Speech engine')
  const out: (HTMLElement | null)[] = [head]
  if (!installed(v)) {
    const offer = engineRows(v, 'Dictate and Transcribe')
    if (p.status === 'installing' || p.status === 'removing') return [head, ...offer]
    return [head, row('Not downloaded', ['for Dictate and Transcribe · downloads once, then works offline'], linkBtn('Set up…', () => openPage('dictate')))]
  }
  const work = engineRows(v, '')
  const add = (part: 'gpu' | 'speakers', mb: number) =>
    el('button', { class: 'chip off', title: `Add · ≈${mb} MB`, disabled: p.status !== 'ready', onclick: () => post({ type: 'installSpeech', parts: [part] }) }, `+ ${PART_NAMES[part]}`)
  out.push(
    row(
      'Parts',
      [(p.nvidia && !hasPart(v, 'gpu')) || !hasPart(v, 'speakers') ? 'downloaded once · tap one to add it' : 'all downloaded, once'],
      el(
        'span',
        { class: 'chips' },
        ...p.parts.map(part => chip(PART_NAMES[part])),
        p.nvidia && !hasPart(v, 'gpu') ? add('gpu', sp.download.gpu) : null,
        !hasPart(v, 'speakers') ? add('speakers', sp.download.speakers) : null,
      ),
    ),
  )
  out.push(...work)
  const service = { off: 'off', starting: 'starting…', ready: h?.busy ? 'running · transcribing now' : 'running', down: 'stopped' }[sp.service]
  out.push(
    row(
      'Graphics card',
      [
        !p.nvidia
          ? 'none found · runs on the processor'
          : !hasPart(v, 'gpu')
            ? 'NVIDIA found · add its part to use it'
            : h?.device === 'cpu'
              ? 'NVIDIA found, but the engine runs on the processor'
              : 'NVIDIA · speech is recognized on it',
      ],
      null,
    ),
    row('Service', [`${service} · 127.0.0.1:${sp.port}`, sp.trouble ? bad(sp.trouble) : null], linkBtn('Restart', () => post({ type: 'restartSpeech' }), p.status !== 'ready')),
  )
  if (h) {
    out.push(
      row('Transcripts are kept in', [pathNote(h.dataDir)], linkBtn('Open', () => post({ type: 'openPath', path: h.dataDir }))),
      row('Notes go to', [h.kbDir ? pathNote(h.kbDir) : 'no knowledge base folder yet'], linkBtn(h.kbDir ? 'Change' : 'Choose…', () => void pickKb())),
    )
  }
  out.push(
    row(
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

function settingsPage(v: AppView): HTMLElement[] {
  const s = v.settings
  const u = v.update
  const voiceNote = naturalOn(v) ? `natural · ${v.natural.size} MB, on this computer` : 'a Windows voice'
  return [
    grp('Language and voice'),
    row(
      'Your language',
      [],
      select(
        s.native,
        v.languages.map(l => [l.name, `${l.native} · ${l.name}`]),
        native => save({ native }),
      ),
    ),
    row('Voice', [voiceNote], select(s.voice, voiceOptions(v), voice => save({ voice }))),
    naturalRow(v),
    row(
      'Speed',
      [],
      seg(
        s.rate,
        RATES.map(r => [r, String(r)]),
        rate => save({ rate }),
        true,
      ),
    ),
    row(
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
    grp('The card'),
    toggle('Read aloud when a card opens', s.autoRead, autoRead => save({ autoRead })),
    toggle('Dotted line under less common words', s.rareWords, rareWords => save({ rareWords })),
    toggle('Listen reads one sentence at a time', s.oneAtATime, oneAtATime => save({ oneAtATime })),
    row(
      'Word meanings on',
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
    grp('This computer'),
    toggle('Start with Windows', s.startWithWindows, startWithWindows => save({ startWithWindows })),
    row(
      `Version ${v.version}`,
      [u.status === 'failed' ? bad(updateText(u)) : updateText(u)],
      linkBtn('Check for updates', () => post({ type: 'checkUpdates' }), u.status === 'dev' || u.status === 'checking' || u.status === 'downloading'),
    ),
    ...speechSettings(v),
  ].filter((n): n is HTMLElement => n !== null)
}

// ---------------------------------------------------------------- about

function aboutPage(v: AppView): HTMLElement[] {
  const update = updateText(v.update)
  const fact = (term: string, ...detail: (HTMLElement | string)[]) => [el('dt', {}, term), el('dd', {}, ...detail)]
  return [
    el(
      'div',
      { class: 'about' },
      el('div', { class: 'mk' }, el('span', { class: 'key bigkey' }, 'alt'), el('span', { class: 'bigwm' }, 'altype')),
      el('p', { class: 'tag' }, 'Your language. ', el('span', {}, 'Your shortcut.')),
      el('p', { class: 'ver' }, `Version ${v.version}${update ? ` · ${update}` : ''} · free and open source, MIT`),
      el(
        'dl',
        { class: 'facts' },
        ...fact('made by', 'Yevhen Peshynskyi · Design automation engineer', el('br'), link('https://ikstro.com', 'ikstro.com')),
        ...fact(
          'on this computer',
          'Firefox Translations by Mozilla · Kokoro-82M by hexgrad, eSpeak NG · Windows OCR · WikDict, from Wiktionary · FrequencyWords by Hermit Dave ',
          el('span', { class: 'q' }, '— your text is never sent anywhere'),
        ),
        ...fact('made with', 'Inter and JetBrains Mono (SIL OFL) · Electron · VS Code icons'),
        ...fact('uses the network', `Updates, and each part once: the translator for your language, the natural voice (${v.natural.size} MB), word meanings`),
        ...fact(
          'links',
          link('https://github.com/ikstro/altype/releases', 'Releases and what changed'),
          ' · ',
          link('https://github.com/ikstro/altype', 'Source on GitHub'),
          ' · ',
          link('https://github.com/ikstro/altype/blob/main/NOTICE', 'Licenses'),
        ),
      ),
    ),
  ]
}

// ---------------------------------------------------------------- messages

function showTab(tab: AppTab): void {
  if (tab === 'home' || tab === 'howto') closePage()
  else openPage(tab)
}

/** The first `app` message: Home, the moment if it has not played yet, or the place asked for. */
function start(v: AppView): void {
  const asked = askedTab && askedTab !== 'home' && askedTab !== 'howto' ? askedTab : undefined
  // A place asked for wins; the moment waits for an opening that starts at Home.
  if (askedTranscript) return openTranscript(askedTranscript)
  if (asked) return openPage(asked, false)
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
  if (m.type !== 'app') return
  const first = view === undefined
  view = m.view
  if (m.view.speech.service !== 'ready') forgetEngine()
  updateNav()
  renderHome()
  if (open) {
    fillHeader()
    renderBody()
  }
  if (first) start(m.view)
})

// A click or a key during the moment takes it to its end.
window.addEventListener('pointerdown', () => moment && moment.raf && finishMoment(), true)
window.addEventListener('keydown', event => {
  if (moment?.raf) return finishMoment()
  if (event.defaultPrevented) return
  if (event.key === 'Escape' && open) {
    event.preventDefault()
    back()
  }
})

onRedraw(() => {
  fillHeader()
  renderBody()
})
setTranscriptHooks({
  view: () => view,
  shown: () => open?.name === 'transcripts',
  show: () => openPage('transcripts'),
  setup: () => openPage('transcribe'),
})

post({ type: 'appReady' })
