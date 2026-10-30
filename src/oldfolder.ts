// The app was called Altype until 0.11 (2026-10-30), 2Talker until 0.3 and
// tu-talk before that. Its folder in %APPDATA% moves over to Krya's once, item
// by item, from the newest old folder that has each item; its folder in
// %LOCALAPPDATA% (the downloads, the translation models, the speech engine)
// moves over too, whole when it can. Nothing already in the new folder is
// replaced; a part that cannot move is used where it is (`partDir`).

import { execFileSync, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { POWERSHELL } from './system32'

/** A move that failed: what was said, the error, and the folder or file that stayed (`from`). */
export type Warn = (message: string, error: unknown, from?: string) => void

/** The app's earlier folder names, newest first. */
export const OLD_FOLDERS = ['Altype', '2Talker', 'tu-talk']
/**
 * What moves: the app's own files, never Electron's caches beside them. The
 * settings and the lists, the device profile, the speech engine's settings and
 * the extension's hello, the logs (the old log under the new name), the
 * updater's id, and the downloads that lived here until 0.10.1.
 */
export const ITEMS: readonly (string | readonly [from: string, to: string])[] = [
  'settings.json', 'words.json', 'dictation.json', 'translations.json', 'learning.json', 'mistakes.json',
  'device.json', 'speech.json', 'extension.json', 'speech.log', 'translate.log', ['altype.log', 'krya.log'],
  '.updaterId', 'models', 'voice', 'dict',
]

/** Moves the old folders' items into `userDir`; returns what moved. A failed move is left behind and reported. */
export function adoptOldFolders(appData: string, userDir: string, warn: Warn = () => undefined): string[] {
  const moved: string[] = []
  for (const oldName of OLD_FOLDERS) {
    const old = path.join(appData, oldName)
    if (same(old, userDir) || !fs.existsSync(old)) continue
    for (const item of ITEMS) {
      const [fromName, toName] = typeof item === 'string' ? [item, item] : item
      const from = path.join(old, fromName)
      const to = path.join(userDir, toName)
      if (!fs.existsSync(from) || fs.existsSync(to)) continue
      try {
        fs.mkdirSync(userDir, { recursive: true })
        fs.renameSync(from, to)
        moved.push(`${oldName}/${fromName}`)
      } catch (error) {
        warn(`Krya: could not move ${from}`, error)
      }
    }
  }
  return moved
}

/**
 * Moves %LOCALAPPDATA%\Altype (`oldDir`) into %LOCALAPPDATA%\Krya (`newDir`):
 * the whole folder in one step when Krya has none yet, else part by part
 * (models, voice, dict, translate, speech), never over what is there. The
 * speech engine's Python remembers where it was installed, so a moved
 * `speech` is set right for its new place (`repairSpeech`). A part that cannot
 * move (a file in use) stays and is used from there. Returns what moved.
 */
export function adoptLocalFolder(oldDir: string, newDir: string, warn: Warn = () => undefined): string[] {
  if (same(oldDir, newDir) || !fs.existsSync(oldDir)) return []
  if (!fs.existsSync(newDir)) {
    try {
      fs.mkdirSync(path.dirname(newDir), { recursive: true })
      fs.renameSync(oldDir, newDir)
      repairSpeech(path.join(newDir, 'speech'), path.join(oldDir, 'speech'), warn)
      return ['*']
    } catch (error) {
      // One file in use stops the whole folder: the parts that can move still do.
      warn(`Krya: could not move ${oldDir} at once`, error, oldDir)
    }
  }
  const moved: string[] = []
  for (const name of fs.readdirSync(oldDir)) {
    const from = path.join(oldDir, name)
    const to = path.join(newDir, name)
    if (fs.existsSync(to)) continue
    try {
      fs.mkdirSync(newDir, { recursive: true })
      fs.renameSync(from, to)
      moved.push(name)
      if (name === 'speech') repairSpeech(to, from, warn)
    } catch (error) {
      warn(`Krya: could not move ${from}`, error, from)
    }
  }
  try {
    if (!fs.readdirSync(oldDir).length) fs.rmdirSync(oldDir)
  } catch {
    // Left for later: it is only an empty folder.
  }
  return moved
}

/**
 * The speech engine moved from `oldDir` to `dir`: its Python is pointed at the
 * new place. uv's environment names its interpreter by an absolute path
 * (`env\pyvenv.cfg` `home`), and uv's Python folder has a junction for the
 * minor version (cpython-3.12-… → cpython-3.12.15-…) with an absolute target;
 * both are rewritten. The packages' hard links into uv's cache move with the
 * folder on the same disk. The command-line launchers in `env\Scripts` keep
 * the old path, but Krya runs `python.exe` itself and never them.
 */
export function repairSpeech(dir: string, oldDir: string, warn: Warn = () => undefined): void {
  const rebase = (text: string) => replaceFolder(text, oldDir, dir)
  const pythons = path.join(dir, 'python')
  if (fs.existsSync(pythons)) {
    for (const name of fs.readdirSync(pythons)) {
      const link = path.join(pythons, name)
      try {
        if (!fs.lstatSync(link).isSymbolicLink()) continue
        const target = fs.readlinkSync(link)
        const moved = rebase(target)
        if (moved === target) continue
        fs.rmSync(link, { force: true, recursive: false })
        fs.symlinkSync(moved, link, 'junction')
      } catch (error) {
        warn(`Krya: could not point ${link} at the new folder`, error)
      }
    }
  }
  const cfg = path.join(dir, 'env', 'pyvenv.cfg')
  try {
    if (!fs.existsSync(cfg)) return
    const text = fs.readFileSync(cfg, 'utf8')
    const moved = rebase(text)
    if (moved !== text) fs.writeFileSync(cfg, moved)
  } catch (error) {
    warn(`Krya: could not point ${cfg} at the new folder`, error)
  }
}

/** `text` with every path under `from` put under `to`, whatever the case Windows wrote it in. */
function replaceFolder(text: string, from: string, to: string): string {
  const escaped = path.resolve(from).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`${escaped}(?=[\\\\/\\r]|$)`, 'gim'), () => path.resolve(to))
}

