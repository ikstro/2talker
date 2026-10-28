import { describe, expect, it } from 'vitest'

import { fingerprint, mainCard, parseNvidiaSmi, parseWindows, quickProfile, vendorOf, withNvidia } from './device'

const base = { cpu: { name: 'node cpu', cores: 8, threads: 16 }, ramGb: 32, gpus: [], laptop: false, at: 0 }

describe('device profile', () => {
  it('reads Windows: the real memory of each card from its driver key, not WMI’s 4 GB', () => {
    const answer = JSON.stringify({
      cpu: 'Intel(R) Core(TM) i9-9900K CPU @ 3.60GHz',
      cores: 8,
      threads: 16,
      cards: [
        { name: 'NVIDIA GeForce RTX 2080 SUPER', company: 'NVIDIA', driver: '32.0.15.6109', ram: 4293918720 },
        { name: 'Microsoft Basic Display Adapter', company: '(Standard display types)', driver: '10.0', ram: 0 },
        { name: 'Parsec Virtual Display Adapter', company: 'Parsec Cloud, Inc.', driver: '0.45', ram: 0 },
      ],
      memory: [{ name: 'NVIDIA GeForce RTX 2080 SUPER', bytes: 8589934592 }],
      battery: false,
    })
    const p = parseWindows(answer, base)
    expect(p.cpu).toEqual({ name: 'Intel(R) Core(TM) i9-9900K CPU @ 3.60GHz', cores: 8, threads: 16 })
    expect(p.gpus).toEqual([{ name: 'NVIDIA GeForce RTX 2080 SUPER', vendor: 'nvidia', vramMb: 8192, driver: '32.0.15.6109' }])
    expect(p.laptop).toBe(false)
    expect(p.at).toBeGreaterThan(0)
  })

  it('takes PowerShell’s single objects as lists of one', () => {
    const p = parseWindows(JSON.stringify({ cpu: 'AMD Ryzen 5 5500U', cores: 6, threads: 12, cards: { name: 'AMD Radeon(TM) Graphics', company: 'Advanced Micro Devices, Inc.', driver: '31.0', ram: 536870912 }, battery: true, chassis: 10 }), base)
    expect(p.gpus).toEqual([{ name: 'AMD Radeon(TM) Graphics', vendor: 'amd', vramMb: 512, driver: '31.0' }])
    expect(p.laptop).toBe(true)
  })

  it('a desktop with a UPS is not a laptop: the case decides, the battery only when the case says nothing', () => {
    const answer = (chassis: number[], battery: boolean) => parseWindows(JSON.stringify({ cpu: 'x', cores: 8, threads: 16, battery, chassis }), base).laptop
    expect(answer([3], true)).toBe(false)
    expect(answer([9], false)).toBe(true)
    expect(answer([2], true)).toBe(true)
    expect(answer([], false)).toBe(false)
  })

  it('takes NVIDIA’s own numbers over Windows’', () => {
    const smi = parseNvidiaSmi('NVIDIA GeForce RTX 2080 SUPER, 8192, 610.88, 7.5\r\n')
    expect(smi).toEqual([{ name: 'NVIDIA GeForce RTX 2080 SUPER', vramMb: 8192, driver: '610.88', computeCap: 7.5 }])
    expect(parseNvidiaSmi('NVIDIA GeForce GTX 1050, 2048, 472.12\n')[0]).toEqual({ name: 'NVIDIA GeForce GTX 1050', vramMb: 2048, driver: '472.12' })
    const p = withNvidia({ ...base, gpus: [{ name: 'NVIDIA GeForce RTX 2080 SUPER', vendor: 'nvidia', vramMb: 4095, driver: '32.0.15.6109' }] }, smi)
    expect(p.gpus[0]).toEqual({ name: 'NVIDIA GeForce RTX 2080 SUPER', vendor: 'nvidia', vramMb: 8192, driver: '610.88', computeCap: 7.5 })
  })

  it('names vendors and the card worth naming', () => {
    expect(vendorOf('Intel(R) Arc(TM) A770 Graphics')).toBe('intel')
    expect(vendorOf('Radeon RX 6600')).toBe('amd')
    expect(vendorOf('Quadro P1000')).toBe('nvidia')
    expect(vendorOf('Some Display', 'Matrox')).toBe('other')
    const p = { ...base, gpus: [{ name: 'Intel UHD', vendor: 'intel' as const, vramMb: 128, driver: '' }, { name: 'Radeon RX 6600', vendor: 'amd' as const, vramMb: 8192, driver: '' }] }
    expect(mainCard(p)?.name).toBe('Radeon RX 6600')
  })

  it('a fingerprint changes with the card’s driver major version, not its minor', () => {
    const card = { name: 'NVIDIA GeForce RTX 2080 SUPER', vendor: 'nvidia' as const, vramMb: 8192, driver: '610.88' }
    const a = fingerprint({ ...base, gpus: [card] })
    expect(fingerprint({ ...base, gpus: [{ ...card, driver: '610.91' }] })).toBe(a)
    expect(fingerprint({ ...base, gpus: [{ ...card, driver: '615.10' }] })).not.toBe(a)
    expect(fingerprint({ ...base, ramGb: 16, gpus: [card] })).not.toBe(a)
  })

  it('knows the processor and memory at once', () => {
    const p = quickProfile()
    expect(p.cpu.threads).toBeGreaterThan(0)
    expect(p.ramGb).toBeGreaterThan(0)
    expect(p.at).toBe(0)
  })
})
