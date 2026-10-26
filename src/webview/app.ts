// The app window: four tabs. Words, the notebook of saved words with an
// export for Anki; Settings; How to use, with a text to try on; About, the
// author and the parts 2Talker is made of. Everything shown comes from the
// main process in one `app` message, sent again whenever any of it changes;
// every change goes back as a message.

import { NATURAL_PREFIX, NATURAL_VOICES, naturalLabel } from '../natural'
import type { AppTab, AppView, SavedWord, Settings, ToHost, ToView, UpdateStatus } from '../protocol'
import { RATES, type ThemeMode } from '../settings'
import { el, icon } from './dom'
import { acceleratorOf, keyLabel } from './keys'

declare global {
  interface Window {
    tutorHost: { post(message: ToHost): void }
  }
}

const post = (message: ToHost) => window.tutorHost.post(message)

type Tab = AppTab

let view: AppView | undefined
let tab: Tab = 'howto'
/** A tab asked for before the first `app` message. */
let askedTab: Tab | undefined
let search = ''
/** Why the last shortcut was not taken, shown under the shortcuts until another change. */
let keyTrouble = ''

// ---------------------------------------------------------------- skeleton

const root = document.getElementById('root') as HTMLDivElement
const tabs = el('div', { class: 'tabs', role: 'tablist' })
const page = el('div', { class: 'page' })
root.append(tabs, page)

