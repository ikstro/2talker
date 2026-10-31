// Fixtures for `npm run shots`: an AppView and a TrayView as the main process would send them
// (a real plan from planSpeech, an i9 with an RTX 2080 SUPER, the engine running).
import type { DeviceProfile } from '../../src/hardware'
import { LANGUAGES } from '../../src/languages'
import type { AppView, TrayView } from '../../src/protocol'
import { DEFAULTS } from '../../src/settings'
import { planSpeech } from '../../src/speechplan'

const i9: DeviceProfile = {
  cpu: { name: 'Intel(R) Core(TM) i9-9900K CPU @ 3.60GHz', cores: 8, threads: 16 },
  ramGb: 32,
  gpus: [{ name: 'NVIDIA GeForce RTX 2080 SUPER', vendor: 'nvidia', vramMb: 8192, driver: '610.88', computeCap: 7.5 }],
  laptop: false,
  at: 1,
}

const downloaded = ['large-v3-turbo', 'small', 'base', 'parakeet-tdt-0.6b-v3']

export function appView(over: Partial<AppView['settings']> = {}, fresh = false): AppView {
  const plan = planSpeech({
    profile: i9,
    fingerprint: 'fp',
    bench: undefined,
    cuda: !fresh,
    speakersCuda: false,
    speakers: false,
    downloaded: fresh ? [] : downloaded,
    native: 'ru',
    prefer: 'accuracy',
    pins: { dictation: '', transcripts: '' },
  })
  const now = Date.now()
  const v = full(over, plan, now)
  if (!fresh) return v
  // A fresh install: nothing downloaded, the engine absent, the setup not done.
  return {
    ...v,
    settings: { ...v.settings, setupDone: false, introSeen: false, languages: [], vocabulary: [], apps: [], keepWords: [], autoFix: false, layoutBadge: false, ...over },
    natural: { status: 'absent', progress: 0, size: 170, dismissed: false },
    translator: 'absent',
    translatorState: { status: 'absent', progress: 0, size: 84 },
    dictionary: { status: 'ready' },
    speech: { ...v.speech, pack: { status: 'absent', parts: [], nvidia: true }, service: 'off', health: undefined, test: { offer: false, agreed: false, runs: 0 } },
  }
}

