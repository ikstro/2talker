// The small parts every page of the app window is made of: a group's name,
// a card with its notes and control, a card that opens a page of its own, a
// page that is a list to add to, switches, choices, links and chips.

import type { ToHost } from '../protocol'
import { el, icon } from './dom'
import { lucide, type LucideName } from './lucide'

export const post = (message: ToHost) => window.tutorHost.post(message)

/** A group's name over its cards; `n` is a count after it, `right` a link at the end of the line (Clear). */
export const grp = (text: string, n?: string | number, right?: HTMLElement | null) =>
  el('div', { class: 'grp' }, text, n !== undefined && n !== '' ? el('span', { class: 'n' }, String(n)) : null, right ?? null)
export const bad = (text: string) => el('small', { class: 'bad' }, text)
export type Note = string | HTMLElement | null | undefined | false

const notesOf = (notes: Note[]) => notes.filter(n => !!n).map(n => (typeof n === 'string' ? el('small', {}, n) : n))

/** A line of a page: what it is (with notes under it) and its control on the right. */
export function row(label: string | HTMLElement, notes: Note[], ...controls: (HTMLElement | null)[]): HTMLElement {
  return el('div', { class: 'row' }, el('div', { class: 'l' }, label, ...notesOf(notes)), ...controls)
}

/** A line with an icon before it. */
export function card(name: LucideName, label: string | HTMLElement, notes: Note[], ...controls: (HTMLElement | null)[]): HTMLElement {
  const node = row(label, notes, ...controls)
  node.prepend(lucide(name))
  return node
}

/** A card that opens a page of its own: its value on the right (green with a check when `ok`), then a chevron. */
export function navCard(name: LucideName | null, title: string, note: Note, value: string | null, onOpen: () => void, id = '', ok = false): HTMLButtonElement {
  return el(
    'button',
    { class: 'row navc', 'data-sub': id || undefined, onclick: onOpen },
    name ? lucide(name) : null,
    el('div', { class: 'l' }, title, ...notesOf([note])),
    value ? el('span', { class: ok ? 'v ok' : 'v' }, ok ? lucide('check', 's') : null, value) : null,
    lucide('chevron-right', 'chev'),
  )
}

/** A small round-cornered icon button: remove, earlier, later. */
export function ib(name: LucideName, label: string, onclick: () => void, disabled = false): HTMLButtonElement {
  return el('button', { class: 'ib', title: label, 'aria-label': label, disabled, onclick }, lucide(name))
}

/** A line that is a switch: a tap anywhere on it turns it over at once, before the main process answers. */
export function toggle(label: string, on: boolean, onchange: (on: boolean) => void, ...notes: Note[]): HTMLElement {
  const knob = el('span', { class: on ? 'tg on' : 'tg' })
  const node = el(
    'button',
    {
      class: 'row trow',
      role: 'switch',
      'aria-checked': String(on),
      onclick: () => {
        const next = node.getAttribute('aria-checked') !== 'true'
        node.setAttribute('aria-checked', String(next))
        knob.classList.toggle('on', next)
        onchange(next)
      },
    },
    el('span', { class: 'l' }, label, ...notesOf(notes)),
    knob,
  )
  return node
}

/** A switch with an icon before its line. */
export function toggleCard(name: LucideName, label: string, on: boolean, onchange: (on: boolean) => void, ...notes: Note[]): HTMLElement {
  const node = toggle(label, on, onchange, ...notes)
  node.prepend(lucide(name))
  return node
}

/** A switch without a line of its own (Ctrl + C twice sits by its keys). */
export function toggleKnob(on: boolean, onchange: (on: boolean) => void, label: string): HTMLElement {
  const node = el('button', {
    class: on ? 'tg on' : 'tg',
    role: 'switch',
    'aria-checked': String(on),
    'aria-label': label,
    onclick: () => {
      const next = node.getAttribute('aria-checked') !== 'true'
      node.setAttribute('aria-checked', String(next))
      node.classList.toggle('on', next)
      onchange(next)
    },
  })
  return node
}

/** Choices side by side; the one tapped lights at once. */
export function seg<T extends string | number>(value: T, options: [T, string][], onchange: (value: T) => void, mono = false): HTMLElement {
  const node = el('span', { class: mono ? 'seg mono' : 'seg', role: 'radiogroup' })
  for (const [v, label] of options) {
    const b = el(
      'button',
      {
        class: v === value ? 'on' : '',
        role: 'radio',
        'aria-checked': String(v === value),
        onclick: () => {
          for (const other of node.children) {
            other.classList.toggle('on', other === b)
            other.setAttribute('aria-checked', String(other === b))
          }
          onchange(v)
        },
      },
      label,
    )
    node.append(b)
  }
  return node
}

