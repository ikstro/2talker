// The card's bridge to the main process: the page posts through
// `window.tutorHost.post`, and messages from the main process arrive as
// window messages, the way the Tutor panel's webview receives them in VS Code.

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('tutorHost', {
  post: (message: unknown) => ipcRenderer.send('to-host', message),
})

ipcRenderer.on('to-view', (_event, message: unknown) => window.postMessage(message, '*'))
