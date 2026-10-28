import { describe, expect, it } from 'vitest'

import type { DeviceProfile } from './hardware'
import { BUDGET, cpuFactor, gpuOffer, minutes, planSpeech, runKey, seconds, testKey, testRuns, type PlanInput } from './speechplan'

const i9: DeviceProfile = {
  cpu: { name: 'Intel(R) Core(TM) i9-9900K CPU @ 3.60GHz', cores: 8, threads: 16 },
  ramGb: 32,
  gpus: [{ name: 'NVIDIA GeForce RTX 2080 SUPER', vendor: 'nvidia', vramMb: 8192, driver: '610.88', computeCap: 7.5 }],
  laptop: false,
  at: 1,
}

const weakLaptop: DeviceProfile = {
  cpu: { name: 'Intel(R) Core(TM) i5-8250U', cores: 4, threads: 8 },
  ramGb: 8,
  gpus: [{ name: 'Intel(R) UHD Graphics 620', vendor: 'intel', vramMb: 0, driver: '31.0.101.2111' }],
  laptop: true,
  at: 1,
}

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    profile: i9,
    fingerprint: 'fp',
    bench: undefined,
    cuda: false,
    speakersCuda: false,
    speakers: false,
    downloaded: [],
    native: 'ru',
    prefer: 'accuracy',
    pins: { dictation: '', transcripts: '' },
    ...over,
  }
}