function full(over: Partial<AppView['settings']>, plan: AppView['speech']['plan'], now: number): AppView {
  return {
    settings: {
      ...DEFAULTS,
      introSeen: true,
      native: 'Russian',
      languages: ['uk'],
      vocabulary: ['Krya (кря, края)', 'Peshynskyi (пешинский)', 'Paximizer'],
      apps: [
        { exe: 'code.exe', off: ['fix'], layout: '04090409' },
        { exe: 'windowsterminal.exe', off: ['fix', 'badge'], layout: '' },
      ],
      layoutKeys: { '04090409': 'LeftShift*2' },
      keepWords: ['lol'],
      autoFix: true,
      layoutBadge: true,
      translateKey: 'LeftControl*2',
      switchKey: 'LeftControl',
      fixKey: 'Pause',
      dictateKey: 'Control+Alt+D',
      // Changed from Ctrl+Alt+N: its line shows ↺.
      noteKey: 'Control+Shift+N',
      typeCheckKey: 'RightControl*2',
      ...over,
    },
    version: '0.11.0',
    build: '30 Oct, 07:12 (ff17ba8, changed)',
    dev: true,
    natural: { status: 'ready', progress: 1, size: 170, dismissed: false, rtf: 0.3 },
    hostVoices: [{ name: 'Microsoft Zira Desktop', lang: 'en-US' }],
    languages: LANGUAGES.map(l => ({ name: l.name, native: l.native })),
    words: [
      { id: 1, word: 'drifted', base: 'drift', senses: [['verb', 'плыть по течению, дрейфовать']], sentence: 'A small boat drifted along the river.', addedAt: new Date(now - 3600e3).toISOString() },
      { id: 2, word: 'ducks', base: 'duck', senses: [['noun', 'утка']], sentence: 'Two children watched the ducks from the bridge.', addedAt: new Date(now - 86400e3 * 3).toISOString() },
    ],
    update: { status: 'none' },
    keysOk: { snip: true, select: true, translate: true, text: true, inPlace: true, check: true, type: true, typeCheck: true, pause: true, window: true },
    learned: { alwaysFix: [{ word: 'vs', lang: 'ru' }], myWords: [{ word: 'krya', lang: 'en' }, { word: 'пешинский', lang: 'ru' }] },
    elevatedApp: 'taskmgr.exe',
    translations: [
      { at: new Date(now - 300e3).toISOString(), from: 'ru', to: 'en', text: 'Конечно, пришлю обновлённые макеты до созвона.', translation: 'Of course, I will send the updated layouts before the call.' },
      { at: new Date(now - 7200e3).toISOString(), from: 'en', to: 'ru', text: 'Nothing happens.', translation: 'Ничего не происходит.' },
    ],
    translator: 'ready',
    layouts: [
      { id: '04090409', name: 'English (United States)', short: 'EN', lang: 'en' },
      { id: '04190419', name: 'Russian', short: 'RU', lang: 'ru' },
      { id: '04220422', name: 'Ukrainian', short: 'UK', lang: 'uk' },
      { id: '04070407', name: 'German', short: 'DE', lang: 'de' },
    ],
    lastApp: 'obsidian.exe',
    rivals: [],
    keyboardApps: ['AutoHotkey'],
    foreignKeys: false,
    speech: {
      pack: { status: 'ready', parts: ['core', 'gpu'], nvidia: true },
      service: 'ready',
      health: {
        version: '0.2.0',
        device: 'cuda',
        parts: { core: true, gpu: true, speakers: false },
        models: {
          transcripts: { name: 'large-v3-turbo', state: 'ready', device: 'cuda', compute: 'float16' },
          dictation: { name: 'parakeet-tdt-0.6b-v3', state: 'ready', device: 'cpu', compute: 'int8' },
        },
        downloaded,
        extension: { id: 'abcdefghijklmnopabcdefghijklmnop', version: '0.2.0', seen: now / 1000 - 140 },
        fallback: null,
        calibration: { state: 'done', done: 4, total: 4, current: '', message: '', at: '' },
        diarization: 'needs-token',
        diarizationMessage: '',
        busy: null,
        queued: 0,
        dataDir: 'C:\\Users\\you\\Documents\\Krya\\Transcripts',
        kbDir: 'C:\\Users\\you\\Notes',
      },
      port: 8765,
      extensionDir: 'C:\\Users\\you\\AppData\\Local\\Programs\\krya\\resources\\app.asar.unpacked\\extension',
      extensionShipped: '0.2.0',
      download: { core: 160, gpu: 1150, speakers: 3000 },
      installed: { core: 330, gpu: 1700, speakers: 4000 },
      speakers: { on: 'cuda', sizes: { cuda: { download: 3000, installed: 4000 }, cpu: { download: 250, installed: 900 } }, model: true },
      firstModel: { cpu: { model: 'Parakeet', mb: 0, phrase: 0.3 }, cuda: { model: 'Whisper turbo', mb: 0, phrase: 0.5 } },
      disk: { freeMb: 120_000, drive: 'C:' },
      device: i9,
      plan,
      test: { offer: false, agreed: true, runs: 1 },
      keysOk: { dictate: true, note: true, english: true, again: true, practice: true },
    },
    dictation: {
      recent: [
        { at: new Date(now - 600e3).toISOString(), mode: 'type', text: 'Привет, это проверка диктовки в новом бейдже.' },
        { at: new Date(now - 86400e3).toISOString(), mode: 'english', text: 'I will send the updated layouts before the call.', heard: 'Пришлю обновлённые макеты до созвона.' },
      ],
    },
    translatorState: { status: 'ready', progress: 1, size: 84 },
    // Fast in use; Accurate (the one model, which checks) here and timed; Most accurate on its way.
    translation: { fast: { status: 'ready', progress: 1, size: 84 }, accurate: { status: 'ready', progress: 1, size: 5155 }, most: { status: 'downloading', progress: 0.42, size: 6976 } },
    models: { accurate: { status: 'ready', progress: 1, size: 5155 }, most: { status: 'downloading', progress: 0.42, size: 6976 } },
    modelSpeed: { accurate: { sentence: 0.71, text: 0.7, start: 3.2 } },
    dictionary: { status: 'ready' },
    // "can … made" twice: it shows under You repeat.
    mistakes: [
      { at: new Date(now - 120e3).toISOString(), text: 'I want to learn English and can we made tutor option?', corrected: 'I want to learn English, and can we make a tutor option?', note: 'made → make: после can глагол стоит в начальной форме.' },
      { at: new Date(now - 3600e3).toISOString(), text: 'I dictate or tupe in English and you show my my mistake?', corrected: 'I dictate or type in English and you show me my mistakes?', note: 'my → me: после show нужно объектное местоимение me.' },
      { at: new Date(now - 86400e3).toISOString(), text: 'Yes, we can made it tomorow.', corrected: 'Yes, we can make it tomorrow.', note: 'made → make: после can глагол стоит в начальной форме.' },
    ],
    // The owner's computer on 2026-10-31: the speech engine's packages hard-linked into uv's cache; what each part serves, as main.ts withUse says.
    storage: {
      measuring: false,
      root: 'C:\\Users\\you\\AppData\\Local\\Krya',
      drive: 'C:',
      freeMb: 212_400,
      parts: [
        { id: 'fast', item: 'ru', path: 'models-ru', bytes: 80e6, shared: 0, users: ['Translate'] },
        { id: 'fast', item: 'uk', path: 'models-uk', bytes: 55e6, shared: 0, unused: true },
        { id: 'voice', path: 'voice', bytes: 201e6, shared: 0, users: ['Listen'] },
        { id: 'accurate', path: 'a.gguf', bytes: 5155e6, shared: 0, users: ['Translate', 'Check'] },
        { id: 'most', path: 'm.gguf', bytes: 0, shared: 0, unused: true },
        { id: 'unused', path: 'models', bytes: 2490e6, shared: 0, unused: true },
        { id: 'llama', item: 'vulkan', path: 'engine', bytes: 38e6, shared: 0, users: ['Translate', 'Check'] },
        { id: 'llama', item: 'cuda', path: 'engine', bytes: 0, shared: 0, unused: true },
        { id: 'speechModel', item: 'large-v3-turbo', path: 'whisper', bytes: 1620e6, shared: 0, users: ['Dictate', 'Transcribe'] },
        { id: 'speechModel', item: 'parakeet-tdt-0.6b-v3', path: 'parakeet', bytes: 670e6, shared: 0, reserve: 'Dictate' },
        { id: 'speechModel', item: 'small', path: 'whisper', bytes: 484e6, shared: 0, unused: true },
        { id: 'speechModel', item: 'base', path: 'whisper', bytes: 145e6, shared: 0, unused: true },
        { id: 'speech', path: 'speech', bytes: 2400e6, shared: 1900e6, users: ['Dictate', 'Transcribe'] },
        { id: 'gpu', path: 'speech', bytes: 1700e6, shared: 1500e6, users: ['Dictate', 'Transcribe'] },
        { id: 'yours', path: 'Roaming', bytes: 16e6, shared: 0 },
        { id: 'transcripts', path: 'Transcripts', bytes: 6e6, shared: 0 },
      ],
    },
  }
}

export function trayView(over: Partial<TrayView> = {}): TrayView {
  return {
    keys: { listenCopied: 'Control+C*2', typeToTranslate: '', checkEnglish: 'RightControl*2', snipListen: 'Control+Alt+S', snipTranslate: 'Control+Alt+T', switch: 'LeftControl' },
    autoFix: true,
    switchOn: true,
    layoutBadge: true,
    trayLayout: false,
    doubleCopy: true,
    paused: false,
    keep: { on: true, word: 'ghbdtn', fixed: 'привет' },
    speech: { installed: true, recording: false, noteKey: 'Control+Alt+N' },
    translator: 'ready',
    native: 'Russian',
    version: '0.11.0',
    build: '30 Oct, 07:12 (ff17ba8, changed)',
    dev: true,
    ...over,
  }
}