/** The downloads that lived in %APPDATA% (roamed) until 0.10.1: the Firefox models, the natural voice, the word meanings. */
export const DOWNLOADS = ['models', 'voice', 'dict']

/**
 * Moves the downloads from `userDir` (%APPDATA%\Krya) into `localDir`
 * (%LOCALAPPDATA%\Krya), beside the speech engine and the translation
 * models, so everything Krya downloads is in one folder. Nothing already
 * there is replaced; a failed move is left behind and reported.
 */
export function moveDownloads(userDir: string, localDir: string, warn: Warn = () => undefined): string[] {
  const moved: string[] = []
  if (same(userDir, localDir)) return moved
  for (const name of DOWNLOADS) {
    const from = path.join(userDir, name)
    const to = path.join(localDir, name)
    if (!fs.existsSync(from) || fs.existsSync(to)) continue
    try {
      fs.mkdirSync(localDir, { recursive: true })
      fs.renameSync(from, to)
      moved.push(name)
    } catch (error) {
      warn(`Krya: could not move ${from}`, error, from)
    }
  }
  return moved
}

/**
 * Where a part lives: in `home`, unless it is not there and one of the
 * folders it could not move out of (`left`, in order) still holds it.
 */
export function partDir(name: string, home: string, ...left: string[]): string {
  const here = path.join(home, name)
  if (fs.existsSync(here)) return here
  const found = left.map(dir => path.join(dir, name)).find(dir => fs.existsSync(dir))
  return found ?? here
}

/** Whether `oldDir` holds a part `newDir` has not: only then is there anything to free and move. */
export function hasToMove(oldDir: string, newDir: string): boolean {
  if (same(oldDir, newDir) || !fs.existsSync(oldDir)) return false
  if (!fs.existsSync(newDir)) return true
  try {
    return fs.readdirSync(oldDir).some(name => !fs.existsSync(path.join(newDir, name)))
  } catch {
    return false
  }
}

/** A program running on this computer: its process id, its file name, the full path of its executable. */
export type RunningProcess = { pid: number; name: string; path: string }

/** Windows' list of programs as `PROCESS_SCRIPT` prints it, a line each: "pid<TAB>name<TAB>path". */
export function parseProcesses(text: string): RunningProcess[] {
  return text
    .split(/\r?\n/)
    .map(line => line.split('\t'))
    .filter(f => f.length >= 3 && /^\d+$/.test(f[0]!.trim()) && f[2]!.trim())
    .map(([pid, name, file]) => ({ pid: Number(pid), name: name!.trim(), path: file!.trim() }))
}

/**
 * The programs that keep the old folder's files in use: those run from inside `dir` (the speech
 * engine's python.exe and uv.exe, llama-server.exe, left by Altype or a run from source). Never
 * Krya itself (`self`), and never Altype.exe, which Krya waits for instead (main.ts oldAppRunning).
 */
export function holdersIn(processes: readonly RunningProcess[], dir: string, self = process.pid): RunningProcess[] {
  const root = path.resolve(dir).toLowerCase().replace(/[\\/]+$/, '') + path.sep
  return processes.filter(p => p.pid !== self && p.name.toLowerCase() !== 'altype.exe' && path.resolve(p.path).toLowerCase().startsWith(root))
}

/** Every program Windows lets this user see, with its executable's path (UTF-8, for folders named in any language). */
const PROCESS_SCRIPT = `[Console]::OutputEncoding = [Text.Encoding]::UTF8
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | ForEach-Object { "$($_.ProcessId)\`t$($_.Name)\`t$($_.ExecutablePath)" }`

const PROCESS_ARGS = ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(PROCESS_SCRIPT, 'utf16le').toString('base64')]
const PROCESS_TIMEOUT_MS = 20_000

