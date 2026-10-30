// The tray's panel, in place of Windows' menu, drawn as the window's sidebar
// and kept compact (2026-10-30): the way into the app window at the top (the
// brand with the version, or Open) with Altype's state, then Actions (the
// copied text, a text to type or check, a piece of the screen, with their
// keys; the note and Transcripts once the engine is in), Quick settings, and
// a footer of Pause, Settings and Quit. A menu
// in behaviour: ↑ ↓ move, Enter runs, Esc or a click elsewhere puts it away
// (the main process hides it, and after any command). Everything shown comes
// in one `tray` message, sent again whenever any of it changes.

import { hotkeyLabel } from '../hotkey'
import type { Settings } from '../settings'
import type { ToHost, ToView, TrayCommand, TrayView, TutorHost } from '../protocol'
import { dwmFlag, el } from './dom'
import { caps } from './keycaps'
import { lucide, type LucideName } from './lucide'

declare global {
  interface Window {
    tutorHost: TutorHost
  }
}

dwmFlag()

const post = (message: ToHost) => window.tutorHost.post(message)

const root = document.getElementById('root') as HTMLDivElement

/** One command: a full-width row, its icon, its keys at the right end (none when it has no key). */
function command(id: string, icon: LucideName, label: string, run: TrayCommand, hotkey = ''): HTMLElement {
  return el(
    'button',
    { class: 'cmd', 'data-nav': true, 'data-id': id, onclick: () => post({ type: 'tray', command: run }) },
    lucide(icon, 's'),
    el('span', { class: 'l' }, label),
    hotkey ? caps(hotkey) : null,
  )
}

type Switch = 'autoFix' | 'switchOn' | 'layoutBadge' | 'trayLayout' | 'doubleCopy' | 'paused'

/** One quick setting: saved at once, and the panel stays, as a switch is not a command. */
function toggle(id: Switch, icon: LucideName, label: string, on: boolean): HTMLElement {
  const knob = el('span', { class: on ? 'tg on' : 'tg' })
  const row: HTMLElement = el(
    'button',
    {
      class: 'cmd',
      'data-nav': true,
      'data-id': id,
      role: 'switch',
      'aria-checked': String(on),
      onclick: () => {
        const next = row.getAttribute('aria-checked') !== 'true'
        row.setAttribute('aria-checked', String(next))
        knob.classList.toggle('on', next)
        post({ type: 'saveSettings', patch: { [id]: next } as Partial<Settings> })
      },
    },
    lucide(icon, 's'),
    el('span', { class: 'l' }, label),
    knob,
  )
  return row
}

/** The footer's Pause: a switch that names what a press does, Resume (in amber) while paused; the panel stays. */
function pauseButton(paused: boolean): HTMLElement {
  return el(
    'button',
    {
      class: paused ? 'fb paused' : 'fb',
      'data-nav': true,
      'data-id': 'paused',
      role: 'switch',
      'aria-checked': String(paused),
      title: paused ? 'Keys and Ctrl+C twice are off' : 'Every key and reaction off until resumed',
      onclick: () => post({ type: 'saveSettings', patch: { paused: !paused } }),
    },
    lucide(paused ? 'play' : 'pause', 's'),
    paused ? 'Resume' : 'Pause',
  )
}

/** A group of rows under its name, as the sidebar's groups are. */
function group(label: string, ...rows: (HTMLElement | null)[]): HTMLElement {
  return el('section', { class: 'sec' }, el('div', { class: 'grp' }, label), ...rows)
}

/** Altype's state in a few words: paused, or whether the translator for the person's language is here; nothing when there is nothing to say. */
function status(v: TrayView): HTMLElement | null {
  if (v.paused) return el('span', { class: 'st paused', title: 'Keys and Ctrl+C twice are off' }, el('span', { class: 'dot' }), 'paused')
  switch (v.translator) {
    case 'ready':
      return el('span', { class: 'st', title: `${v.native} ⇄ English, offline` }, el('span', { class: 'dot' }), 'ready')
    case 'downloading':
      return el('span', { class: 'st' }, 'downloading…')
    case 'absent':
      return el('span', { class: 'st' }, 'translator on first use')
    default:
      return null
  }
}