/** A list to pick from. */
export function select<T extends string | number>(value: T, options: [T, string][], onchange: (value: T) => void): HTMLElement {
  const node = el('select', {
    onchange: event => {
      const raw = (event.target as HTMLSelectElement).value
      const picked = options.find(([v]) => String(v) === raw)?.[0]
      if (picked !== undefined) onchange(picked)
    },
  })
  for (const [v, label] of options) node.append(el('option', v === value ? { value: String(v), selected: true } : { value: String(v) }, label))
  return el('span', { class: 'sel' }, node, lucide('chevron-down', 's'))
}

export const linkBtn = (text: string, onclick: () => void, disabled = false) => el('button', { class: 'link', disabled, onclick }, text)
export const chip = (text: string, cls = '') => el('span', { class: `chip${cls ? ' ' + cls : ''}` }, text)

/** A button: `primary` is the blue one, `danger` the red one. */
export function btn(label: (Node | string)[] | string, onclick: (event: Event) => void, cls = '', title?: string): HTMLButtonElement {
  return el('button', { class: `btn${cls ? ' ' + cls : ''}`, onclick, title, 'aria-label': title }, ...(typeof label === 'string' ? [label] : label))
}

export function link(url: string, text: string): HTMLElement {
  return el('a', { href: url, onclick: (event: Event) => (event.preventDefault(), post({ type: 'openLink', url })) }, text)
}

/** A progress bar, 0…1. */
export function bar(progress: number): HTMLElement {
  const fill = el('i', { class: 'fill' })
  fill.style.width = `${Math.round(progress * 100)}%`
  return el('span', { class: 'bar' }, fill)
}

/** A line for a notice under a page's cards: calm (`aside`), or a fault (`warn`). */
export const aside = (name: LucideName, ...text: (Node | string)[]) => el('p', { class: 'aside' }, lucide(name, 's'), el('span', {}, ...text))
export const warn = (...text: (Node | string)[]) => el('p', { class: 'warn' }, lucide('circle-alert', 's'), el('span', {}, ...text))

/** A field whose typed text survives the page being drawn again: the body moves it over instead of making a new one. */
export function liveField(id: string, placeholder: string, label: string, onkey: (key: string, field: HTMLInputElement) => void): HTMLInputElement {
  const field = el('input', {
    type: 'text',
    class: 'field',
    placeholder,
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': label,
    'data-live': id,
  })
  field.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault()
      onkey(event.key, field)
    }
  })
  return field
}

/**
 * A page that is a list: a card to add to it at the top (a field and Add;
 * Enter adds too, Escape clears), then one card per item with a cross. Items
 * are kept lower case or however `normalize` says; one already there is not
 * added twice.
 */
export function listPage(o: {
  label: string
  placeholder: string
  note?: string
  items: readonly string[]
  count: string
  empty: string
  normalize?: (text: string) => string
  add: (item: string) => void
  remove: (item: string) => void
  itemNote?: (item: string) => string | null
  /** A card after the add card: a suggestion, for instance. */
  extra?: HTMLElement | null
}): HTMLElement[] {
  const norm = o.normalize ?? (t => t.trim())
  const add = (field: HTMLInputElement) => {
    const item = norm(field.value)
    if (!item) return field.focus()
    field.value = ''
    field.focus()
    if (o.items.some(x => x.toLowerCase() === item.toLowerCase())) return
    o.add(item)
  }
  const field = liveField('add', o.placeholder, o.label, (key, f) => (key === 'Enter' ? add(f) : ((f.value = ''), f.blur())))
  const addCard = el(
    'div',
    { class: 'row add' },
    el('div', { class: 'fields' }, field, btn([lucide('plus', 's'), 'Add'], () => add(field), 'primary')),
    o.note ? el('small', {}, o.note) : null,
  )
  const items = o.items.map(item => {
    const note = o.itemNote?.(item)
    return el('div', { class: 'row' }, el('div', { class: 'l' }, item, note ? el('small', {}, note) : null), ib('x', `Remove ${item}`, () => o.remove(item)))
  })
  return [
    grp(o.label),
    addCard,
    o.extra ?? null,
    grp(o.count, o.items.length || undefined),
    ...(items.length ? items : [aside('info', o.empty)]),
  ].filter((n): n is HTMLElement => n !== null)
}

/** Still the codicon glyph where a page draws one by name. */
export { icon }
