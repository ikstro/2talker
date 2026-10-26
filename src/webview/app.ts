// The app window: three tabs. Words, the notebook of saved words with an
// export for Anki; Settings; How to use, with a text to try on. Everything
// shown comes from the main process in one `app` message, sent again
// whenever any of it changes; every change goes back as a message.

import { NATURAL_PREFIX, NATURAL_VOICES, naturalLabel } from '../natural'
import type { AppView, SavedWord, Settings, ToHost, ToView, UpdateStatus } from '../protocol'
import { el, icon } from './dom'

declare global {
  interface Window {
    tutorHost: { post(message: ToHost): void }
  }
}

const post = (message: ToHost) => window.tutorHost.post(message)
const RATES = [0.75, 0.9, 1, 1.15, 1.3]

type Tab = 'words' | 'settings' | 'howto'

let view: AppView | undefined
let tab: Tab = 'howto'
let search = ''

// ---------------------------------------------------------------- skeleton

const root = document.getElementById('root') as HTMLDivElement
const tabs = el('div', { class: 'tabs', role: 'tablist' })
const page = el('div', { class: 'page' })
root.append(tabs, page)

const TABS: [Tab, string][] = [
  ['words', 'Words'],
  ['settings', 'Settings'],
  ['howto', 'How to use'],
]

function renderTabs(): void {
  tabs.replaceChildren(
    ...TABS.map(([id, label]) =>
      el('button', { class: 'tab', role: 'tab', 'aria-selected': String(tab === id), onclick: () => show(id) }, label),
    ),
  )
}

function show(next: Tab): void {
  tab = next
  renderTabs()
  render()
}

function render(): void {
  if (!view) return
  switch (tab) {
    case 'words':
      page.replaceChildren(...wordsPage(view))
      return
    case 'settings':
      page.replaceChildren(...settingsPage(view))
      return
    case 'howto':
      page.replaceChildren(...howToPage())
      return
  }
}

// ---------------------------------------------------------------- words

function wordsPage(v: AppView): HTMLElement[] {
  const query = search.trim().toLowerCase()
  const words = query ? v.words.filter(w => `${w.word} ${w.base} ${w.senses.map(s => s[1]).join(' ')}`.toLowerCase().includes(query)) : v.words
  const searchBox = el('input', {
    type: 'search',
    placeholder: 'Search',
    value: search,
    oninput: event => {
      search = (event.target as HTMLInputElement).value
      renderList()
    },
  })
  const list = el('div', { class: 'word-list' })
  const renderList = () => {
    const q = search.trim().toLowerCase()
    const shown = q ? v.words.filter(w => `${w.word} ${w.base} ${w.senses.map(s => s[1]).join(' ')}`.toLowerCase().includes(q)) : v.words
    list.replaceChildren(...(shown.length ? shown.map(wordRow) : [empty(v.words.length ? 'No such word.' : 'No words yet. Click a word in a card and press the bookmark.')]))
  }
  renderList()
  return [
    el(
      'div',
      { class: 'toolbar' },
      searchBox,
      el('button', { class: 'text-btn', disabled: words.length === 0, onclick: () => post({ type: 'exportWords' }) }, 'Export for Anki…'),
      el('button', { class: 'text-btn', disabled: words.length === 0, onclick: () => post({ type: 'copyWords' }) }, 'Copy'),
    ),
    list,
  ]
}

function empty(text: string): HTMLElement {
  return el('div', { class: 'empty' }, text)
}

function wordRow(w: SavedWord): HTMLElement {
  const form = w.word.toLowerCase() !== w.base ? el('span', { class: 'form' }, w.word) : null
  return el(
    'div',
    { class: 'word-row' },
    el('div', {}, el('span', { class: 'word' }, w.base), form),
    el(
      'div',
      { class: 'senses' },
      ...w.senses.flatMap(([pos, translations], i) => [i ? '; ' : '', pos ? el('span', { class: 'pos' }, pos + ' ') : '', translations]),
    ),
    w.sentence ? el('div', { class: 'sentence' }, w.sentence) : el('div'),
    el('button', { class: 'icon-btn', title: 'Remove', 'aria-label': 'Remove', onclick: () => post({ type: 'removeWord', id: w.id }) }, icon('trash')),
  )
}

// ---------------------------------------------------------------- settings

function save(patch: Partial<Settings>): void {
  post({ type: 'saveSettings', patch })
}