function render(v: TrayView): void {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.id : undefined
  const openApp = () => post({ type: 'tray', command: 'open' })
  // The brand opens the window too; Open is the one the keys reach. The version beside it: a run from source says so, and when it was built.
  const version = el('span', { class: 'ver', title: `Built ${v.build}` }, v.dev ? `${v.version} dev` : v.version)
  const brand = el('button', { class: 'brand', tabindex: '-1', title: 'Open Altype', onclick: openApp }, el('span', { class: 'key mark' }, 'alt'), el('span', { class: 'wm' }, 'altype'), version)
  const open = el('button', { class: 'open', 'data-nav': true, 'data-id': 'open', onclick: openApp }, 'Open')
  const panel = el(
    'div',
    { class: 'panel' },
    el('header', { class: 'head' }, brand, el('div', { class: 'side' }, status(v), open)),
    group(
      'Actions',
      command('listenCopied', 'volume-2', 'Listen to the copied text', 'listenCopied', v.keys.listenCopied),
      command('translateCopied', 'languages', 'Translate the copied text', 'translateCopied'),
      command('typeToTranslate', 'type', 'Type to translate…', 'typeToTranslate'),
      command('checkEnglish', 'graduation-cap', 'Check my English…', 'checkEnglish'),
      command('listenScreen', 'scan', 'Listen to a screen snip', 'listenScreen', v.keys.snipListen),
      command('translateScreen', 'scan', 'Translate a screen snip', 'translateScreen', v.keys.snipTranslate),
      v.speech.installed ? command('note', 'notebook-pen', v.speech.recording ? 'Save the note' : 'New note', 'note', v.speech.noteKey) : null,
      v.speech.installed ? command('transcripts', 'file-text', 'Transcripts', 'transcripts') : null,
    ),
    group(
      'Quick settings',
      toggle('autoFix', 'spell-check', 'Fix the layout as I type', v.autoFix),
      v.keys.switch ? toggle('switchOn', 'keyboard', `Switch layouts with ${hotkeyLabel(v.keys.switch)}`, v.switchOn) : null,
      toggle('layoutBadge', 'type', 'Show the layout by the cursor', v.layoutBadge),
      toggle('trayLayout', 'keyboard', 'Show the layout in the tray', v.trayLayout),
      toggle('doubleCopy', 'copy', 'Ctrl+C twice listens', v.doubleCopy),
    ),
    el(
      'footer',
      { class: 'foot' },
      pauseButton(v.paused),
      el('button', { class: 'fb', 'data-nav': true, 'data-id': 'settings', onclick: () => post({ type: 'tray', command: 'settings' }) }, lucide('settings', 's'), 'Settings'),
      el('button', { class: 'fb', 'data-nav': true, 'data-id': 'quit', onclick: () => post({ type: 'tray', command: 'quit' }) }, lucide('power', 's'), 'Quit'),
    ),
  )
  root.replaceChildren(panel)
  // A change while the panel is open keeps the focus where it was.
  if (focused) focusRow(root.querySelector<HTMLElement>(`[data-id="${focused}"]`))
}

/**
 * Focuses a row and marks it: the mark is what lights, as `:focus` does not
 * match while the window is not yet active (the moment it is shown).
 */
function focusRow(node: HTMLElement | null | undefined): void {
  if (!node) return
  node.focus()
  for (const other of root.querySelectorAll('.cur')) if (other !== node) other.classList.remove('cur')
  node.classList.add('cur')
}

/** The rows ↑ and ↓ move through, top to bottom. */
const navs = () => [...root.querySelectorAll<HTMLElement>('[data-nav]')]

function move(by: number): void {
  const all = navs()
  if (!all.length) return
  const at = all.indexOf(document.activeElement as HTMLElement)
  const next = at < 0 ? (by > 0 ? 0 : all.length - 1) : (at + by + all.length) % all.length
  focusRow(all[next])
}

// The highlight follows the input in use: the pointer's row, or the focused
// row once a key is pressed; never both, and no ring when the panel just opened.
const byKeys = (on: boolean) => document.body.classList.toggle('keys', on)

window.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault()
    return post({ type: 'trayClose' })
  }
  byKeys(true)
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    move(event.key === 'ArrowDown' ? 1 : -1)
  }
})
window.addEventListener('pointermove', () => byKeys(false))
// Tab moves the focus too.
window.addEventListener('focusin', event => {
  if (event.target instanceof HTMLElement && event.target.dataset.nav !== undefined) focusRow(event.target)
})

window.addEventListener('message', (event: MessageEvent<ToView>) => {
  if (event.source !== window) return
  const m = event.data
  if (m.type === 'tray') render(m.view)
  else if (m.type === 'trayShown') {
    byKeys(false)
    // The first command, not Open: the panel is mostly opened to run one.
    focusRow(root.querySelector<HTMLElement>('.cmd[data-nav]'))
  }
})

// The window is as tall as the panel, with the page's border above and below.
new ResizeObserver(() => post({ type: 'trayHeight', px: Math.ceil(document.body.getBoundingClientRect().height) + 2 })).observe(document.body)

post({ type: 'trayReady' })
