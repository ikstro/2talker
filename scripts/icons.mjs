// Draws the Altype mark ("alt" on a keycap in a rounded frame, the shapes of
// build/icon.svg) into the pictures the app uses: build/icon.png (512 px),
// build/icon.ico (16, 24, 32, 48, 256: the installer and the program),
// media/icon.png (128 px, the window and About), media/tray.png and
// tray@2x.png (16 and 32 px), tray-paused.png and its @2x (the same at 45 %,
// while Altype is paused), and copies the SVG to media/. From 32 px up the
// mark is drawn from the SVG's numbers; at 16 and 24 the legend is set pixel
// by pixel, so "alt" stays a word in the tray. It is drawn on a canvas, whose
// pixels keep their transparency in an ordinary page. Run under Electron:
// npm run icons.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { app, BrowserWindow } from 'electron'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const INK = { tile: '#1c2128', edge: '#444c56', cap: '#cdd9e5', ledge: '#768390', ink: '#1c2128' }
// "alt", 8 × 5 pixels: a double-storey a, l, a short t.
const GLYPH = ['....X.X.', 'XX..X.XX', '.XX.X.X.', 'X.X.X.X.', 'XXX.X..X']

/** Runs in the page: draws the mark at `size`, `alpha` opaque, and returns it as a PNG data URL. */
function draw(size, ink, glyph, alpha = 1) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')
  const box = (x, y, w, h, r, fill, stroke, width) => {
    g.beginPath()
    g.roundRect(x, y, w, h, r)
    g.fillStyle = fill
    g.fill()
    if (stroke) {
      g.strokeStyle = stroke
      g.lineWidth = width
      g.stroke()
    }
  }
  const legend = (ox, oy) => {
    g.fillStyle = ink.ink
    glyph.forEach((row, y) => [...row].forEach((c, x) => c === 'X' && g.fillRect(ox + x, oy + y, 1, 1)))
  }
  if (size === 16) {
    box(0, 0, 16, 16, 3.5, ink.tile)
    box(2, 2, 12, 12, 2, ink.ledge)
    box(2, 2, 12, 10, 2, ink.cap)
    legend(4, 4)
  } else if (size === 24) {
    box(0.5, 0.5, 23, 23, 5, ink.tile, ink.edge, 1)
    box(3, 3, 18, 18, 3.5, ink.ledge)
    box(3, 3, 18, 15, 3.5, ink.cap)
    legend(8, 8)
  } else {
    // build/icon.svg's numbers, on its 64-unit grid.
    g.scale(size / 64, size / 64)
    box(1, 1, 62, 62, 14, ink.tile, ink.edge, size >= 128 ? 0.75 : 1.5)
    box(9, 9, 46, 46, 10, ink.ledge)
    box(9, 9, 46, 41, 10, ink.cap)
    g.fillStyle = ink.ink
    g.font = `800 ${size >= 48 ? 17 : 19}px "JetBrains Mono"`
    g.letterSpacing = '-0.5px'
    g.textAlign = 'center'
    g.fillText('alt', 32, 36.5)
  }
  if (alpha === 1) return canvas.toDataURL('image/png')
  // Faded as a whole, so the cap does not let the tile show through.
  const faded = document.createElement('canvas')
  faded.width = faded.height = size
  const f = faded.getContext('2d')
  f.globalAlpha = alpha
  f.drawImage(canvas, 0, 0)
  return faded.toDataURL('image/png')
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
  // The page is a file beside the mark's face, which the canvas draws the legend in.
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'altype-icons-'))
  fs.copyFileSync(path.join(root, 'media', 'fonts', 'jbmono-latin.woff2'), path.join(work, 'jbmono.woff2'))
  fs.writeFileSync(
    path.join(work, 'icons.html'),
    `<!DOCTYPE html><html><head><style>@font-face { font-family: 'JetBrains Mono'; src: url(jbmono.woff2) format('woff2'); font-weight: 100 800; }</style></head><body></body></html>`,
  )
  const win = new BrowserWindow({ width: 320, height: 240, show: false, webPreferences: { offscreen: true } })
  await win.loadFile(path.join(work, 'icons.html'))
  await win.webContents.executeJavaScript(`document.fonts.load('800 17px "JetBrains Mono"').then(() => true)`)
  const at = async (size, alpha = 1) => {
    const url = await win.webContents.executeJavaScript(`(${draw.toString()})(${size}, ${JSON.stringify(INK)}, ${JSON.stringify(GLYPH)}, ${alpha})`)
    return Buffer.from(url.split(',')[1], 'base64')
  }
  const pngs = []
  for (const size of [16, 24, 32, 48, 256]) pngs.push([size, await at(size)])
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico(pngs))
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), await at(512))
  fs.writeFileSync(path.join(root, 'media', 'icon.png'), await at(128))
  fs.writeFileSync(path.join(root, 'media', 'tray.png'), pngs[0][1])
  fs.writeFileSync(path.join(root, 'media', 'tray@2x.png'), pngs[2][1])
  fs.writeFileSync(path.join(root, 'media', 'tray-paused.png'), await at(16, 0.45))
  fs.writeFileSync(path.join(root, 'media', 'tray-paused@2x.png'), await at(32, 0.45))
  fs.copyFileSync(path.join(root, 'build', 'icon.svg'), path.join(root, 'media', 'icon.svg'))
  win.destroy()
  fs.rmSync(work, { recursive: true, force: true })
}

app.whenReady().then(main).then(
  () => app.quit(),
  error => {
    console.error(error)
    app.exit(1)
  },
)
