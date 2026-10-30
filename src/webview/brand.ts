// Krya's logo and icon as the pages draw them (2026-10-30): the text logo
// "Krya (')>" (theme.css `.logo`; the eye ' in the text's colour, the
// parentheses and the beak in the duck's), and the app icon K3, the duck {•>
// on its black tile, white braces and eye and a yellow beak (build/icon.svg's
// shapes), where the logo has no room.

import { el, html } from './dom'

/** The text logo; its size is the place's font size. */
export function logo(): HTMLElement {
  return el(
    'span',
    { class: 'logo', 'aria-label': 'Krya' },
    el('span', {}, 'Krya'),
    el('span', { class: 'duck', 'aria-hidden': 'true' }, '(', el('span', { class: 'eye' }, "'"), ')>'),
  )
}

/** The app icon, `px` pixels square. */
export function tile(px: number): SVGSVGElement {
  const svg = html(
    `<svg class="tile" width="${px}" height="${px}" viewBox="0 0 256 256" aria-hidden="true">` +
      '<rect x="16" y="16" width="224" height="224" rx="52" fill="#141414"/>' +
      '<g transform="translate(-4 -2)" fill="none" stroke-width="18" stroke-linecap="round" stroke-linejoin="round">' +
      '<path stroke="#FFFFFF" d="M118 58C92 58 84 68 84 88V96C84 108 78 114 62 114C78 114 84 120 84 132V174C84 194 92 202 118 202"/><path stroke="#FFD60A" d="M166 86L202 114L166 142"/></g>' +
      '<circle cx="132" cy="96" r="13" fill="#FFFFFF"/></svg>',
  ).firstElementChild
  return svg as SVGSVGElement
}
