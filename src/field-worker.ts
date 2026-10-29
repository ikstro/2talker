// A thread of the keyboard thread's (kbd-worker.ts) that answers one
// question, whether the field with the keyboard is a password, through UI
// Automation (uia.ts): the program in front answers it, which can take a
// while, and the keyboard thread's hooks must never wait. workerData: the
// port to answer on and the keyboard thread to wake after each answer.

import { workerData, type MessagePort } from 'node:worker_threads'

import koffi from 'koffi'

import { focusedIsPassword } from './uia'

const { port, tid } = workerData as { port: MessagePort; tid: number }

const user32 = koffi.load('user32.dll')
const PostThreadMessageW = user32.func('bool __stdcall PostThreadMessageW(uint32 tid, uint32 msg, uintptr w, intptr l)')
/** The answer is on the port. */
const WM_APP_FIELD = 0x8002

port.on('message', () => {
  let secret = false
  try {
    secret = focusedIsPassword() ?? false
  } catch {
    // No answer is no password: fixing goes on as it would without the question.
  }
  port.postMessage({ secret })
  PostThreadMessageW(tid, WM_APP_FIELD, 0, 0)
})
