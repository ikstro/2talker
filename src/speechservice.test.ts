import { createHmac } from 'node:crypto'
import * as fs from 'node:fs'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'

import { provesKey, SpeechService, speechToken } from './speechservice'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('the speech engine\'s key', () => {
  test('is made once, random, and kept beside the engine\'s settings', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'krya-token-'))
    dirs.push(dir)
    const file = path.join(dir, 'Krya', 'speech-token')
    const first = speechToken(file)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(fs.readFileSync(file, 'utf8')).toBe(first)
    expect(speechToken(file)).toBe(first)
  })

  test('an engine on the port is Krya\'s only when it answers the nonce with the key (auth.py proof)', () => {
    const answer = (key: string, nonce: string) => createHmac('sha256', key).update(nonce).digest('hex')
    expect(provesKey('k', 'n1', answer('k', 'n1'))).toBe(true)
    expect(provesKey('k', 'n1', answer('other', 'n1'))).toBe(false)
    expect(provesKey('k', 'n1', answer('k', 'n2'))).toBe(false)
    for (const none of [undefined, null, '', 'zz', 42, {}]) expect(provesKey('k', 'n1', none)).toBe(false)
  })
})

describe('the engine on the port', () => {
  const answer = (key: string, nonce: string) => createHmac('sha256', key).update(nonce).digest('hex')
  const ENGINE = { ok: true, version: '0.2.0', parts: { core: true }, diarization: 'missing' }

  /** A server on a free port of 127.0.0.1 answering /health as `reply` says; what the service made of it. */
  async function onPort(reply: (req: http.IncomingMessage) => unknown) {
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(reply(req)))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'krya-engine-'))
    dirs.push(dir)
    const stopStale = vi.fn()
    const service: SpeechService = new SpeechService({
      python: () => path.join(dir, 'no-python.exe'),
      engineDir: dir,
      port: (server.address() as AddressInfo).port,
      log: path.join(dir, 'speech.log'),
      pycache: path.join(dir, 'pycache'),
      token: 'k',
      stopStale,
      change: () => undefined,
    })
    await service.start()
    const seen = { state: service.state, trouble: service.trouble, health: service.health }
    service.stop()
    await new Promise<void>(resolve => server.close(() => resolve()))
    return { ...seen, stopStale }
  }

  test('Krya\'s own engine proves it holds the key, and is used', async () => {
    let token = ''
    const r = await onPort(req => {
      token = String(req.headers['x-krya-token'])
      return { ...ENGINE, proof: answer('k', String(req.headers['x-krya-nonce'])) }
    })
    expect(token).toBe('k')
    expect(r.state).toBe('ready')
    expect(r.health).toMatchObject({ version: '0.2.0' })
    expect(r.health).not.toHaveProperty('proof')
    expect(r.stopStale).not.toHaveBeenCalled()
  })

  test('an older engine of Krya\'s without the key is stopped, once, and Krya starts its own', async () => {
    const r = await onPort(() => ENGINE)
    expect(r.stopStale).toHaveBeenCalledTimes(1)
    // Its own start was tried: there is no Python here, so it says so.
    expect(r.state).toBe('down')
    expect(r.trouble).toBe('The speech engine is not installed')
  })

  test('another program on the port is neither used nor stopped', async () => {
    const r = await onPort(() => ({ ok: true }))
    expect(r.stopStale).not.toHaveBeenCalled()
    expect(r.state).toBe('down')
    expect(r.trouble).toMatch(/used by another program/)
    expect(r.health).toBeUndefined()
  })
})
