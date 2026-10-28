// The small parts every page of the app window is made of: a group's name,
// a line with its notes and control, switches, choices, links and chips.

import type { ToHost } from '../protocol'
import { el, icon } from './dom'

export const post = (message: ToHost) => window.tutorHost.post(message)

export const grp = (text: string) => el('div', { class: 'grp' }, text)
export const bad = (text: string) => el('small', { class: 'bad' }, text)
export type Note = string | HTMLElement | null | undefined | false

const notesOf = (notes: Note[]) => notes.filter(n => !!n).map(n => (typeof n === 'string' ? el('small', {}, n) : n))

/** A line of a page: what it is (with notes under it) and its control on the right. */
export function row(label: string | HTMLElement, notes: Note[], ...controls: (HTMLElement | null)[]): HTMLElement {
  return el('div', { class: 'row' }, el('div', { class: 'l' }, label, ...notesOf(notes)), ...controls)
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

/** A list to pick from, drawn as a pill. */
export function select<T extends string | number>(value: T, options: [T, string][], onchange: (value: T) => void): HTMLElement {
  const node = el('select', {
    onchange: event => {
      const raw = (event.target as HTMLSelectElement).value
      const picked = options.find(([v]) => String(v) === raw)?.[0]
      if (picked !== undefined) onchange(picked)
    },
  })
  for (const [v, label] of options) node.append(el('option', v === value ? { value: String(v), selected: true } : { value: String(v) }, label))
  return el('span', { class: 'sel' }, node, icon('chevron-down'))
}

export const linkBtn = (text: string, onclick: () => void, disabled = false) => el('button', { class: 'link', disabled, onclick }, text)
export const chip = (text: string, cls = '') => el('span', { class: `chip${cls ? ' ' + cls : ''}` }, text)

/** A pill button: `primary` is the blue one, `quiet` has no frame. */
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

/** A line for a notice under a page's rows: calm (`aside`), or a fault (`warn`). */
export const aside = (glyphName: string, ...text: (Node | string)[]) => el('p', { class: 'aside' }, icon(glyphName), el('span', {}, ...text))
export const warn = (...text: (Node | string)[]) => el('p', { class: 'warn' }, icon('warning'), el('span', {}, ...text))
