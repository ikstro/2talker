// This computer's parts as Altype describes them (device.ts finds them out):
// the types and what both the main process and the pages say of them.

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'other'

export type Gpu = {
  name: string
  vendor: GpuVendor
  /** Its own memory in MB; 0 when unknown (or shared, as an Intel chip's). */
  vramMb: number
  /** As NVIDIA numbers it (610.88) when nvidia-smi answered, else as Windows does. */
  driver: string
  /** NVIDIA's compute capability (7.5 for a Turing card), when nvidia-smi says it. */
  computeCap?: number
}

export type DeviceProfile = {
  cpu: { name: string; cores: number; threads: number }
  ramGb: number
  gpus: Gpu[]
  /** It has a battery: a laptop, often slower than its processor's name says. */
  laptop: boolean
  /** When Windows was asked (ms); 0 for what Node alone knows. */
  at: number
}

export function vendorOf(name: string, company = ''): GpuVendor {
  const s = `${name} ${company}`
  if (/nvidia|geforce|quadro|tesla|rtx/i.test(s)) return 'nvidia'
  if (/amd|radeon|advanced micro|ati /i.test(s)) return 'amd'
  if (/intel|iris|uhd graphics|\barc\b/i.test(s)) return 'intel'
  return 'other'
}

/** The best NVIDIA card: the one speech would use. */
export function nvidiaCard(p: DeviceProfile | undefined): Gpu | undefined {
  return p?.gpus.filter(g => g.vendor === 'nvidia').sort((a, b) => b.vramMb - a.vramMb)[0]
}

/** The card worth naming: NVIDIA first, then the one with the most memory of its own. */
export function mainCard(p: DeviceProfile | undefined): Gpu | undefined {
  return nvidiaCard(p) ?? p?.gpus.slice().sort((a, b) => b.vramMb - a.vramMb)[0]
}

/** "Intel Core i9-9900K" for "Intel(R) Core(TM) i9-9900K CPU @ 3.60GHz". */
export function shortCpu(name: string): string {
  return name
    .replace(/\((R|TM|C)\)/gi, '')
    .replace(/\s+@.*$/, '')
    .replace(/\b(CPU|Processor)\b/gi, '')
    .replace(/\s+with\s+.*graphics.*$/i, '')
    .replace(/\s+\d+-Core\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "NVIDIA GeForce RTX 2080 SUPER · 8 GB"; a card without memory of its own by its name alone. */
export function cardText(g: Gpu): string {
  const name = g.name.replace(/\((R|TM)\)/gi, '').replace(/\s+/g, ' ').trim()
  return g.vramMb >= 1024 ? `${name} · ${Math.round(g.vramMb / 1024)} GB` : name
}