const TABS: [Tab, string][] = [
  ['words', 'Words'],
  ['settings', 'Settings'],
  ['howto', 'How to use'],
  ['about', 'About'],
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
    case 'about':
      page.replaceChildren(...aboutPage(view))
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

type KeyName = 'snipKey' | 'selectKey'

const KEY_USE: Record<KeyName, string> = { snipKey: 'snipping the screen', selectKey: 'translating the selection' }

/** A shortcut recorded from a key press, with a button that clears it. */
function keyField(v: AppView, name: KeyName): HTMLElement[] {
  const current = () => view?.settings[name] ?? ''
  const shown = () => (current() ? keyLabel(current()) : 'Not set')
  const field = el('input', { type: 'text', class: 'key-field', readonly: true, value: shown(), title: 'Click, then press the keys' })
  field.addEventListener('focus', () => {
    field.classList.add('recording')
    field.value = 'Press keys…'
  })
  field.addEventListener('blur', () => {
    field.classList.remove('recording')
    field.value = shown()
  })
  field.addEventListener('keydown', event => {
    event.preventDefault()
    if (event.key === 'Escape') return field.blur()
    const accelerator = acceleratorOf(event)
    if (!accelerator) return
    const other: KeyName = name === 'snipKey' ? 'selectKey' : 'snipKey'
    if (accelerator === v.settings[other]) {
      keyTrouble = `${keyLabel(accelerator)} is already for ${KEY_USE[other]}.`
      field.blur()
      return render()
    }
    keyTrouble = ''
    save({ [name]: accelerator })
    field.blur()
  })
  const clear = el('button', { class: 'icon-btn', title: 'Clear', 'aria-label': 'Clear', disabled: !current(), onclick: () => save({ [name]: '' }) }, icon('close'))
  return [field, clear]
}

function takenLine(ok: boolean): HTMLElement | null {
  return ok ? null : el('span', { class: 'status bad' }, 'Taken by another program; choose another.')
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
    row(
      'Theme',
      select<ThemeMode>(
        s.theme,
        [
          ['system', 'As Windows'],
          ['light', 'Light'],
          ['dark', 'Dark'],
        ],
        theme => save({ theme }),
      ),
    ),
    el('h2', {}, 'The card'),
    check('Read aloud when a card opens', s.autoRead, autoRead => save({ autoRead })),
    check('Dotted line under less common words', s.rareWords, rareWords => save({ rareWords })),
    check('Listen reads one sentence at a time', s.oneAtATime, oneAtATime => save({ oneAtATime })),
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
    check('Ctrl + C twice translates the copied text', s.doubleCopy, doubleCopy => save({ doubleCopy })),
    row('Translate the selection', ...keyField(v, 'selectKey'), takenLine(v.keysOk.select)),
    row('Snip a piece of the screen', ...keyField(v, 'snipKey'), takenLine(v.keysOk.snip)),
    keyTrouble ? el('div', { class: 'row' }, el('span', { class: 'label' }), el('span', { class: 'status bad' }, keyTrouble)) : null,
    el('p', { class: 'muted hint' }, 'The selection shortcut copies the selected text itself: select, press it, and the card opens.'),
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
  const s = view?.settings
  const ways: (HTMLElement | string)[] = []
  if (s?.doubleCopy !== false) ways.push(kbd('Ctrl'), ' + ', kbd('C'), ' twice')
  if (s?.selectKey) ways.push(ways.length ? ' or ' : '', kbd(keyLabel(s.selectKey)))
  const snipKey = s?.snipKey ?? 'Control+Alt+S'
  return [
    el(
      'ol',
      { class: 'steps' },
      ways.length
        ? step('copy', 'Any text', 'Select it in any program and press ', ...ways, '. A card opens by the pointer.')
        : step('copy', 'Any text', 'Turn on Ctrl + C twice, or set a shortcut, in Settings.'),
      snipKey
        ? step('device-camera', 'A piece of the screen', 'Press ', kbd(keyLabel(snipKey)), ' and draw a box over the words. 2Talker reads them from the picture.')
        : step('device-camera', 'A piece of the screen', 'Set a shortcut for it in Settings, or snip from the tray menu.'),
      step('unmute', 'Listen', 'The card reads the English aloud at once. Its translation is under it.'),
    ),
    el('h2', {}, 'Try it here'),
    el('p', { class: 'muted' }, 'Select the text below, then press ', ...(ways.length ? ways : ['the shortcut']), '.'),
    el(
      'div',
      { class: 'try' },
      'The morning was quiet. A small boat drifted along the river, and two children watched the ducks from the bridge.',
    ),
    el('h2', {}, 'In the card'),
    el(
      'ul',
      { class: 'tips' },
      el('li', {}, 'Click a word: its meanings, how to say it, and a star to keep it in Words.'),
      el('li', {}, 'Click a sentence to see which line is its translation.'),
      el('li', {}, kbd('Space'), ' plays or stops, ', kbd('←'), ' ', kbd('→'), ' step through the sentences; ', el('b', {}, 'One by one'), ' reads a sentence and waits.'),
      el('li', {}, 'With several paragraphs, the ▶ in the margin reads one paragraph.'),
      el('li', {}, 'The dotted line marks words outside the 3000 most common ones.'),
      el('li', {}, 'Drag an edge of the card to make it wider or taller; it keeps the size.'),
      el('li', {}, 'The pin keeps the card open; ', kbd('Esc'), ' closes it and stops the voice.'),
    ),
  ]
}

// ---------------------------------------------------------------- about

function link(url: string, text: string): HTMLElement {
  return el('a', { href: url, onclick: (event: Event) => (event.preventDefault(), post({ type: 'openLink', url })) }, text)
}

function aboutPage(v: AppView): HTMLElement[] {
  return [
    el(
      'div',
      { class: 'about-head' },
      el('img', { src: 'icon.png', alt: '', width: 56, height: 56 }),
      el('div', {}, el('div', { class: 'about-name' }, '2Talker'), el('div', { class: 'muted' }, `Version ${v.version} · free and open source`)),
    ),
    el('p', {}, 'Select a text, hear it in English. Translation and voice run on your computer: nothing you read leaves it.'),
    el('h2', {}, 'Made by'),
    el(
      'div',
      { class: 'author' },
      el('div', { class: 'about-name' }, 'Yevhen Peshynskyi'),
      el('div', { class: 'muted' }, 'Design automation engineer'),
      el('div', {}, link('https://ikstro.com', 'ikstro.com')),
    ),
    el('h2', {}, 'Project'),
    el(
      'ul',
      { class: 'links' },
      el('li', {}, link('https://github.com/ikstro/2talker', 'Source code on GitHub'), ' · MIT License'),
      el('li', {}, link('https://github.com/ikstro/2talker/releases', 'Releases and what changed')),
    ),
    el('h2', {}, 'Made with'),
    el(
      'ul',
      { class: 'tips' },
      el('li', {}, 'Firefox Translations by Mozilla: the offline translator.'),
      el('li', {}, 'Kokoro-82M by hexgrad: the natural voice. eSpeak NG: pronunciation.'),
      el('li', {}, 'WikDict, from Wiktionary: word meanings.'),
      el('li', {}, 'FrequencyWords by Hermit Dave: the common words.'),
      el('li', {}, 'Electron, VS Code icons. ', link('https://github.com/ikstro/2talker/blob/main/NOTICE', 'Licenses')),
    ),
  ]
}

// ---------------------------------------------------------------- messages

window.addEventListener('message', (event: MessageEvent<ToView>) => {
  if (event.source !== window) return
  const m = event.data
  if (m.type === 'appTab') {
    if (view) show(m.tab)
    else askedTab = m.tab
    return
  }
  if (m.type !== 'app') return
  const first = view === undefined
  view = m.view
  if (first) {
    tab = askedTab ?? (m.view.words.length > 0 ? 'words' : 'howto')
    renderTabs()
  }
  render()
})

renderTabs()
post({ type: 'appReady' })
