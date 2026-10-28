import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { downloadMb, extrasFor, installedMb, normalizeParts, SpeechPack, UV, type Run } from './speechpack'

describe('parts', () => {
  it('maps parts to extras, speakers on the card replacing gpu', () => {
    expect(extrasFor(['core'])).toEqual([])
    expect(extrasFor(['core', 'gpu'])).toEqual(['gpu'])
    expect(extrasFor(['core', 'speakers'])).toEqual(['speakers'])
    expect(extrasFor(['core', 'gpu', 'speakers'])).toEqual(['speakers-gpu'])
    // A card too small for both models: Whisper on it, speakers on the processor.
    expect(extrasFor(['core', 'gpu', 'speakers'], false)).toEqual(['gpu', 'speakers'])
  })

  it('counts the download', () => {
    expect(downloadMb(['core'])).toBe(160)
    expect(downloadMb(['core', 'gpu'])).toBe(160 + 1150)
    expect(downloadMb(['core', 'gpu', 'speakers'])).toBe(160 + 3000)
    expect(downloadMb(['core', 'gpu', 'speakers'], false)).toBe(160 + 1150 + 250)
    expect(installedMb(['core', 'gpu'])).toBe(330 + 1700)
  })

  it('keeps core first and drops repeats', () => {
    expect(normalizeParts(['speakers', 'gpu', 'speakers'])).toEqual(['core', 'gpu', 'speakers'])
  })
})

describe('SpeechPack', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true })))

  function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'speechpack-'))
    const engineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-'))
    dirs.push(root, engineDir)
    fs.writeFileSync(path.join(engineDir, 'uv.lock'), 'lock v1')
    const calls: { exe: string; args: string[]; env: Record<string, string> }[] = []
    // A fake uv: "unpacking" makes uv.exe, "sync" makes the environment's python.
    const run: Run = (exe, args, env) => {
      calls.push({ exe, args, env })
      if (exe.endsWith('tar.exe')) {
        const dir = args[args.indexOf('-C') + 1]!
        fs.writeFileSync(path.join(dir, 'uv.exe'), '')
      } else {
        const python = path.join(env.UV_PROJECT_ENVIRONMENT!, 'Scripts', 'python.exe')
        fs.mkdirSync(path.dirname(python), { recursive: true })
        fs.writeFileSync(python, '')
      }
      return { exit: Promise.resolve(0), output: () => '' }
    }
    return { root, engineDir, calls, run }
  }

  // A zip with UV's exact size and hash cannot be made here: a uv.exe already in place stands for it.
  function withUv(root: string) {
    const dir = path.join(root, 'uv', UV.version)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'uv.exe'), '')
  }

  it('installs the parts and remembers them with the lock it used', async () => {
    const { root, engineDir, calls, run } = setup()
    withUv(root)
    const changes = vi.fn()
    const pack = new SpeechPack({ root, engineDir, nvidia: true, open: vi.fn(), run, onChange: changes })
    expect(pack.state.status).toBe('absent')
    await pack.install(['gpu'])
    expect(pack.state).toMatchObject({ status: 'ready', parts: ['core', 'gpu'], nvidia: true })
    const sync = calls.find(c => c.args[0] === 'sync')!
    expect(sync.args).toContain('--frozen')
    expect(sync.args.slice(-2)).toEqual(['--extra', 'gpu'])
    expect(sync.env.UV_PROJECT_ENVIRONMENT).toBe(path.join(root, 'env'))
    expect(pack.stale).toBe(false)
    expect(changes).toHaveBeenCalled()
  })

  it('adds a part to the ones there', async () => {
    const { root, engineDir, calls, run } = setup()
    withUv(root)
    const pack = new SpeechPack({ root, engineDir, nvidia: false, open: vi.fn(), run, onChange: () => undefined })
    await pack.install(['core'])
    await pack.install(['speakers'])
    expect(pack.state.parts).toEqual(['core', 'speakers'])
    expect(calls.filter(c => c.args[0] === 'sync').at(-1)!.args.slice(-2)).toEqual(['--extra', 'speakers'])
  })

  it('is stale after an update brings another lock', async () => {
    const { root, engineDir, run } = setup()
    withUv(root)
    const pack = new SpeechPack({ root, engineDir, nvidia: false, open: vi.fn(), run, onChange: () => undefined })
    await pack.install(['core'])
    fs.writeFileSync(path.join(engineDir, 'uv.lock'), 'lock v2')
    expect(pack.stale).toBe(true)
  })

  it('refuses a Python manager that did not arrive whole', async () => {
    const { root, engineDir, run } = setup()
    const open = vi.fn(async () => (async function* () {
      yield new Uint8Array([1, 2, 3])
    })())
    const pack = new SpeechPack({ root, engineDir, nvidia: false, open, run, onChange: () => undefined })
    await expect(pack.install(['core'])).rejects.toThrow('did not arrive whole')
    expect(pack.state).toMatchObject({ status: 'failed', message: 'The Python manager did not arrive whole' })
  })

  it('a failed sync leaves it absent, with uv\'s last words', async () => {
    const { root, engineDir } = setup()
    withUv(root)
    const run: Run = () => ({ exit: Promise.resolve(2), output: () => 'line 1\nerror: no space left on device\n' })
    const pack = new SpeechPack({ root, engineDir, nvidia: false, open: vi.fn(), run, onChange: () => undefined })
    await expect(pack.install(['core'])).rejects.toThrow('no space left')
    expect(pack.state.status).toBe('failed')
  })

  it('removes everything', async () => {
    const { root, engineDir, run } = setup()
    withUv(root)
    const pack = new SpeechPack({ root, engineDir, nvidia: false, open: vi.fn(), run, onChange: () => undefined })
    await pack.install(['core'])
    await pack.remove()
    expect(pack.state.status).toBe('absent')
    expect(fs.existsSync(path.join(root, 'env'))).toBe(false)
  })
})
