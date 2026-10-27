// The tray's panel, in place of Windows' menu: Altype's commands for the
// copied text and for a piece of the screen with their keys, the switch for
// fixing the layout while typing, and the way into the app window or out of
// Altype. A menu in behaviour: ↑ ↓ move, Enter runs, Esc or a click elsewhere
// puts it away (the main process hides it, and after any command). Everything
// shown comes in one `tray` message, sent again whenever any of it changes.

import type { ToHost, ToView, TrayCommand, TrayView } from '../protocol'
import { el } from './dom'
import { caps } from './keycaps'

declare global {
  interface Window {
    tutorHost: { post(message: ToHost): void }
  }
}

const post = (message: ToHost) => window.tutorHost.post(message)

const root = document.getElementById('root') as HTMLDivElement

/** One command: a full-width row, its keys at the right end (none when it has no key). */
function command(label: string, run: TrayCommand, hotkey = ''): HTMLElement {
  return el('button', { class: 'cmd', 'data-nav': true, onclick: () => post({ type: 'tray', command: run }) }, el('span', { class: 'l' }, label), hotkey ? caps(hotkey) : null)
}

const grp = (text: string) => el('div', { class: 'grp' }, text)

/** Whether the translator for the person's language is here, in a few words; nothing when there is nothing to say. */
function status(v: TrayView): HTMLElement | null {
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
  const knob = el('span', { class: v.autoFix ? 'tg on' : 'tg' })
  const fix = el(
    'button',
    {
      class: 'cmd trow',
      'data-nav': true,
      'data-id': 'autoFix',
      role: 'switch',
      'aria-checked': String(v.autoFix),
      // Saved at once; the panel stays, as a switch is not a command.
      onclick: () => {
        const next = fix.getAttribute('aria-checked') !== 'true'
        fix.setAttribute('aria-checked', String(next))
        knob.classList.toggle('on', next)
        post({ type: 'saveSettings', patch: { autoFix: next } })
      },
    },
    el('span', { class: 'l' }, 'Fix the layout as I type'),
    knob,
  )
  const cmds = [
    command('Listen', 'listenCopied', v.keys.listenCopied),
    command('Translate', 'translateCopied'),
    command('Listen', 'listenScreen', v.keys.snipListen),
    command('Translate', 'translateScreen', v.keys.snipTranslate),
  ]
  cmds.forEach((c, i) => (c.dataset.id = String(i)))
  const open = el('button', { class: 'foot-btn', 'data-nav': true, 'data-id': 'open', onclick: () => post({ type: 'tray', command: 'open' }) }, 'Open Altype')
  const quit = el('button', { class: 'foot-btn', 'data-nav': true, 'data-id': 'quit', onclick: () => post({ type: 'tray', command: 'quit' }) }, 'Quit')
  const panel = el(
    'div',
    { class: 'panel' },
    el('header', { class: 'head' }, el('div', { class: 'brand' }, el('span', { class: 'key' }, 'alt'), el('span', { class: 'wm' }, 'altype')), status(v)),
    el('section', { class: 'sec' }, grp('Copied text'), cmds[0], cmds[1]),
    el('section', { class: 'sec' }, grp('A piece of the screen'), cmds[2], cmds[3]),
    el('section', { class: 'sec sw' }, fix),
    el('footer', { class: 'foot' }, open, quit),
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
    focusRow(navs()[0])
  }
})

// The window is as tall as the panel, with the page's border above and below.
new ResizeObserver(() => post({ type: 'trayHeight', px: Math.ceil(document.body.getBoundingClientRect().height) + 2 })).observe(document.body)

post({ type: 'trayReady' })
