import { describe, expect, it } from 'vitest'

import { updateFailure } from './updatereason'

describe('updateFailure', () => {
  it('says a private repository calmly, without the server’s answer', () => {
    const error = Object.assign(new Error('HttpError: 404 "method: GET url: https://github.com/ikstro/altype/releases.atom\n\nHeaders: { "set-cookie": [ "_gh_sess=…" ] }'), { statusCode: 404 })
    expect(updateFailure(error)).toEqual({ status: 'unavailable', message: 'updates are off while the releases are private' })
  })

  it('says no connection when GitHub cannot be reached', () => {
    expect(updateFailure(new Error('net::ERR_INTERNET_DISCONNECTED'))).toMatchObject({ status: 'unavailable' })
    expect(updateFailure(new Error('getaddrinfo ENOTFOUND github.com'))).toMatchObject({ status: 'unavailable' })
  })

  it('keeps one short line of anything else', () => {
    const r = updateFailure(new Error(`Cannot parse releases feed: ${'x'.repeat(300)}\nmore`))
    expect(r.status).toBe('failed')
    expect(r.status === 'failed' && r.message.length).toBe(140)
    expect(updateFailure('Error: sha512 checksum mismatch')).toEqual({ status: 'failed', message: 'Error: sha512 checksum mismatch' })
  })
})
