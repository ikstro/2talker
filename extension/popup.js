// The popup: what this tab is, whether Altype's speech engine is running, Record / Stop.

const main = document.getElementById('main')
const engine = document.getElementById('engine')
let timer

const ask = message => chrome.runtime.sendMessage({ target: 'background', ...message })

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else if (v !== false && v !== undefined) node.setAttribute(k, v === true ? '' : v)
  }
  node.append(...children.filter(c => c !== null && c !== undefined && c !== false))
  return node
}

function clock(ms) {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

async function micAllowed() {
  try {
    return (await navigator.permissions.query({ name: 'microphone' })).state === 'granted'
  } catch {
    return false
  }
}

async function render(error) {
  clearInterval(timer)
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const status = await ask({ type: 'status' })
  engine.className = `engine ${status.engine ? 'ok' : 'bad'}`
  engine.textContent = status.engine ? 'ready' : 'not running'
  const mic = await micAllowed()
  const children = []
  if (status.recording) {
    const r = status.recording
    const time = el('span', { class: 'time' }, clock(Date.now() - r.startedAt))
    timer = setInterval(() => (time.textContent = clock(Date.now() - r.startedAt)), 500)
    children.push(
      el('div', { class: 'rec' }, el('span', { class: 'dot' }), 'Recording', time),
      el('div', { class: 'title' }, r.title),
      r.mic ? null : el('div', { class: 'muted' }, 'Without the microphone: only the others will be in the transcript.'),
      el('button', { class: 'stop', onclick: () => act('stop') }, 'Stop and transcribe'),
    )
  } else {
    children.push(
      el('div', { class: 'title' }, tab?.title || 'Tab'),
      el('button', { disabled: !status.engine, onclick: () => act('start', tab) }, 'Record this tab'),
      el('div', { class: 'muted' }, status.engine ? 'Or Alt+Shift+M on the meeting tab. The tab and your microphone are recorded as two tracks.' : 'Start Altype and turn on Transcribe: it makes the text on this computer.'),
    )
    if (!mic) {
      children.push(
        el('div', { class: 'warn' }, el('span', {}, 'The microphone is not allowed: your voice will be missing.'), el('button', { class: 'small', onclick: () => chrome.tabs.create({ url: 'permission.html' }) }, 'Allow')),
      )
    }
  }
  error ??= status.lastError
  if (error) children.push(el('div', { class: 'error' }, error))
  main.replaceChildren(...children)
}

async function act(type, tab) {
  for (const b of main.querySelectorAll('button')) b.disabled = true
  const answer = await ask(type === 'start' ? { type, tabId: tab.id } : { type })
  await render(answer && !answer.ok ? answer.error : answer?.lost ? 'Part of the recording did not reach Altype' : undefined)
  if (type === 'stop' && answer?.ok) main.prepend(el('div', { class: 'muted' }, 'Sent. The transcript is ready in a few minutes.'))
}

render()