function select<T extends string | number>(value: T, options: [T, string][], onchange: (value: T) => void): HTMLSelectElement {
  const node = el('select', {
    onchange: event => {
      const raw = (event.target as HTMLSelectElement).value
      const picked = options.find(([v]) => String(v) === raw)?.[0]
      if (picked !== undefined) onchange(picked)
    },
  })
  for (const [v, label] of options) {
    const option = el('option', { value: String(v) }, label)
    if (v === value) option.selected = true
    node.append(option)
  }
  return node
}

function check(label: string, on: boolean, onchange: (on: boolean) => void): HTMLElement {
  const box = el('input', { type: 'checkbox', onchange: event => onchange((event.target as HTMLInputElement).checked) })
  box.checked = on
  return el('label', { class: 'check' }, box, label)
}

function row(label: string, ...controls: (HTMLElement | string | null)[]): HTMLElement {
  return el('div', { class: 'row' }, el('label', {}, label), ...controls)
}

function voiceOptions(v: AppView): [string, string][] {
  const options: [string, string][] = [['', 'Automatic']]
  if (v.natural.status === 'ready') for (const voice of NATURAL_VOICES) options.push([NATURAL_PREFIX + voice.id, naturalLabel(voice)])
  for (const h of v.hostVoices) if (/^en\b/i.test(h.lang)) options.push([h.name, h.name])
  return options
}

function naturalLine(v: AppView): HTMLElement | null {
  const n = v.natural
  switch (n.status) {
    case 'absent':
    case 'failed':
      return el(
        'div',
        { class: 'row' },
        el('span', { class: 'label' }),
        el('button', { class: 'text-btn', onclick: () => post({ type: 'downloadNatural' }) }, `Download the natural voice · ${n.size} MB`),
        n.status === 'failed' ? el('span', { class: 'status bad' }, 'The download failed.') : null,
      )
    case 'downloading':
      return el('div', { class: 'row' }, el('span', { class: 'label' }), el('span', { class: 'status' }, `Downloading the natural voice… ${Math.round(n.progress * 100)}%`))
    default:
      return null
  }
}

