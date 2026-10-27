// Windows' keyboard layouts, through user32 and koffi: the layouts installed,
// what each key types in one, the window in front and its layout, switching
// it, the text cursor's place and typing. Used by the main process and by the
// keyboard thread (kbd-worker.ts), each loading user32 for itself.

import * as path from 'node:path'

import koffi from 'koffi'

import { keyId, tableOf, type KeyTable } from './layoutfix'

const user32 = koffi.load('user32.dll')
const kernel32 = koffi.load('kernel32.dll')

const POINT = koffi.struct('KbdPoint', { x: 'int32', y: 'int32' })
const RECT = koffi.struct('KbdRect', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' })
const GUITHREADINFO = koffi.struct('KbdGuiThreadInfo', {
  cbSize: 'uint32',
  flags: 'uint32',
  hwndActive: 'intptr',
  hwndFocus: 'intptr',
  hwndCapture: 'intptr',
  hwndMenuOwner: 'intptr',
  hwndMoveSize: 'intptr',
  hwndCaret: 'intptr',
  rcCaret: RECT,
})
const KEYBDINPUT = koffi.struct('KbdKeybdInput', { wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr' })
// INPUT is a type and a union as large as its mouse member: 40 bytes on 64-bit Windows.
const INPUT = koffi.struct('KbdInput', { type: 'uint32', ki: KEYBDINPUT, pad: koffi.array('uint8', 8) })

const GetKeyboardLayoutList = user32.func('int __stdcall GetKeyboardLayoutList(int n, void *list)')
const GetKeyboardLayout = user32.func('intptr __stdcall GetKeyboardLayout(uint32 tid)')
const ToUnicodeEx = user32.func('int __stdcall ToUnicodeEx(uint32 vk, uint32 scan, const uint8_t *state, void *buf, int n, uint32 flags, intptr hkl)')
const MapVirtualKeyExW = user32.func('uint32 __stdcall MapVirtualKeyExW(uint32 code, uint32 type, intptr hkl)')
const LCIDToLocaleName = kernel32.func('int __stdcall LCIDToLocaleName(uint32 lcid, void *name, int n, uint32 flags)')
const GetForegroundWindow = user32.func('intptr __stdcall GetForegroundWindow()')
const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr hwnd, _Out_ uint32 *pid)')
const PostMessageW = user32.func('bool __stdcall PostMessageW(intptr hwnd, uint32 msg, uintptr w, intptr l)')
const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(intptr hwnd)')
const GetKeyState = user32.func('short __stdcall GetKeyState(int vk)')
const AttachThreadInput = user32.func('bool __stdcall AttachThreadInput(uint32 thread, uint32 to, bool attach)')
const IsHungAppWindow = user32.func('bool __stdcall IsHungAppWindow(intptr hwnd)')
const GetCurrentThreadId = kernel32.func('uint32 __stdcall GetCurrentThreadId()')
const GetGUIThreadInfo = user32.func('bool __stdcall GetGUIThreadInfo(uint32 tid, _Inout_ KbdGuiThreadInfo *info)')
const ClientToScreen = user32.func('bool __stdcall ClientToScreen(intptr hwnd, _Inout_ KbdPoint *point)')
const SendInput = user32.func('uint32 __stdcall SendInput(uint32 n, KbdInput *inputs, int size)')
const OpenProcess = kernel32.func('intptr __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)')
const QueryFullProcessImageNameW = kernel32.func('bool __stdcall QueryFullProcessImageNameW(intptr process, uint32 flags, void *name, _Inout_ uint32 *size)')
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(intptr handle)')

const WM_INPUTLANGCHANGEREQUEST = 0x0050
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const INPUT_KEYBOARD = 1
const KEYEVENTF_KEYUP = 0x0002
const KEYEVENTF_UNICODE = 0x0004
/** Keys Altype presses itself carry this, so the keyboard thread lets them by. */
export const OWN_KEYS = 0x2a7a
/** Keys the person pressed while a fix was being typed, pressed again after it: theirs, not Altype's. */
export const REPLAY_KEYS = 0x2a7b
/** The main process's Ctrl+C and Ctrl+V (winclip.ts): another program's keys to the thread, but never "a program pressing keys by itself". */
export const MAIN_KEYS = 0x2a7c

/** A layout's id as settings.ts keeps it: the low half of its handle, "04090409". */
export function layoutId(hkl: bigint | number): string {
  return BigInt.asUintN(32, BigInt(hkl)).toString(16).toUpperCase().padStart(8, '0')
}

export type InstalledLayout = { id: string; hkl: bigint; tag: string }

/** The layouts Windows has, in its order, with the language tag of each ("en-US"). */
export function installedLayouts(): InstalledLayout[] {
  const n = GetKeyboardLayoutList(0, null) as number
  const buffer = Buffer.alloc(8 * n)
  GetKeyboardLayoutList(n, buffer)
  const out: InstalledLayout[] = []
  for (let i = 0; i < n; i++) {
    const hkl = buffer.readBigInt64LE(i * 8)
    const name = Buffer.alloc(85 * 2)
    const length = LCIDToLocaleName(Number(hkl & 0xffffn), name, 85, 0) as number
    const tag = length > 1 ? name.toString('utf16le', 0, (length - 1) * 2) : ''
    out.push({ id: layoutId(hkl), hkl, tag })
  }
  return out
}

/** The keys that may type a character: space, digits, letters, punctuation, the key by the left Shift. */
const TYPING_KEYS = [0x20, ...range(0x30, 0x39), ...range(0x41, 0x5a), ...range(0xba, 0xc0), ...range(0xdb, 0xdf), 0xe2]

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
}

/** What each key types in a layout, with and without Shift; dead keys and keys that type nothing are left out. */
export function layoutTable(hkl: bigint): KeyTable {
  const state = Buffer.alloc(256)
  const out = Buffer.alloc(16)
  const entries: [string, string][] = []
  for (const shift of [false, true]) {
    state[0x10] = shift ? 0x80 : 0
    for (const vk of TYPING_KEYS) {
      // 4: leave the keyboard's state (a dead key pressed) as it is.
      const n = ToUnicodeEx(vk, MapVirtualKeyExW(vk, 0, hkl), state, out, 8, 4, hkl) as number
      if (n !== 1) continue
      const char = out.toString('utf16le', 0, 2)
      if (/\P{C}/u.test(char)) entries.push([keyId(vk, shift), char])
    }
  }
  return tableOf(entries)
}

export type Foreground = { hwnd: bigint; tid: number; pid: number }

export function foreground(): Foreground {
  const hwnd = BigInt(GetForegroundWindow() as number | bigint)
  const pid = [0]
  const tid = GetWindowThreadProcessId(hwnd, pid) as number
  return { hwnd, tid, pid: pid[0] ?? 0 }
}

/** The layout a thread types in. */
export function layoutOf(tid: number): bigint {
  return BigInt.asIntN(64, BigInt(GetKeyboardLayout(tid) as number | bigint))
}

/** Brings a window to the front, with the keyboard; Windows allows it while Altype's own window is in front. */
export function focusWindow(hwnd: bigint): boolean {
  return !!SetForegroundWindow(hwnd)
}

/**
 * Whether Caps Lock is on, as the window in front sees it. A thread that
 * takes no keyboard input of its own (the keyboard thread) is never told, so
 * it borrows the front window's input state for the moment of the question;
 * not from a hung window, which could hold it up.
 */
export function capsLockOf(front: Foreground): boolean {
  const me = GetCurrentThreadId() as number
  const attached = front.tid !== 0 && front.tid !== me && !IsHungAppWindow(front.hwnd) && !!AttachThreadInput(me, front.tid, true)
  try {
    return (Number(GetKeyState(0x14)) & 1) === 1
  } finally {
    if (attached) AttachThreadInput(me, front.tid, false)
  }
}

/** Asks a window to type in another layout, as Windows' own switch does. */
export function switchLayout(hwnd: bigint, hkl: bigint): void {
  PostMessageW(hwnd, WM_INPUTLANGCHANGEREQUEST, 0, hkl)
}

/** Where a thread's text cursor is on the screen, in physical pixels; undefined when the program draws its own (browsers, Electron apps). */
export function caretOf(tid: number): { x: number; y: number; h: number } | undefined {
  const info: Record<string, unknown> = { cbSize: koffi.sizeof(GUITHREADINFO) }
  if (!GetGUIThreadInfo(tid, info)) return undefined
  const hwnd = info.hwndCaret as number | bigint
  const rect = info.rcCaret as { left: number; top: number; right: number; bottom: number }
  if (!hwnd) return undefined
  const point = { x: rect.left, y: rect.top }
  if (!ClientToScreen(hwnd, point)) return undefined
  return { x: point.x, y: point.y, h: Math.max(1, rect.bottom - rect.top) }
}

const exes = new Map<number, string>()

/** A process's program, as its .exe name in lower case; empty when Windows does not say. */
export function exeOf(pid: number): string {
  const known = exes.get(pid)
  if (known !== undefined) return known
  let exe = ''
  const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
  if (handle) {
    const name = Buffer.alloc(1024)
    const size = [512]
    if (QueryFullProcessImageNameW(handle, 0, name, size)) exe = path.win32.basename(name.toString('utf16le', 0, (size[0] ?? 0) * 2)).toLowerCase()
    CloseHandle(handle)
  }
  if (exes.size > 500) exes.clear()
  exes.set(pid, exe)
  return exe
}

/**
 * A key to press: a virtual key, a character typed as itself whatever the
 * layout, or one half of a key press as the person made it (`again`).
 */
export type Press = { vk: number } | { char: string } | { again: { vk: number; scan: number; up: boolean } }

/** Presses keys in the program in front: marked as Altype's own, unless pressed again for the person. */
export function press(keys: readonly Press[]): void {
  const inputs: unknown[] = []
  const event = (vk: number, scan: number, flags: number, own = true) =>
    inputs.push({ type: INPUT_KEYBOARD, ki: { wVk: vk, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: own ? OWN_KEYS : REPLAY_KEYS }, pad: [0, 0, 0, 0, 0, 0, 0, 0] })
  for (const key of keys) {
    if ('again' in key) {
      event(key.again.vk, key.again.scan, key.again.up ? KEYEVENTF_KEYUP : 0, false)
    } else if ('vk' in key) {
      event(key.vk, 0, 0)
      event(key.vk, 0, KEYEVENTF_KEYUP)
    } else {
      for (let i = 0; i < key.char.length; i++) {
        const unit = key.char.charCodeAt(i)
        event(0, unit, KEYEVENTF_UNICODE)
        event(0, unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)
      }
    }
  }
  if (inputs.length > 0) SendInput(inputs.length, inputs, koffi.sizeof(INPUT))
}
