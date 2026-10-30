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
      vocabulary: ['Altype (альтайп, all type)', 'Peshynskyi (пешинский)', 'Paximizer'],
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
      noteKey: 'Control+Alt+N',
      ...over,
    },
    version: '0.8.0',
    natural: { status: 'ready', progress: 1, size: 170, dismissed: false, rtf: 0.3 },
    hostVoices: [{ name: 'Microsoft Zira Desktop', lang: 'en-US' }],
    languages: LANGUAGES.map(l => ({ name: l.name, native: l.native })),
    words: [
      { id: 1, word: 'drifted', base: 'drift', senses: [['verb', 'плыть по течению, дрейфовать']], sentence: 'A small boat drifted along the river.', addedAt: new Date(now - 3600e3).toISOString() },
      { id: 2, word: 'ducks', base: 'duck', senses: [['noun', 'утка']], sentence: 'Two children watched the ducks from the bridge.', addedAt: new Date(now - 86400e3 * 3).toISOString() },
    ],
    update: { status: 'none' },
    keysOk: { snip: true, select: true, translate: true, text: true, inPlace: true, pause: true, window: true },
    learned: { alwaysFix: [{ word: 'vs', lang: 'ru' }], myWords: [{ word: 'altype', lang: 'en' }, { word: 'пешинский', lang: 'ru' }] },
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
        dataDir: 'C:\\Users\\creoo\\Documents\\Altype\\Transcripts',
        kbDir: 'C:\\Users\\creoo\\Notes',
      },
      port: 8765,
      extensionDir: 'C:\\Users\\creoo\\AppData\\Local\\Programs\\Altype\\resources\\app.asar.unpacked\\extension',
      extensionShipped: '0.2.0',
      download: { core: 160, gpu: 1150, speakers: 3000 },
      installed: { core: 330, gpu: 1700, speakers: 4000 },
      speakers: { on: 'cuda', sizes: { cuda: { download: 3000, installed: 4000 }, cpu: { download: 250, installed: 900 } }, model: true },
      firstModel: { cpu: { model: 'Parakeet', mb: 0, phrase: 0.3 }, cuda: { model: 'Whisper turbo', mb: 0, phrase: 0.5 } },
      disk: { freeMb: 120_000, drive: 'C:' },
      device: i9,
      plan,
      test: { offer: false, agreed: true, runs: 1 },
      keysOk: { dictate: true, note: true, english: true, again: true },
    },
    dictation: {
      recent: [
        { at: new Date(now - 600e3).toISOString(), mode: 'type', text: 'Привет, это проверка диктовки в новом бейдже.' },
        { at: new Date(now - 86400e3).toISOString(), mode: 'english', text: 'I will send the updated layouts before the call.', heard: 'Пришлю обновлённые макеты до созвона.' },
      ],
    },
    translatorState: { status: 'ready', progress: 1, size: 84 },
    // Fast in use, Accurate on its way, Most accurate removed after it was timed here.
    translation: { fast: { status: 'ready', progress: 1, size: 84 }, accurate: { status: 'downloading', progress: 0.42, size: 2527 }, most: { status: 'absent', progress: 0, size: 7301 } },
    translationSpeed: { most: { sentence: 2.2, start: 7.1 } },
    dictionary: { status: 'ready' },
  }
}

export function trayView(over: Partial<TrayView> = {}): TrayView {
  return {
    keys: { listenCopied: 'Control+C*2', snipListen: 'Control+Alt+S', snipTranslate: 'Control+Alt+T', switch: 'LeftControl' },
    autoFix: true,
    switchOn: true,
    layoutBadge: true,
    trayLayout: false,
    doubleCopy: true,
    paused: false,
    speech: { installed: true, recording: false, noteKey: 'Control+Alt+N' },
    translator: 'ready',
    native: 'Russian',
    ...over,
  }
}
