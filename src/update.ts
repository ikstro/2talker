// Updates from the GitHub releases of ikstro/altype (electron-builder.yml
// names them): checked when the app starts and every few hours, downloaded
// quietly, installed when the app quits. A run from source never updates.
// Test versions (a prerelease, a tag like v1.2.0-beta.1) come only to those
// who asked for them in Settings.

import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

import type { UpdateStatus } from './protocol'
import { updateFailure } from './updatereason'

const EVERY_MS = 6 * 60 * 60_000

export type UpdaterEvents = {
  change: (status: UpdateStatus) => void
  /** A new version is downloaded and waits for the next quit. */
  ready: (version: string) => void
}

export class Updater {
  status: UpdateStatus = { status: app.isPackaged ? 'idle' : 'dev' }
  private timer: NodeJS.Timeout | undefined

  constructor(
    private readonly events: UpdaterEvents,
    beta = false,
  ) {
    if (!app.isPackaged) return
    if (beta) this.beta(true)
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
    autoUpdater.on('error', error => this.set(updateFailure(error)))
  }

  /** Checks now, and keeps checking while the app runs. */
  start(): void {
    if (!app.isPackaged) return
    this.check()
    this.timer = setInterval(() => this.check(), EVERY_MS)
  }

  check(): void {
    if (!app.isPackaged || this.status.status === 'ready' || this.status.status === 'downloading') return
    autoUpdater.checkForUpdates().catch(error => this.set(updateFailure(error)))
  }

  /** Test versions wanted, or not any more (a test version installed stays until a release passes it). */
  setBeta(on: boolean): void {
    if (!app.isPackaged) return
    this.beta(on)
    this.check()
  }

  /**
   * The beta channel reads beta.yml, which every release has too (electron-builder.yml:
   * generateUpdatesFilesForAllChannels), so a release still comes; back to latest, a test
   * version gives way to the release before it.
   */
  private beta(on: boolean): void {
    if (on) autoUpdater.channel = 'beta'
    else if (autoUpdater.channel) autoUpdater.channel = 'latest'
    autoUpdater.allowPrerelease = on
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
  }

  private set(status: UpdateStatus): void {
    this.status = status
    this.events.change(status)
  }
}
