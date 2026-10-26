// Renders build/icon.svg into the pictures the app uses: build/icon.png
// (512 px, the installer and the program's icon) and media/icon.png (128 px,
// the tray), and copies the SVG to media/. Run under Electron: npm run icons.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { app, BrowserWindow } from 'electron'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SIZE = 512

async function render() {
  const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8')
  const page = `<!DOCTYPE html><html><head><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block;width:${SIZE}px;height:${SIZE}px}</style></head><body>${svg}</body></html>`
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  })
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`)
  await new Promise(resolve => setTimeout(resolve, 300))
  const image = (await win.webContents.capturePage()).resize({ width: SIZE, height: SIZE, quality: 'best' })
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), image.toPNG())
  fs.writeFileSync(path.join(root, 'media', 'icon.png'), image.resize({ width: 128, height: 128, quality: 'best' }).toPNG())
  fs.copyFileSync(path.join(root, 'build', 'icon.svg'), path.join(root, 'media', 'icon.svg'))
  win.destroy()
}

app.whenReady().then(render).then(
  () => app.quit(),
  error => {
    console.error(error)
    app.exit(1)
  },
)
