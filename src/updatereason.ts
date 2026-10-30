// What Settings say when a check for updates does not get through: the reason
// in a few words, never the server's whole answer (electron-updater's HttpError
// carries every header and cookie in its message).

import type { UpdateStatus } from './protocol'

const OFFLINE = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_CONNECTION/

export function updateFailure(error: unknown): UpdateStatus {
  const code = (error as { statusCode?: unknown } | null)?.statusCode
  const text = error instanceof Error ? error.message : String(error)
  // GitHub answers 404 for the releases of a private repository.
  if (code === 404 || /\b404\b/.test(text)) return { status: 'unavailable', message: 'updates are off while the releases are private' }
  if (OFFLINE.test(text)) return { status: 'unavailable', message: 'no connection to GitHub; Krya tries again later' }
  const line = (text.split('\n')[0] ?? '').trim()
  return { status: 'failed', message: line.length > 140 ? `${line.slice(0, 139)}…` : line }
}
