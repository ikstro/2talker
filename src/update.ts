// Updates from the GitHub releases of ikstro/altype (electron-builder.yml
// names them): checked when the app starts and every few hours, downloaded
// quietly, installed when the app quits. A run from source never updates.

import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

import type { UpdateStatus } from './protocol'

const EVERY_MS = 6 * 60 * 60_000

export type UpdaterEvents = {
  change: (status: UpdateStatus) => void
  /** A new version is downloaded and waits for the next quit. */
  ready: (version: string) => void
}

export class Updater {
  status: UpdateStatus = { status: app.isPackaged ? 'idle' : 'dev' }
  private timer: NodeJS.Timeout | undefined

  constructor(private readonly events: UpdaterEvents) {
    if (!app.isPackaged) return
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = null
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }))
    autoUpdater.on('update-available', () => this.set({ status: 'downloading' }))
    autoUpdater.on('update-not-available', () => this.set({ status: 'none' }))
    autoUpdater.on('update-downloaded', info => {
      this.set({ status: 'ready', version: info.version })
      this.events.ready(info.version)
    })
    autoUpdater.on('error', error => this.set({ status: 'failed', message: error.message }))
  }

  /** Checks now, and keeps checking while the app runs. */
  start(): void {
    if (!app.isPackaged) return
    this.check()
    this.timer = setInterval(() => this.check(), EVERY_MS)
  }

  check(): void {
    if (!app.isPackaged || this.status.status === 'ready' || this.status.status === 'downloading') return
    autoUpdater.checkForUpdates().catch(error => this.set({ status: 'failed', message: String(error) }))
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
  }

  private set(status: UpdateStatus): void {
    this.status = status
    this.events.change(status)
  }
}