/** The programs running now, asked of Windows through PowerShell (a second or so); none when it does not answer. */
export function runningProcesses(): RunningProcess[] {
  if (process.platform !== 'win32') return []
  try {
    const out = execFileSync(POWERSHELL, PROCESS_ARGS, { encoding: 'utf8', windowsHide: true, timeout: PROCESS_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] })
    return parseProcesses(out)
  } catch {
    return []
  }
}

/** The same, while Krya goes on (main's thread is never held while PowerShell answers). */
export function runningProcessesSoon(): Promise<RunningProcess[]> {
  if (process.platform !== 'win32') return Promise.resolve([])
  return new Promise(resolve => {
    const child = spawn(POWERSHELL, PROCESS_ARGS, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    let out = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => (out += chunk))
    const timer = setTimeout(() => child.kill(), PROCESS_TIMEOUT_MS)
    child.on('error', () => (clearTimeout(timer), resolve([])))
    child.on('exit', code => (clearTimeout(timer), resolve(code === 0 ? parseProcesses(out) : [])))
  })
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // Running, but not this user's to signal.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Stops the programs run from inside `dir` (`holdersIn`), so its files can move, and waits up to
 * `waitMs` for them to be gone (Windows lets go of a file once its program has exited). Returns
 * those stopped and those still running (another user's, or one that would not stop).
 */
export function freeFolder(dir: string, processes: readonly RunningProcess[] = runningProcesses(), warn: Warn = () => undefined, waitMs = 5000): { stopped: RunningProcess[]; holding: RunningProcess[] } {
  const holders = stopHolders(dir, processes, warn)
  const tick = new Int32Array(new SharedArrayBuffer(4))
  const until = Date.now() + waitMs
  while (holders.some(p => alive(p.pid)) && Date.now() < until) Atomics.wait(tick, 0, 0, 100)
  return settled(holders)
}

/** `freeFolder` while Krya goes on: for a folder nothing is waiting to move (an older speech engine left running). */
export async function freeFolderSoon(dir: string, processes: readonly RunningProcess[], warn: Warn = () => undefined, waitMs = 5000): Promise<{ stopped: RunningProcess[]; holding: RunningProcess[] }> {
  const holders = stopHolders(dir, processes, warn)
  const until = Date.now() + waitMs
  while (holders.some(p => alive(p.pid)) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 100))
  return settled(holders)
}

function stopHolders(dir: string, processes: readonly RunningProcess[], warn: Warn): RunningProcess[] {
  const holders = holdersIn(processes, dir)
  for (const p of holders) {
    try {
      process.kill(p.pid)
    } catch (error) {
      warn(`Krya: could not stop ${p.name} (${p.pid}), run from ${dir}`, error)
    }
  }
  return holders
}

function settled(holders: readonly RunningProcess[]): { stopped: RunningProcess[]; holding: RunningProcess[] } {
  const holding = holders.filter(p => alive(p.pid))
  return { stopped: holders.filter(p => !holding.includes(p)), holding }
}

/** Why a move failed, in the page's words: which program keeps a file in use, when Krya knows it. */
export function whyLeft(error: unknown, holding: readonly RunningProcess[] = []): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
    const names = [...new Set(holding.map(p => p.name))]
    return `a file in it is in use by ${names.length ? names.join(', ') : 'another program'}`
  }
  return error instanceof Error ? error.message : String(error)
}

/** A part still in the old folder, and why it stayed. */
export type LeftPart = { name: string; why: string }

/**
 * What is still in `oldDir` after a move, each with its reason: Krya has its own (the old copy
 * is not used), the error its move met (`errors`, by the part's name, or the whole folder's), or
 * that it was not tried.
 */
export function leftIn(oldDir: string, newDir: string, errors: ReadonlyMap<string, unknown>, holding: readonly RunningProcess[] = []): LeftPart[] {
  if (same(oldDir, newDir) || !fs.existsSync(oldDir)) return []
  let names: string[]
  try {
    names = fs.readdirSync(oldDir)
  } catch (error) {
    return [{ name: path.basename(oldDir), why: whyLeft(error, holding) }]
  }
  const whole = errors.get(path.basename(oldDir))
  return names.map(name => {
    if (fs.existsSync(path.join(newDir, name))) return { name, why: 'Krya has its own' }
    const error = errors.get(name) ?? whole
    return { name, why: error === undefined ? 'not moved yet' : whyLeft(error, holding) }
  })
}

/** electron-updater's download folders, in %LOCALAPPDATA%: the installers already installed (Krya updates by hand since 0.11, from GitHub). */
export const OLD_UPDATER_CACHES = ['altype-updater', '2talker-updater', 'krya-updater']

/** Deletes the old names' updater folders; returns which went. */
export function removeOldUpdaterCaches(localAppData: string, warn: Warn = () => undefined): string[] {
  const gone: string[] = []
  for (const name of OLD_UPDATER_CACHES) {
    const dir = path.join(localAppData, name)
    if (!fs.existsSync(dir)) continue
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      gone.push(name)
    } catch (error) {
      warn(`Krya: could not remove ${dir}`, error)
    }
  }
  return gone
}

function same(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
}