describe('planSpeech', () => {
  it('a weak laptop dictates with a quick model and transcribes with turbo, whose decoder is light', () => {
    const plan = planSpeech(input({ profile: weakLaptop }))
    expect(plan.device).toBe('cpu')
    expect(plan.dictation.chosen.model).toBe('base')
    expect(plan.dictation.chosen.estimate).toBeLessThanOrEqual(BUDGET.dictation.accuracy)
    expect(plan.transcripts.chosen.model).toBe('large-v3-turbo')
    expect(plan.dictation.chosen.basis).toBe('guess')
    // 8 GB: large-v3 needs more than a third of it.
    expect(plan.transcripts.choices.find(c => c.model === 'large-v3')?.why).toMatch(/memory/)
    expect(plan.offers.gpu).toBe(false)
  })

  it('speed over accuracy takes quicker models and a beam of one', () => {
    const plan = planSpeech(input({ profile: weakLaptop, prefer: 'speed' }))
    expect(plan.dictation.chosen.model).toBe('tiny')
    expect(plan.engine.cpu.dictation).toEqual({ model: 'tiny', beam: 1 })
  })

  it('a downloaded model within the budget is used, and a better one offered', () => {
    const plan = planSpeech(input({ downloaded: ['base', 'small'] }))
    expect(plan.dictation.chosen.model).toBe('small')
    const slow = planSpeech(input({ profile: weakLaptop, downloaded: ['tiny'] }))
    expect(slow.dictation.chosen.model).toBe('tiny')
    expect(slow.dictation.better?.model).toBe('base')
  })

  it('a model too slow here is left for a quicker one that will download (going down needs no asking)', () => {
    const plan = planSpeech(input({ profile: weakLaptop, downloaded: ['small'] }))
    expect(plan.dictation.chosen.model).toBe('base')
    expect(plan.dictation.chosen.downloaded).toBe(false)
  })

  it('the card: one model for both, in float16 when it fits, both plans for the engine', () => {
    const plan = planSpeech(input({ cuda: true, downloaded: ['small', 'large-v3-turbo'] }))
    expect(plan.device).toBe('cuda')
    expect(plan.transcripts.chosen.model).toBe('large-v3-turbo')
    expect(plan.dictation.chosen.model).toBe('large-v3-turbo')
    expect(plan.engine.cuda?.transcripts).toEqual({ model: 'large-v3-turbo', compute: 'float16' })
    expect(plan.engine.cuda?.dictation.beam).toBe(5)
    // Should the card fail, the processor's own choice.
    expect(plan.engine.cpu.dictation.model).toBe('small')
    expect(plan.offers).toEqual({ gpu: true, speakersGpu: true })
    // large-v3 fits the card and is better: offered, not downloaded on its own.
    expect(plan.transcripts.better?.model).toBe('large-v3')
  })

  it('a fresh install on a strong card downloads turbo first, not the 3 GB model', () => {
    const plan = planSpeech(input({ cuda: true }))
    expect(plan.transcripts.chosen.model).toBe('large-v3-turbo')
    expect(plan.dictation.chosen.model).toBe('large-v3-turbo')
    expect(plan.transcripts.better?.model).toBe('large-v3')
  })

  it('a small card takes int8_float16, and too small a card is left out', () => {
    const small: DeviceProfile = { ...i9, gpus: [{ ...i9.gpus[0]!, vramMb: 3072 }] }
    const plan = planSpeech(input({ profile: small, cuda: true }))
    expect(plan.transcripts.choices.find(c => c.model === 'large-v3-turbo')?.compute).toBe('int8_float16')
    expect(plan.transcripts.choices.find(c => c.model === 'large-v3')?.why).toMatch(/too big/)
    expect(plan.offers.speakersGpu).toBe(false)
    expect(gpuOffer({ ...i9, gpus: [{ ...i9.gpus[0]!, vramMb: 1024 }] })).toBe(false)
    expect(gpuOffer({ ...i9, gpus: [{ ...i9.gpus[0]!, driver: '472.12' }] })).toBe(false)
    expect(gpuOffer(undefined, true)).toBe(true)
  })

  it('measured numbers replace the guesses, and scale to the models not measured', () => {
    const bench = { fingerprint: 'fp', runs: { [runKey('small', 'cpu', 'int8')]: { phrase: 3.0, rtf: 0.4 } } }
    const plan = planSpeech(input({ bench, downloaded: ['small'] }))
    const small = plan.dictation.choices.find(c => c.model === 'small')!
    expect(small).toMatchObject({ estimate: 3.0, basis: 'measured', fits: false })
    const base = plan.dictation.choices.find(c => c.model === 'base')!
    expect(base.basis).toBe('scaled')
    expect(base.estimate).toBeCloseTo((3.0 * 0.45) / 1.4, 5)
    expect(plan.dictation.chosen.model).toBe('base')
  })

  it('a pinned model is kept whatever it costs', () => {
    const plan = planSpeech(input({ profile: weakLaptop, pins: { dictation: 'large-v3-turbo', transcripts: '' } }))
    expect(plan.dictation.pinned).toBe(true)
    expect(plan.dictation.chosen.model).toBe('large-v3-turbo')
    expect(plan.dictation.chosen.fits).toBe(false)
  })

  it('a model near the budget is kept while the numbers move a little', () => {
    const runs = (phrase: number) => ({ fingerprint: 'fp', runs: { [runKey('small', 'cpu', 'int8')]: { phrase, rtf: 0.2 } } })
    expect(planSpeech(input({ bench: runs(1.6), downloaded: ['small', 'base'] })).dictation.chosen.model).toBe('base')
    expect(planSpeech(input({ bench: runs(1.6), downloaded: ['small', 'base'], previous: { dictation: 'small' } })).dictation.chosen.model).toBe('small')
    expect(planSpeech(input({ bench: runs(2.0), downloaded: ['small', 'base'], previous: { dictation: 'small' } })).dictation.chosen.model).toBe('base')
  })

  it('the hour counts speakers when their part is here', () => {
    const without = planSpeech(input()).transcripts.chosen.estimate
    const withSpeakers = planSpeech(input({ speakers: true })).transcripts.chosen.estimate
    expect(withSpeakers - without).toBeCloseTo(60 * 0.8, 1)
  })

  it('tests the downloaded models not yet measured, the smallest first, and remembers a decline by them', () => {
    const bench = { fingerprint: 'fp', runs: { [runKey('small', 'cpu', 'int8')]: { phrase: 1.4, rtf: 0.2 } } }
    const i = input({ bench, downloaded: ['large-v3-turbo', 'small', 'base'] })
    const plan = planSpeech(i)
    expect(testRuns(i, plan)).toEqual([
      { model: 'base', device: 'cpu', beam: 2 },
      { model: 'large-v3-turbo', device: 'cpu', beam: 2 },
    ])
    expect(testKey(i, plan)).toBe('fp|cpu|base,small,large-v3-turbo')
  })
})

describe('the numbers as said', () => {
  it('seconds and minutes', () => {
    expect(seconds(0.43)).toBe('0.4 s')
    expect(seconds(12.4)).toBe('12 s')
    expect(minutes(12.4)).toBe('12 min')
    expect(minutes(70)).toBe('1 h 10 min')
    expect(minutes(120)).toBe('2 h')
  })

  it('a laptop of four cores is about twice slower than the reference desktop', () => {
    expect(cpuFactor(weakLaptop)).toBeCloseTo(1.98, 2)
    expect(cpuFactor(i9)).toBe(1)
  })
})
