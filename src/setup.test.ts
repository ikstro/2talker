import { describe, expect, it } from 'vitest'

import type { DeviceProfile } from './hardware'
import type { AppView } from './protocol'
import { DEFAULTS } from './settings'
import { planSpeech } from './speechplan'
import { cost, recommend, recommendedChoice } from './setup'

const i9: DeviceProfile = {
  cpu: { name: 'Intel(R) Core(TM) i9-9900K CPU @ 3.60GHz', cores: 8, threads: 16 },
  ramGb: 32,
  gpus: [{ name: 'NVIDIA GeForce RTX 2080 SUPER', vendor: 'nvidia', vramMb: 8192, driver: '610.88', computeCap: 7.5 }],
  laptop: false,
  at: 1,
}

const laptop: DeviceProfile = {
  cpu: { name: 'Intel(R) Core(TM) i3-7020U', cores: 2, threads: 4 },
  ramGb: 8,
  gpus: [{ name: 'Intel(R) HD Graphics 620', vendor: 'intel', vramMb: 0, driver: '1' }],
  laptop: true,
  at: 1,
}

/** A snapshot of a fresh install on `profile`: nothing downloaded, the engine absent. */
function view(profile: DeviceProfile, over: Partial<AppView> = {}): AppView {
  const plan = planSpeech({ profile, fingerprint: 'fp', bench: undefined, cuda: false, speakersCuda: false, speakers: false, downloaded: [], native: 'ru', prefer: 'accuracy', pins: { dictation: '', transcripts: '' } })
  const nvidia = profile.gpus.some(g => g.vendor === 'nvidia')
  return {
    settings: { ...DEFAULTS, native: 'Russian', setupDone: false },
    version: '0.9.0',
    natural: { status: 'absent', progress: 0, size: 170, dismissed: false },
    hostVoices: [],
    languages: [],
    words: [],
    update: { status: 'dev' },
    keysOk: { snip: true, select: true, translate: true, text: true },
    translator: 'absent',
    layouts: [],
    rivals: [],
    keyboardApps: [],
    foreignKeys: false,
    speech: {
      pack: { status: 'absent', parts: [], nvidia },
      service: 'off',
      port: 8765,
      extensionDir: '',
      download: { core: 160, gpu: 1150, speakers: plan.offers.speakersGpu ? 3000 : 250 },
      installed: { core: 330, gpu: 1700, speakers: plan.offers.speakersGpu ? 4000 : 900 },
      firstModel: { cpu: { model: 'Parakeet', mb: 670, phrase: 0.3 }, cuda: { model: 'Whisper turbo', mb: 1600, phrase: 0.5 } },
      disk: { freeMb: 120_000, drive: 'C:' },
      device: profile,
      plan,
      test: { offer: false, agreed: false, runs: 0 },
      keysOk: { dictate: true, note: true, english: true, again: true },
    },
    dictation: { recent: [] },
    translatorState: { status: 'absent', progress: 0, size: 84 },
    dictionary: { status: 'ready' },
    ...over,
  }
}

describe('recommend', () => {
  it('an i9 with an RTX: everything on, the speakers on the card, the natural voice', () => {
    const r = recommend(view(i9))
    expect(r.voice.on).toBe(true)
    expect(r.autoFix.on).toBe(true)
    expect(r.gpu.on).toBe(true)
    expect(r.dictate.on).toBe(true)
    expect(r.transcribe.on).toBe(true)
    expect(r.speakers.on).toBe(true)
    expect(r.gpu.why).toMatch(/graphics card/)
  })

  it('a two-core laptop: a Windows voice, dictation yes, transcripts with turbo in time, speakers and the card not advised', () => {
    const r = recommend(view(laptop))
    expect(r.voice.on).toBe(false)
    expect(r.dictate.on).toBe(true)
    expect(r.transcribe.on).toBe(true)
    expect(r.transcribe.why).toMatch(/an hour/)
    expect(r.speakers.on).toBe(false)
    expect(r.gpu.on).toBe(false)
  })

  it('one core: only a rough model keeps the time, so transcripts are possible but not advised', () => {
    const r = recommend(view({ ...laptop, cpu: { name: 'Celeron', cores: 1, threads: 2 } }))
    expect(r.transcribe.on).toBe(false)
    expect(r.transcribe.why).toMatch(/rough/)
  })

  it('a Latin-script language does not get the layout fixer by default', () => {
    const v = view(i9)
    v.settings.native = 'German'
    expect(recommend(v).autoFix.on).toBe(false)
  })
})

describe('cost', () => {
  it('adds up what the recommended choice downloads on the i9, and the disk has room', () => {
    const v = view(i9)
    const c = cost(recommendedChoice(v), v)
    const keys = c.items.map(i => i.key)
    expect(keys).toContain('translator')
    expect(keys).toContain('voice')
    expect(keys).toContain('engine')
    expect(c.parts).toEqual(['core', 'gpu', 'speakers'])
    expect(c.download).toBeGreaterThan(84 + 170 + 160 + 1150 + 3000)
    expect(c.fits).toBe(true)
    // The dictionary is here: listed, free.
    expect(c.items.find(i => i.key === 'dictionary')?.mb).toBe(0)
  })

  it('a small disk does not fit the engine; without speech it fits', () => {
    const v = view(i9, { speech: { ...view(i9).speech, disk: { freeMb: 2000, drive: 'C:' } } })
    const full = cost(recommendedChoice(v), v)
    expect(full.fits).toBe(false)
    const light = cost({ ...recommendedChoice(v), dictate: false, transcribe: false, speakers: false }, v)
    expect(light.parts).toEqual([])
    expect(light.fits).toBe(true)
  })

  it('parts already installed and a ready translator cost nothing', () => {
    const base = view(i9)
    const v = view(i9, { translatorState: { status: 'ready', progress: 1, size: 84 }, speech: { ...base.speech, pack: { status: 'ready', parts: ['core', 'gpu'], nvidia: true } } })
    const c = cost({ ...recommendedChoice(v), speakers: false }, v)
    expect(c.items.find(i => i.key === 'translator')?.mb).toBe(0)
    expect(c.parts).toEqual([])
  })
})
