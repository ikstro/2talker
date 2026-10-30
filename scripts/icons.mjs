// Draws Krya's pictures. The app icon is K3, the duck {•> on a black rounded
// tile, white braces and eye and a duck-yellow beak, as the tray on a dark
// taskbar (build/icon.svg; I1's yellow tile until 2026-10-30): build/icon.png (512 px),
// build/icon.ico (16, 24, 32, 48, 256: the installer and the program) and
// media/icon.png (128 px, the window); from 24 px up it is drawn from the SVG's
// numbers, at 16 the whole picture is set pixel by pixel, the tile's corners too. The tray's icon is T2, {•>
// without a tile, the braces and the eye in ink and the beak in the duck's
// colour, for either taskbar: media/tray-light.png (ink on a light taskbar)
// and tray-dark.png, each with its @2x (32 px), tray-*-paused.png (the same at
// 45 %, while Krya is paused), and tray-recording.png, a red dot, while
// anything records. The tray's pictures are pixels at 16, each pixel doubled
// at 32. All of it is drawn on a canvas, whose pixels keep their transparency
// in an ordinary page; the SVG is copied to media/. Run under Electron:
// npm run icons.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { app, BrowserWindow } from 'electron'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The tile's black, the drawing's white and the beak's yellow (build/icon.svg); the characters of TILE_16. */
const TILE = { k: '#141414', w: '#FFFFFF', y: '#FFD60A' }
/** The tray's colours by the taskbar's theme: the ink of Windows' own glyphs there, and the duck's colour (theme.css `--duck`). */
const TASKBAR = {
  light: { '#': '#1b1b1b', y: '#F2A100' },
  dark: { '#': '#f2f2f2', y: '#FFD60A' },
}
/** Recording: a plain red dot, Windows' own record red; the same as theme.css `--rec` (the dictation badge's dot). */
const RECORD = { r: '#E81123' }

// K3 at 16 px, pixel by pixel (the lab's K3-16): k the tile, w the braces and the eye, y the beak, . clear.
const TILE_16 = [
  '..kkkkkkkkkkkk..',
  '.kkkkkkkkkkkkkk.',
  'kkkkkkkkkkkkkkkk',
  'kkkkwwkkkkkkkkkk',
  'kkkwwkwwkyykkkkk',
  'kkkwwkwwkkyykkkk',
  'kkkwwkkkkkkyykkk',
  'kkwwkkkkkkkkyykk',
  'kkwwkkkkkkkkyykk',
  'kkkwwkkkkkkyykkk',
  'kkkwwkkkkkyykkkk',
  'kkkwwkkkkyykkkkk',
  'kkkkwwkkkkkkkkkk',
  'kkkkkkkkkkkkkkkk',
  '.kkkkkkkkkkkkkk.',
  '..kkkkkkkkkkkk..',
]
// T2: {•> without a tile; the brace's point high, the beak's tip level with it, 2 px between the eye and the beak.
const BARE = ['', '', '....###', '...##.....yy', '...##.##...yy', '...##.##....yy', '..##.........yy', '..##.........yy', '...##.......yy', '...##......yy', '...##.....yy', '...##', '...##', '....###']
/** A round dot of radius `r` on a `size` grid, as rows. */
const disc = (size, r) => [...Array(size)].map((_, y) => [...Array(size)].map((_, x) => ((x + 0.5 - size / 2) ** 2 + (y + 0.5 - size / 2) ** 2 <= r * r ? 'r' : '.')).join(''))

/** Runs in the page: the app icon at `size` (24 px and up), as a PNG data URL. */
function drawTile(size, c) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')
  // build/icon.svg's numbers, on its 256-unit grid.
  g.scale(size / 256, size / 256)
  g.fillStyle = c.k
  g.beginPath()
  g.roundRect(16, 16, 224, 224, 52)
  g.fill()
  g.lineWidth = 18
  g.lineCap = g.lineJoin = 'round'
  g.translate(-4, -2)
  g.strokeStyle = c.w
  g.stroke(new Path2D('M118 58C92 58 84 68 84 88V96C84 108 78 114 62 114C78 114 84 120 84 132V174C84 194 92 202 118 202'))
  g.strokeStyle = c.y
  g.stroke(new Path2D('M166 86L202 114L166 142'))
  g.fillStyle = c.w
  g.beginPath()
  g.arc(136, 98, 13, 0, Math.PI * 2)
  g.fill()
  return canvas.toDataURL('image/png')
}

/** Runs in the page: `rows` of pixels on a 16 grid in `colours` (by character), each pixel `scale` wide, `alpha` opaque. */
function drawPixels(rows, colours, scale, alpha) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = rows.length * scale
  const g = canvas.getContext('2d')
  g.globalAlpha = alpha
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (!colours[ch]) return
      g.fillStyle = colours[ch]
      g.fillRect(x * scale, y * scale, scale, scale)
    }),
  )
  return canvas.toDataURL('image/png')
}

/** An .ico holding PNG pictures, smallest first. */
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  let offset = header.length
  pngs.forEach(([size, png], i) => {
    const at = 6 + 16 * i
    header.writeUInt8(size >= 256 ? 0 : size, at)
    header.writeUInt8(size >= 256 ? 0 : size, at + 1)
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(png.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...pngs.map(([, png]) => png)])
}

async function main() {
  const win = new BrowserWindow({ width: 320, height: 240, show: false, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html,<!DOCTYPE html><html><body></body></html>')
  const png = url => Buffer.from(url.split(',')[1], 'base64')
  const run = async (fn, ...args) => png(await win.webContents.executeJavaScript(`(${fn.toString()})(${args.map(a => JSON.stringify(a)).join(', ')})`))
  const pad = rows => [...Array(16)].map((_, y) => (rows[y] || '').padEnd(16, '.'))
  const tile = size => (size === 16 ? run(drawPixels, TILE_16, TILE, 1, 1) : run(drawTile, size, TILE))
  const pngs = []
  for (const size of [16, 24, 32, 48, 256]) pngs.push([size, await tile(size)])
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico(pngs))
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), await tile(512))
  fs.writeFileSync(path.join(root, 'media', 'icon.png'), await tile(128))
  // The tray: 16 px and its @2x, which Electron takes on a screen at 200 %.
  const tray = async (name, rows, colours, alpha = 1) => {
    fs.writeFileSync(path.join(root, 'media', `${name}.png`), await run(drawPixels, rows, colours, 1, alpha))
    fs.writeFileSync(path.join(root, 'media', `${name}@2x.png`), await run(drawPixels, rows, colours, 2, alpha))
  }
  for (const [theme, colours] of Object.entries(TASKBAR)) {
    await tray(`tray-${theme}`, pad(BARE), colours)
    await tray(`tray-${theme}-paused`, pad(BARE), colours, 0.45)
  }
  // The dot is round at either size: its 32 px picture is drawn on a 32 grid, not doubled.
  fs.writeFileSync(path.join(root, 'media', 'tray-recording.png'), await run(drawPixels, disc(16, 5.5), RECORD, 1, 1))
  fs.writeFileSync(path.join(root, 'media', 'tray-recording@2x.png'), await run(drawPixels, disc(32, 11), RECORD, 1, 1))
  fs.copyFileSync(path.join(root, 'build', 'icon.svg'), path.join(root, 'media', 'icon.svg'))
  win.destroy()
}

app.whenReady().then(main).then(
  () => app.quit(),
  error => {
    console.error(error)
    app.exit(1)
  },
)
