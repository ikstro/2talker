// `npm run shots`: Altype's pages in offscreen windows with the real preload, fed view.ts's
// fixtures, pictured into .cache/shots/ (every page and second-level page in both themes, the
// tray panel, the dictation badge with a fake microphone). It never touches the desktop or
// the installed Altype, so it runs while that one runs.
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { appView, trayView } from './view'

import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..', '..').replace(/\\/g, '/')
const OUT = `${ROOT}/.cache/shots`
mkdirSync(OUT, { recursive: true })
app.setPath('userData', `${ROOT}/.cache/shots-userdata`)
app.on('window-all-closed', () => {})

app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const log: string[] = []

function win(page: string, width: number, height: number, bg: string, query?: Record<string, string>): BrowserWindow {
  const w = new BrowserWindow({
    show: false,
    width,
    height,
    frame: false,
    backgroundColor: bg,
    webPreferences: { preload: `${ROOT}/dist/preload.js`, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false },
  })
  w.webContents.setFrameRate(30)
  void w.loadFile(`${ROOT}/media/${page}`, query ? { query } : undefined)
  return w
}

const send = (w: BrowserWindow, message: unknown) => w.webContents.send('to-view', message)
async function shot(w: BrowserWindow, name: string): Promise<void> {
  const image = await w.webContents.capturePage()
  writeFileSync(`${OUT}/${name}.png`, image.toPNG())
  log.push(`${name} ${image.getSize().width}x${image.getSize().height}`)
}
const js = (w: BrowserWindow, code: string) => w.webContents.executeJavaScript(code, true)
const click = (w: BrowserWindow, selector: string) => js(w, `(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return 'missing ' + ${JSON.stringify(selector)}; n.click(); return 'ok' })()`)
const esc = (w: BrowserWindow) => js(w, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 'ok'`)

const colors = () => (nativeTheme.shouldUseDarkColors ? { bg: '#202020', surface: '#2b2b2b' } : { bg: '#f3f3f3', surface: '#fbfbfb' })

// The pages' answers from "main": copies, Chrome, the speech engine's streaming session.
const heard = 'РџСЂРёРІРµС‚, СЌС‚Рѕ РїСЂРѕРІРµСЂРєР° РґРёРєС‚РѕРІРєРё: Р±РµР№РґР¶ РїРѕРєР°Р·С‹РІР°РµС‚ С„СЂР°Р·Сѓ С†РµР»РёРєРѕРј, РїРѕРєР° РµС‘ СЃР»С‹С€РёС‚ РґРІРёР¶РѕРє'
ipcMain.handle('host-call', async (_e, r: { call: string; method?: string; route?: string }) => {
  log.push(`host-call ${JSON.stringify(r).slice(0, 120)}`)
  if (r.call === 'speech') {
    if (r.method === 'PUT') return { ok: true, status: 200, data: { pending: 0, heard } }
    if (r.route?.endsWith('/finish')) return { ok: true, status: 200, data: { text: heard, language: 'ru', sure: true } }
    return { ok: true, status: 200, data: {} }
  }
  if (r.call === 'copy') return true
  if (r.call === 'openChrome') return true
  return null
})

const heights = new Map<number, number>()
ipcMain.on('to-host', (e, m: { type: string; px?: number }) => {
  log.push(`to-host ${e.sender.id} ${JSON.stringify(m).slice(0, 160)}`)
  if ((m.type === 'dictationHeight' || m.type === 'trayHeight') && m.px) heights.set(e.sender.id, m.px)
})

async function appShots(theme: 'dark' | 'light', narrow = false): Promise<void> {
  nativeTheme.themeSource = theme
  // The usual window, and a narrow one where the sidebar keeps only its icons.
  const size = narrow ? [640, 620] : [960, 700]
  const w = win('app.html', size[0]!, size[1]!, colors().bg)
  await new Promise<void>(r => w.webContents.once('did-finish-load', () => r()))
  await sleep(400)
  const v = appView()
  send(w, { type: 'app', view: v })
  send(w, { type: 'appWindow', maximized: false })
  await sleep(700)
  const tag = (n: string) => `app-${theme}${narrow ? '-narrow' : ''}-${n}`
  await shot(w, tag('home'))
  // A place from the sidebar, then each second-level page of it (Esc goes back).
  const page = async (name: string, subs: string[] = [], label = name) => {
    log.push(`${label}: ${await click(w, `.side [data-nav="${name}"]`)}`)
    await sleep(500)
    await shot(w, tag(label))
    for (const sub of subs) {
      log.push(`${label}/${sub}: ${await click(w, `[data-sub="${sub}"]`)}`)
      await sleep(500)
      await shot(w, tag(`${label}-${sub}`))
      await esc(w)
      await sleep(400)
    }
  }
  const home = async () => (await click(w, '.side [data-nav="home"]'), sleep(400))
  if (narrow) {
    await page('keyboard', ['fixing'])
    await page('settings')
  } else if (theme === 'dark') {
    await page('listen')
    await page('translate')
    await page('screen')
    await page('dictate', ['model'])
    await page('transcribe', ['meet', 'model', 'speakers'])
    await page('keyboard', ['fixing'])
    for (const name of ['words', 'transcripts', 'translations', 'phrases', 'vocabulary', 'kept', 'learned', 'programs', 'layouts']) await page(name)
    await page('settings', ['languages'])
    for (const name of ['engine', 'computer', 'about']) await page(name)
    // The search, and a find opened with its line lit.
    log.push(`search: ${await js(w, `(() => { const f = document.querySelector('.find input'); f.value = 'caps'; f.dispatchEvent(new Event('input')); return 'ok' })()`)}`)
    await sleep(500)
    await shot(w, tag('search'))
    log.push(`search find: ${await click(w, '.row.found')}`)
    await sleep(300)
    await shot(w, tag('search-found'))
    await home()
    // Paused: the notice on Home.
    send(w, { type: 'app', view: appView({ paused: true }) })
    await sleep(500)
    await shot(w, tag('home-paused'))
    // Chrome holds an older copy of the extension than Altype's folder.
    const stale = appView()
    stale.speech = { ...stale.speech, extensionShipped: '0.2.1' }
    send(w, { type: 'app', view: stale })
    await sleep(300)
    await page('transcribe', ['meet'], 'transcribe-stale')
    // Who spoke when installed on the card; then the processor picked, so it offers to switch.
    const card = appView()
    card.speech = { ...card.speech, pack: { status: 'ready', parts: ['core', 'gpu', 'speakers'], nvidia: true, speakersOn: 'cuda' }, health: { ...card.speech.health!, diarization: 'ready', parts: { core: true, gpu: true, speakers: true } } }
    send(w, { type: 'app', view: card })
    await sleep(300)
    await home()
    await page('transcribe', ['speakers'], 'tr-installed')
    const cpu = appView({ speakersDevice: 'cpu' })
    cpu.speech = { ...card.speech, speakers: { ...card.speech.speakers, on: 'cpu' } }
    send(w, { type: 'app', view: cpu })
    await sleep(300)
    await home()
    await page('transcribe', ['speakers'], 'tr-switch')
  } else {
    await page('transcribe')
    await page('keyboard', ['fixing'])
    await page('kept')
    await page('settings')
    await page('listen')
  }
  w.destroy()
}

/** The first-run setup: its four steps, Next pressed between them; Download starts nothing here (the host-call answers are stubs). */
async function setupShots(theme: 'dark' | 'light'): Promise<void> {
  nativeTheme.themeSource = theme
  const w = win('app.html', 960, 700, colors().bg)
  await new Promise<void>(r => w.webContents.once('did-finish-load', () => r()))
  await sleep(400)
  send(w, { type: 'app', view: appView({}, true) })
  await sleep(600)
  for (let step = 1; step <= 4; step++) {
    await shot(w, `setup-${theme}-${step}`)
    if (step === 3) {
      await js(w, `document.querySelector('.sbody').scrollTop = 640, 'ok'`)
      await sleep(200)
      await shot(w, `setup-${theme}-3-speakers`)
      await js(w, `document.querySelector('.sbody').scrollTop = 1e5, 'ok'`)
      await sleep(200)
      await shot(w, `setup-${theme}-3-bottom`)
    }
    if (step < 4) {
      log.push(`setup next ${step}: ${await click(w, '.sfoot .btn.primary')}`)
      await sleep(500)
    }
  }
  // A snapshot while the downloads go: the engine installing, the voice half way.
  const v = appView({}, true)
  v.natural = { status: 'downloading', progress: 0.42, size: 170, dismissed: false }
  v.translatorState = { status: 'ready', progress: 1, size: 84 }
  v.speech = { ...v.speech, pack: { status: 'installing', parts: [], installing: ['core', 'gpu'], step: 'packages', progress: 0.3, nvidia: true } }
  send(w, { type: 'app', view: v })
  await sleep(500)
  await shot(w, `setup-${theme}-4-going`)
  w.destroy()
}

async function trayShots(theme: 'dark' | 'light'): Promise<void> {
  nativeTheme.themeSource = theme
  const w = win('tray.html', 340, 560, colors().bg)
  await new Promise<void>(r => w.webContents.once('did-finish-load', () => r()))
  await sleep(300)
  for (const [name, view] of [
    ['ready', trayView()],
    ['paused', trayView({ paused: true })],
  ] as const) {
    send(w, { type: 'tray', view })
    send(w, { type: 'trayShown' })
    await sleep(400)
    const h = heights.get(w.webContents.id)
    if (h) w.setSize(340, h)
    await sleep(300)
    await shot(w, `tray-${theme}-${name}`)
    if (theme === 'light') break
  }
  w.destroy()
}

async function badgeShots(theme: 'dark' | 'light'): Promise<void> {
  nativeTheme.themeSource = theme
  const w = win('dictation.html', 360, 64, colors().surface)
  await new Promise<void>(r => w.webContents.once('did-finish-load', () => r()))
  await sleep(300)
  const fit = async () => {
    const h = heights.get(w.webContents.id)
    if (h) w.setSize(360, Math.max(64, Math.min(180, h)))
    await sleep(250)
  }
  send(w, { type: 'dictation', command: 'start', mode: 'type', key: 'Control+Alt+D', session: 's1', expected: ['ru'] })
  await sleep(900)
  await fit()
  await shot(w, `badge-${theme}-listening`)
  await sleep(2200)
  await fit()
  await shot(w, `badge-${theme}-phrase`)
  send(w, { type: 'dictation', command: 'stop', mode: 'type', key: 'Control+Alt+D' })
  await sleep(250)
  await fit()
  await shot(w, `badge-${theme}-busy`)
  await sleep(1200)
  await fit()
  await shot(w, `badge-${theme}-done`)
  w.destroy()
}

app.whenReady().then(async () => {
  try {
    await appShots('dark')
    await appShots('light')
    await appShots('dark', true)
    await setupShots('dark')
    await setupShots('light')
    await trayShots('dark')
    await trayShots('light')
    await badgeShots('dark')
    await badgeShots('light')
  } catch (error) {
    log.push(`ERROR ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  }
  writeFileSync(`${OUT}/log.txt`, log.join('\n'))
  app.quit()
})
