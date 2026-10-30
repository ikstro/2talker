import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { adoptLocalFolder, adoptOldFolders, hasToMove, holdersIn, leftIn, moveDownloads, parseProcesses, partDir, removeOldUpdaterCaches, repairSpeech, whyLeft } from './oldfolder'

const made: string[] = []
afterEach(() => made.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })))

function temp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  made.push(dir)
  return dir
}

function put(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

test('2Talker\'s folder moves over to Krya\'s, item by item, never over what is there; tu-talk fills the gaps', () => {
  const appData = temp('krya-appdata-')
  const at = (file: string) => path.join(appData, file)
  put(at('2Talker/settings.json'), '{"native":"Russian"}')
  put(at('2Talker/words.json'), '[1]')
  put(at('2Talker/models/ru/model.bin'), 'm')
  put(at('tu-talk/voice/voice.onnx'), 'v')
  put(at('tu-talk/settings.json'), '{"old":true}')
  put(at('Krya/dict/de.json'), 'kept')
  put(at('2Talker/dict/de.json'), 'older')
  const userDir = path.join(appData, 'Krya')
  const moved = adoptOldFolders(appData, userDir)
  expect(moved.sort()).toEqual(['2Talker/models', '2Talker/settings.json', '2Talker/words.json', 'tu-talk/voice'])
  expect(fs.readFileSync(path.join(userDir, 'settings.json'), 'utf8')).toBe('{"native":"Russian"}')
  expect(fs.readFileSync(path.join(userDir, 'models/ru/model.bin'), 'utf8')).toBe('m')
  expect(fs.readFileSync(path.join(userDir, 'voice/voice.onnx'), 'utf8')).toBe('v')
  expect(fs.readFileSync(path.join(userDir, 'dict/de.json'), 'utf8')).toBe('kept')
  // A second start moves nothing.
  expect(adoptOldFolders(appData, userDir)).toEqual([])
})

test('Altype\'s folder moves over to Krya\'s first: every file of the app\'s, the log under its new name; Electron\'s caches stay', () => {
  const appData = temp('krya-appdata-')
  const at = (file: string) => path.join(appData, file)
  put(at('Altype/settings.json'), '{"native":"Ukrainian"}')
  for (const name of ['words.json', 'mistakes.json', 'learning.json', 'dictation.json', 'translations.json', 'device.json', 'speech.json', 'extension.json', 'speech.log', 'translate.log']) put(at(`Altype/${name}`), name)
  put(at('Altype/altype.log'), 'history')
  put(at('Altype/GPUCache/data_0'), 'chromium')
  put(at('2Talker/settings.json'), '{"native":"Russian"}')
  put(at('2Talker/words.json'), '[2talker]')
  // Electron made Krya's folder before the move: its lock and caches are there.
  put(at('Krya/lockfile'), '')
  put(at('Krya/GPUCache/data_0'), 'new')
  const userDir = at('Krya')
  const moved = adoptOldFolders(appData, userDir)
  expect(moved).toContain('Altype/settings.json')
  expect(moved).toContain('Altype/altype.log')
  expect(moved.filter(m => m.startsWith('2Talker'))).toEqual([])
  expect(fs.readFileSync(path.join(userDir, 'settings.json'), 'utf8')).toBe('{"native":"Ukrainian"}')
  expect(fs.readFileSync(path.join(userDir, 'words.json'), 'utf8')).toBe('words.json')
  expect(fs.readFileSync(path.join(userDir, 'mistakes.json'), 'utf8')).toBe('mistakes.json')
  expect(fs.readFileSync(path.join(userDir, 'speech.json'), 'utf8')).toBe('speech.json')
  expect(fs.readFileSync(path.join(userDir, 'krya.log'), 'utf8')).toBe('history')
  expect(fs.readFileSync(path.join(userDir, 'GPUCache/data_0'), 'utf8')).toBe('new')
  expect(fs.existsSync(at('Altype/GPUCache/data_0'))).toBe(true)
  expect(adoptOldFolders(appData, userDir)).toEqual([])
})

test('the downloads move from %APPDATA% to %LOCALAPPDATA% once, never over what is there; one that stayed is still found', () => {
  const root = temp('krya-downloads-')
  const roaming = path.join(root, 'Roaming', 'Krya')
  const local = path.join(root, 'Local', 'Krya')
  put(path.join(roaming, 'models/ru/model.bin'), 'm')
  put(path.join(roaming, 'voice/voice.onnx'), 'v')
  put(path.join(roaming, 'dict/de.json'), 'older')
  put(path.join(local, 'dict/de.json'), 'kept')
  put(path.join(roaming, 'settings.json'), '{}')
  expect(moveDownloads(roaming, local).sort()).toEqual(['models', 'voice'])
  expect(fs.readFileSync(path.join(local, 'models/ru/model.bin'), 'utf8')).toBe('m')
  expect(fs.readFileSync(path.join(local, 'dict/de.json'), 'utf8')).toBe('kept')
  expect(fs.existsSync(path.join(roaming, 'settings.json'))).toBe(true)
  expect(partDir('models', local, roaming)).toBe(path.join(local, 'models'))
  // A folder that could not move (in use) is used where it is.
  fs.rmSync(path.join(local, 'dict'), { recursive: true })
  expect(partDir('dict', local, roaming)).toBe(path.join(local, '..', '..', 'Roaming', 'Krya', 'dict'))
  expect(partDir('translate', local, roaming)).toBe(path.join(local, 'translate'))
  expect(moveDownloads(roaming, roaming)).toEqual([])
})

/** A speech engine as uv installs it: a Python with a junction for its minor version, an environment naming it by an absolute path. */
function speechEngine(dir: string): void {
  const full = path.join(dir, 'python', 'cpython-3.12.15-windows-x86_64-none')
  put(path.join(full, 'python.exe'), 'python')
  fs.symlinkSync(full, path.join(dir, 'python', 'cpython-3.12-windows-x86_64-none'), 'junction')
  put(path.join(dir, 'env', 'pyvenv.cfg'), `home = ${path.join(dir, 'python', 'cpython-3.12-windows-x86_64-none')}\nimplementation = CPython\nuv = 0.13.0\n`)
  put(path.join(dir, 'env', 'Lib', 'site-packages', 'numpy', '__init__.py'), '')
  put(path.join(dir, 'models', 'whisper', 'small', 'model.bin'), 'w')
}

test('%LOCALAPPDATA%\\Altype moves to Krya whole, and the speech engine\'s Python points at its new place', () => {
  const local = temp('krya-local-')
  const old = path.join(local, 'Altype')
  const next = path.join(local, 'Krya')
  speechEngine(path.join(old, 'speech'))
  put(path.join(old, 'translate', 'models', 'gemma.gguf'), 'g')
  expect(adoptLocalFolder(old, next)).toEqual(['*'])
  expect(fs.existsSync(old)).toBe(false)
  const speech = path.join(next, 'speech')
  const minor = path.join(speech, 'python', 'cpython-3.12-windows-x86_64-none')
  expect(path.resolve(fs.readlinkSync(minor))).toBe(path.join(speech, 'python', 'cpython-3.12.15-windows-x86_64-none'))
  expect(fs.readFileSync(path.join(minor, 'python.exe'), 'utf8')).toBe('python')
  expect(fs.readFileSync(path.join(speech, 'env', 'pyvenv.cfg'), 'utf8')).toBe(`home = ${minor}\nimplementation = CPython\nuv = 0.13.0\n`)
  expect(fs.readFileSync(path.join(next, 'translate', 'models', 'gemma.gguf'), 'utf8')).toBe('g')
  expect(adoptLocalFolder(old, next)).toEqual([])
})

test('into a Krya folder already there, the parts move one by one, never over what is there; what stays is used from the old folder', () => {
  const local = temp('krya-local-')
  const old = path.join(local, 'Altype')
  const next = path.join(local, 'Krya')
  speechEngine(path.join(old, 'speech'))
  put(path.join(old, 'voice', 'voice.onnx'), 'old voice')
  put(path.join(old, 'models', 'ru', 'model.bin'), 'm')
  put(path.join(next, 'voice', 'voice.onnx'), 'new voice')
  expect(adoptLocalFolder(old, next).sort()).toEqual(['models', 'speech'])
  expect(fs.readFileSync(path.join(next, 'voice', 'voice.onnx'), 'utf8')).toBe('new voice')
  expect(fs.readFileSync(path.join(next, 'speech', 'env', 'pyvenv.cfg'), 'utf8')).toContain(path.join(next, 'speech', 'python'))
  expect(partDir('voice', next, old)).toBe(path.join(next, 'voice'))
  // The old folder keeps what could not go; nothing else uses it.
  expect(fs.existsSync(path.join(old, 'voice'))).toBe(true)
  fs.rmSync(path.join(next, 'models'), { recursive: true })
  fs.renameSync(path.join(next, 'speech'), path.join(old, 'speech'))
  expect(partDir('speech', next, old)).toBe(path.join(old, 'speech'))
})

test('the Python is pointed at its new place whatever case Windows wrote the old one in; another folder is left alone', () => {
  const local = temp('krya-local-')
  const dir = path.join(local, 'Krya', 'speech')
  fs.mkdirSync(path.join(dir, 'env'), { recursive: true })
  const old = path.join(local, 'Altype', 'speech')
  fs.writeFileSync(path.join(dir, 'env', 'pyvenv.cfg'), `home = ${old.toUpperCase()}\\python\\cpython-3.12\r\nother = ${old}-x\\y\r\n`)
  repairSpeech(dir, old)
  expect(fs.readFileSync(path.join(dir, 'env', 'pyvenv.cfg'), 'utf8')).toBe(`home = ${path.resolve(dir)}\\python\\cpython-3.12\r\nother = ${old}-x\\y\r\n`)
})

test('the programs to stop before the move: those run from inside the old folder, never Krya or Altype.exe', () => {
  const text = [
    '4\tSystem\t',
    '120\tpython.exe\tC:\\Users\\you\\AppData\\Local\\Altype\\speech\\env\\Scripts\\python.exe',
    '121\tllama-server.exe\tc:\\users\\YOU\\appdata\\local\\altype\\translate\\engine\\vulkan-ab12\\llama-server.exe',
    '122\tpython.exe\tC:\\Users\\you\\AppData\\Local\\Altype2\\python.exe',
    '123\tpython.exe\tE:\\Cursor\\Krya\\engine\\.venv\\Scripts\\python.exe',
    '124\tAltype.exe\tC:\\Users\\you\\AppData\\Local\\Altype\\Altype.exe',
    '125\tKrya.exe\tC:\\Users\\you\\AppData\\Local\\Altype\\Krya.exe',
    'garbage',
  ].join('\r\n')
  const processes = parseProcesses(text)
  expect(processes.map(p => p.pid)).toEqual([120, 121, 122, 123, 124, 125])
  const holders = holdersIn(processes, 'C:\\Users\\you\\AppData\\Local\\Altype\\', 125)
  expect(holders.map(p => p.pid)).toEqual([120, 121])
})

test('why a part stayed: the program that holds it when Krya knows it, else another program; Krya\'s own copy', () => {
  const busy = Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' })
  expect(whyLeft(busy, [{ pid: 1, name: 'python.exe', path: 'x' }, { pid: 2, name: 'python.exe', path: 'y' }])).toBe('a file in it is in use by python.exe')
  expect(whyLeft(busy)).toBe('a file in it is in use by another program')
  expect(whyLeft(new Error('something else'))).toBe('something else')
})

test('a part in use stays in the old folder and is used there; once let go, the next move takes it', () => {
  const local = temp('krya-local-')
  const old = path.join(local, 'Altype')
  const next = path.join(local, 'Krya')
  put(path.join(old, 'speech', 'models', 'small.bin'), 's')
  put(path.join(old, 'voice', 'voice.onnx'), 'v')
  put(path.join(next, 'dict', 'de.json'), 'kept')
  put(path.join(old, 'dict', 'de.json'), 'older')
  expect(hasToMove(old, next)).toBe(true)
  const fd = fs.openSync(path.join(old, 'speech', 'models', 'small.bin'), 'r')
  const errors = new Map<string, unknown>()
  try {
    expect(adoptLocalFolder(old, next, (_m, error, from) => from && errors.set(path.basename(from), error))).toEqual(['voice'])
    expect(partDir('speech', next, old)).toBe(path.join(old, 'speech'))
    expect(leftIn(old, next, errors)).toEqual([
      { name: 'dict', why: 'Krya has its own' },
      { name: 'speech', why: 'a file in it is in use by another program' },
    ])
  } finally {
    fs.closeSync(fd)
  }
  expect(adoptLocalFolder(old, next)).toEqual(['speech'])
  expect(partDir('speech', next, old)).toBe(path.join(next, 'speech'))
  expect(hasToMove(old, next)).toBe(false)
})

test('the old names\' updater downloads go', () => {
  const local = temp('krya-local-')
  put(path.join(local, 'altype-updater', 'pending', 'Altype-Setup-0.10.2.exe'), 'x')
  put(path.join(local, 'krya-updater', 'pending', 'Krya-Setup-0.11.0.exe'), 'y')
  expect(removeOldUpdaterCaches(local)).toEqual(['altype-updater'])
  expect(fs.existsSync(path.join(local, 'altype-updater'))).toBe(false)
  expect(fs.existsSync(path.join(local, 'krya-updater'))).toBe(true)
})