/** The accelerator Electron understands for a key event: "Control+Alt+S". */
export function acceleratorOf(event: KeyboardEvent): string | undefined {
  const mods = [event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super'].filter(Boolean)
  const key = event.key
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return undefined
  let name: string
  if (/^[a-z]$/i.test(key)) name = key.toUpperCase()
  else if (/^[0-9]$/.test(key)) name = key
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) name = key
  else if (key === ' ') name = 'Space'
  else if (['Escape', 'Enter', 'Tab', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown'].includes(key)) name = key
  else if (/^Arrow(Up|Down|Left|Right)$/.test(key)) name = key.slice(5)
  else if (/^`~!@#$%^&*()\-_=+\[\]{};:'",.<>\/?\\|$/.test(key) || key.length === 1) name = key
  else return undefined
  // A letter or digit alone would swallow typing everywhere; a modifier is required.
  if (mods.length === 0 && !/^F\d+$/.test(name)) return undefined
  return [...mods, name].join('+')
}

function keyLabel(accelerator: string): string {
  return accelerator.replace(/CommandOrControl|CmdOrCtrl|Control/g, 'Ctrl')
}

function keyField(v: AppView): HTMLElement {
  const field = el('input', { type: 'text', class: 'key-field', readonly: true, value: keyLabel(v.settings.snipKey), title: 'Click, then press the keys' })
  field.addEventListener('focus', () => {
    field.classList.add('recording')
    field.value = 'Press keys…'
  })
  field.addEventListener('blur', () => {
    field.classList.remove('recording')
    field.value = keyLabel(view?.settings.snipKey ?? '')
  })
  field.addEventListener('keydown', event => {
    event.preventDefault()
    if (event.key === 'Escape') return field.blur()
    const accelerator = acceleratorOf(event)
    if (!accelerator) return
    save({ snipKey: accelerator })
    field.blur()
  })
  return field
}

function updateLine(u: UpdateStatus, version: string): HTMLElement[] {
  const text = (() => {
    switch (u.status) {
      case 'dev':
        return 'A run from source does not update.'
      case 'checking':
        return 'Checking…'
      case 'none':
        return 'This is the latest version.'
      case 'downloading':
        return 'Downloading an update…'
      case 'ready':
        return `Version ${u.version} is ready: it installs when 2Talker quits.`
      case 'failed':
        return `Could not check: ${u.message}`
      default:
        return ''
    }
  })()
  return [
    row(
      'Version',
      el('span', {}, version),
      el('button', { class: 'text-btn', disabled: u.status === 'dev' || u.status === 'checking' || u.status === 'downloading', onclick: () => post({ type: 'checkUpdates' }) }, 'Check for updates'),
    ),
    el('div', { class: 'row' }, el('span', { class: 'label' }), el('span', { class: `status${u.status === 'failed' ? ' bad' : ''}` }, text)),
  ]
}

function settingsPage(v: AppView): HTMLElement[] {
  const s = v.settings
  return [
    el('h2', {}, 'Language and voice'),
    row(
      'Your language',
      select(
        s.native,
        v.languages.map(l => [l.name, `${l.native} · ${l.name}`]),
        native => save({ native }),
      ),
    ),
    row('Voice', select(s.voice, voiceOptions(v), voice => save({ voice }))),
    naturalLine(v),
    row(
      'Speed',
      select(
        s.rate,
        RATES.map(r => [r, r === 1 ? 'Normal' : `${r}×`]),
        rate => save({ rate }),
      ),
    ),
    el('h2', {}, 'The card'),
    check('Read aloud when a card opens', s.autoRead, autoRead => save({ autoRead })),
    check('Dotted line under less common words', s.rareWords, rareWords => save({ rareWords })),
    row(
      'Word meanings on',
      select(
        s.wordHint,
        [
          ['shift', 'click, or Shift + hover'],
          ['hover', 'click, or hover'],
          ['off', 'click only'],
        ],
        wordHint => save({ wordHint }),
      ),
    ),
    el('h2', {}, 'Shortcuts'),
    row('Translate the copied text', el('span', {}, el('kbd', {}, 'Ctrl'), ' + ', el('kbd', {}, 'C'), ' twice')),
    row('Snip a piece of the screen', keyField(v), v.snipKeyOk ? null : el('span', { class: 'status bad' }, 'Taken by another program; choose another.')),
    el('h2', {}, 'Windows'),
    check('Start 2Talker with Windows', s.startWithWindows, startWithWindows => save({ startWithWindows })),
    ...updateLine(v.update, v.version),
  ].filter((n): n is HTMLElement => n !== null)
}

// ---------------------------------------------------------------- how to use

function step(name: string, title: string, ...text: (HTMLElement | string)[]): HTMLElement {
  return el('li', { class: 'step' }, icon(name), el('div', {}, el('b', {}, title), ...text))
}

function howToPage(): HTMLElement[] {
  const kbd = (k: string) => el('kbd', {}, k)
  return [
    el(
      'ol',
      { class: 'steps' },
      step('copy', 'Any text', 'Select it in any program and press ', kbd('Ctrl'), ' + ', kbd('C'), ' twice. A card opens by the pointer.'),
      step('device-camera', 'A piece of the screen', 'Press ', kbd(keyLabel(view?.settings.snipKey ?? 'Control+Alt+S')), ' and draw a box over the words. 2Talker reads them from the picture.'),
      step('unmute', 'Listen', 'The card reads the English aloud at once. Its translation is under it.'),
    ),
    el('h2', {}, 'Try it here'),
    el('p', { class: 'muted' }, 'Select the text below, then press Ctrl+C twice.'),
    el(
      'div',
      { class: 'try' },
      'The morning was quiet. A small boat drifted along the river, and two children watched the ducks from the bridge.',
    ),
    el('h2', {}, 'In the card'),
    el(
      'ul',
      { class: 'tips' },
      el('li', {}, 'Click a word: its meanings, how to say it, and a bookmark to keep it in Words.'),
      el('li', {}, 'Click a sentence to see which line is its translation.'),
      el('li', {}, 'The dotted line marks words outside the 3000 most common ones.'),
      el('li', {}, 'The pin keeps the card open; ', kbd('Esc'), ' closes it and stops the voice.'),
    ),
  ]
}

// ---------------------------------------------------------------- messages

window.addEventListener('message', (event: MessageEvent<ToView>) => {
  if (event.source !== window) return
  const m = event.data
  if (m.type !== 'app') return
  const first = view === undefined
  view = m.view
  if (first) {
    tab = m.view.words.length > 0 ? 'words' : 'howto'
    renderTabs()
  }
  render()
})

renderTabs()
post({ type: 'appReady' })
