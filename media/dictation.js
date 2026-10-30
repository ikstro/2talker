"use strict";
(() => {
  // src/webview/dom.ts
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === void 0 || value === false) continue;
      if (typeof value === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === "class") {
        node.className = String(value);
      } else {
        node.setAttribute(key, value === true ? "" : String(value));
      }
    }
    for (const child of children) {
      if (child === null || child === void 0 || child === false) continue;
      node.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }

  // src/webview/recorder.ts
  async function microphone(close) {
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: close, noiseSuppression: close, autoGainControl: true, channelCount: 1 } });
  }
  var Meter = class {
    context;
    analyser;
    samples;
    constructor(stream) {
      this.context = new AudioContext();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.samples = new Float32Array(this.analyser.fftSize);
      this.context.createMediaStreamSource(stream).connect(this.analyser);
    }
    /** How loud it is now, 0…1. */
    level() {
      this.analyser.getFloatTimeDomainData(this.samples);
      let sum = 0;
      for (const v of this.samples) sum += v * v;
      return Math.min(1, Math.sqrt(sum / this.samples.length) * 4);
    }
    close() {
      void this.context.close();
    }
  };
  function stopped(recorder2) {
    if (!recorder2 || recorder2.state === "inactive") return Promise.resolve();
    return new Promise((resolve) => {
      recorder2.onstop = () => resolve();
      recorder2.stop();
    });
  }
  var PhraseRecorder = class {
    startedAt = 0;
    stream;
    recorder;
    meter;
    chunks = [];
    async start() {
      this.stream = await microphone(true);
      this.startedAt = Date.now();
      this.meter = new Meter(this.stream);
      this.recorder = new MediaRecorder(this.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 48e3 });
      this.recorder.ondataavailable = (event) => event.data.size > 0 && this.chunks.push(event.data);
      this.recorder.start(250);
    }
    level() {
      return this.meter?.level() ?? 0;
    }
    get seconds() {
      return this.startedAt ? (Date.now() - this.startedAt) / 1e3 : 0;
    }
    /** The recording, as webm. */
    async finish() {
      await stopped(this.recorder);
      this.release();
      return new Uint8Array(await new Blob(this.chunks, { type: "audio/webm" }).arrayBuffer());
    }
    async cancel() {
      await stopped(this.recorder);
      this.release();
    }
    release() {
      for (const track of this.stream?.getTracks() ?? []) track.stop();
      this.meter?.close();
      this.stream = void 0;
      this.meter = void 0;
    }
  };
  var RETRIES = 3;
  var ChunkRecorder = class {
    constructor(call, o) {
      this.call = call;
      this.o = o;
    }
    id;
    startedAt = 0;
    /** Set when a chunk could not be delivered: the recording will be missing a piece. */
    lost = false;
    recorder;
    stream;
    meter;
    seq = 0;
    uploads = Promise.resolve();
    speech(method, route, body) {
      return this.call({ call: "speech", method, route, body });
    }
    /** Asks for the microphone, opens the recording in the engine, starts sending. */
    async start() {
      this.stream = await microphone(this.o.source === "note");
      this.startedAt = Date.now();
      const opened = await this.speech("POST", "/recordings", {
        source: this.o.source,
        title: this.o.title,
        language: this.o.language,
        speakers: this.o.speakers,
        tracks: { main: { startedAt: this.startedAt } }
      });
      if (!opened.ok) {
        this.release();
        throw new Error(opened.error);
      }
      this.id = opened.data.id;
      this.meter = new Meter(this.stream);
      this.recorder = new MediaRecorder(this.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 48e3 });
      this.recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.upload(event.data);
      };
      this.recorder.start(this.o.slice);
    }
    upload(blob) {
      const seq = this.seq++;
      this.uploads = this.uploads.then(async () => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        for (let attempt = 0; attempt < RETRIES; attempt++) {
          if ((await this.speech("PUT", `/recordings/${this.id}/main/${seq}`, bytes)).ok) return;
          await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
        }
        this.lost = true;
      });
    }
    level() {
      return this.meter?.level() ?? 0;
    }
    get seconds() {
      return this.startedAt ? (Date.now() - this.startedAt) / 1e3 : 0;
    }
    /** Stops, sends what is left, and hands the recording to the engine. Its id. */
    async finish() {
      await stopped(this.recorder);
      await this.uploads;
      this.release();
      const r = await this.speech("POST", `/recordings/${this.id}/finish`, { language: this.o.language, speakers: this.o.speakers });
      if (!r.ok) throw new Error(r.error);
      return this.id;
    }
    async cancel() {
      await stopped(this.recorder);
      this.release();
      if (this.id) await this.speech("DELETE", `/recordings/${this.id}`);
    }
    release() {
      for (const track of this.stream?.getTracks() ?? []) track.stop();
      this.meter?.close();
      this.stream = void 0;
      this.meter = void 0;
    }
  };
  var STREAM_CHUNK = 4e3;
  var LEVEL_SPAN = 800;
  var LEVELS_KEPT = 60;
  var StreamRecorder = class {
    constructor(call, session, expected, onStatus2) {
      this.call = call;
      this.session = session;
      this.expected = expected;
      this.onStatus = onStatus2;
    }
    startedAt = 0;
    stream;
    context;
    kept = [];
    waiting = new Int16Array(STREAM_CHUNK);
    filled = 0;
    seq = 0;
    uploads = Promise.resolve();
    broken = false;
    loudness = 0;
    /** The sound's levels, one per 50 ms, not yet taken by the page. */
    heard = [];
    spanSum = 0;
    spanCount = 0;
    speech(method, route, body) {
      return this.call({ call: "speech", method, route, body });
    }
    async start() {
      this.stream = await microphone(true);
      this.startedAt = Date.now();
      this.context = new AudioContext({ sampleRate: 16e3 });
      await this.context.audioWorklet.addModule("pcm-worklet.js");
      const source = this.context.createMediaStreamSource(this.stream);
      const tap = new AudioWorkletNode(this.context, "pcm-tap");
      tap.port.onmessage = (event) => this.take(event.data);
      const mute = this.context.createGain();
      mute.gain.value = 0;
      source.connect(tap).connect(mute).connect(this.context.destination);
    }
    take(samples) {
      for (let i = 0; i < samples.length; i++) {
        const v = samples[i];
        this.spanSum += v * v;
        if (++this.spanCount === LEVEL_SPAN) {
          this.loudness = Math.min(1, Math.sqrt(this.spanSum / LEVEL_SPAN) * 4);
          this.heard.push(this.loudness);
          if (this.heard.length > LEVELS_KEPT) this.heard.shift();
          this.spanSum = 0;
          this.spanCount = 0;
        }
        this.waiting[this.filled++] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
        if (this.filled === STREAM_CHUNK) {
          this.send(this.waiting);
          this.waiting = new Int16Array(STREAM_CHUNK);
          this.filled = 0;
        }
      }
    }
    send(chunk) {
      this.kept.push(chunk);
      const seq = this.seq++;
      this.uploads = this.uploads.then(async () => {
        if (this.broken) return;
        const bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        for (let attempt = 0; attempt < RETRIES; attempt++) {
          const r = await this.speech("PUT", `/dictate/sessions/${this.session}/${seq}`, bytes);
          if (r.ok) return this.onStatus(r.data);
          if (r.status === 404) break;
          await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
        }
        this.broken = true;
      });
    }
    /** How loud the latest 50 ms were, 0…1. */
    level() {
      return this.loudness;
    }
    /** Every level since the last call, oldest first, one per 50 ms of sound: the wave misses none. */
    levels() {
      const taken = this.heard;
      this.heard = [];
      return taken;
    }
    get seconds() {
      return this.startedAt ? (Date.now() - this.startedAt) / 1e3 : 0;
    }
    /** Stops, sends the tail, and waits for the whole text. */
    async finish() {
      this.release();
      const tail = this.waiting.slice(0, this.filled);
      this.kept.push(tail);
      await this.uploads;
      if (!this.broken) {
        const r2 = await this.speech("POST", `/dictate/sessions/${this.session}/finish`, new Uint8Array(tail.buffer));
        if (r2.ok) return r2.data;
      }
      const all = new Int16Array(this.kept.reduce((n, c) => n + c.length, 0));
      let at = 0;
      for (const c of this.kept) all.set(c, at), at += c.length;
      const expected = this.expected.map(encodeURIComponent).join(",");
      const r = await this.speech("POST", `/dictate?language=auto&expected=${expected}&strict=1&format=pcm16`, new Uint8Array(all.buffer));
      if (!r.ok) throw new Error(r.error);
      return r.data;
    }
    async cancel() {
      this.release();
      this.broken = true;
      await this.speech("DELETE", `/dictate/sessions/${this.session}`);
    }
    release() {
      for (const track of this.stream?.getTracks() ?? []) track.stop();
      void this.context?.close();
      this.stream = void 0;
      this.context = void 0;
    }
  };
  function micTrouble(error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError") return "No access to the microphone: allow it in Windows Settings \u2192 Privacy \u2192 Microphone";
    if (name === "NotFoundError") return "No microphone found";
    if (name === "NotReadableError") return "Another program holds the microphone";
    return error instanceof Error ? error.message : String(error);
  }

  // src/webview/dictation.ts
  var host = window.tutorHost;
  var root = document.getElementById("badge");
  var TITLES = { type: "Dictate", english: "Dictate in English", note: "A note", check: "Practice English" };
  var recorder;
  var mode = "type";
  var starting = Promise.resolve();
  var timer;
  var dropped = false;
  var BEHIND = 4;
  var words;
  var dot;
  var time;
  var said = "";
  var fetching = false;
  function clock(seconds) {
    const s = Math.floor(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  function show(kind, text, ...line) {
    root.className = `badge ${kind}`;
    root.replaceChildren(...text ? [text] : [], el("div", { class: "line" }, ...line));
    if (text) toEnd(text);
  }
  function toEnd(text) {
    text.scrollTop = text.scrollHeight;
    text.classList.toggle("more", text.scrollHeight > text.clientHeight + 1);
  }
  function wordsOf(text, waiting = "") {
    return el("div", { class: text ? "words" : "words waiting" }, text || waiting);
  }
  function onStatus(status) {
    if (!words || !dot || !time) return;
    const model = status.model;
    fetching = model?.state === "downloading";
    if (fetching) time.textContent = `Getting the speech model ${Math.round((model?.progress ?? 0) * 100)}%`;
    time.classList.toggle("fetch", fetching);
    const text = status.heard.trim();
    if (text && text !== said) {
      said = text;
      words.textContent = text;
      words.classList.remove("waiting");
      toEnd(words);
    }
    dot.classList.toggle("behind", status.pending > BEHIND);
    dot.title = status.pending > BEHIND ? "catching up" : "";
  }
  var WAVE = 60;
  var STEP = 3;
  var BAR = 2;
  var levels = new Array(WAVE).fill(0);
  var wave;
  var frame;
  var fresh = false;
  function hear(level) {
    levels.push(level);
    if (levels.length > WAVE) levels.shift();
    fresh = true;
  }
  function draw() {
    frame = requestAnimationFrame(draw);
    if (!wave) return;
    const ratio = devicePixelRatio || 1;
    const w = wave.clientWidth;
    const h = wave.clientHeight;
    const sized = wave.width === Math.round(w * ratio) && wave.height === Math.round(h * ratio);
    if (!fresh && sized) return;
    fresh = false;
    if (!sized) {
      wave.width = Math.round(w * ratio);
      wave.height = Math.round(h * ratio);
    }
    const c = wave.getContext("2d");
    if (!c) return;
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    c.clearRect(0, 0, w, h);
    c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--mark").trim();
    c.globalAlpha = 0.7;
    const shown = Math.min(WAVE, Math.floor(w / STEP));
    for (let i = 0; i < shown; i++) {
      const bar = Math.max(2, Math.round(levels[WAVE - shown + i] * h));
      c.fillRect(w - (shown - i) * STEP, (h - bar) / 2, BAR, bar);
    }
  }
  function quiet() {
    clearInterval(timer);
    timer = void 0;
    if (frame !== void 0) cancelAnimationFrame(frame);
    frame = void 0;
    wave = void 0;
  }
  function recording() {
    quiet();
    time = el("span", { class: "time" }, "0:00");
    wave = el("canvas", { class: "wave" });
    dot = el("span", { class: "dot" });
    words = wordsOf("", "Listening\u2026");
    said = "";
    fetching = false;
    show("rec", words, dot, el("span", { class: "what" }, TITLES[mode]), time, wave);
    postHeight(true);
    levels.fill(0);
    fresh = true;
    timer = window.setInterval(() => {
      if (!recorder || !time) return;
      if (!fetching) time.textContent = clock(recorder.seconds);
      if (recorder instanceof StreamRecorder) for (const level of recorder.levels()) hear(level);
      else hear(recorder.level());
    }, 50);
    frame = requestAnimationFrame(draw);
  }
  async function start(next, session, expected = []) {
    mode = next;
    dropped = false;
    recorder = mode === "note" ? new ChunkRecorder(host.call, { source: "note", slice: 2e3 }) : session ? new StreamRecorder(host.call, session, expected, onStatus) : new PhraseRecorder();
    recording();
    try {
      starting = recorder.start();
      await starting;
    } catch (error) {
      recorder = void 0;
      quiet();
      host.post({ type: "dictationFailed", message: micTrouble(error) });
    }
  }
  async function stop() {
    await starting.catch(() => void 0);
    quiet();
    const r = recorder;
    recorder = void 0;
    if (!r) return;
    const behind = dot?.classList.contains("behind");
    show("busy", said ? wordsOf(said) : null, el("span", { class: "spin" }), el("span", { class: "what" }, mode === "note" ? "Saving the note\u2026" : behind ? "Catching up\u2026" : mode === "check" ? "Checking\u2026" : "Typing\u2026"));
    busy = r;
    try {
      if (r instanceof ChunkRecorder) host.post({ type: "dictationNote", id: await r.finish() });
      else if (r instanceof StreamRecorder) {
        const result = await r.finish();
        if (!dropped) host.post({ type: "dictationText", mode, text: result.text, language: result.language, sure: result.sure });
      } else host.post({ type: "dictationAudio", mode, audio: await r.finish() });
    } catch (error) {
      if (!dropped) host.post({ type: "dictationFailed", message: error instanceof Error ? error.message : String(error) });
    } finally {
      if (busy === r) busy = void 0;
    }
  }
  var busy;
  async function cancel() {
    await starting.catch(() => void 0);
    quiet();
    const r = recorder ?? busy;
    recorder = void 0;
    busy = void 0;
    dropped = true;
    await r?.cancel();
    host.post({ type: "dictationCancelled" });
  }
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (event.source !== window || !message || typeof message.type !== "string") return;
    if (message.type === "dictation") {
      if (message.command === "start") void start(message.mode, message.session, message.expected);
      else if (message.command === "stop") void stop();
      else void cancel();
    } else if (message.type === "dictationDone") {
      show("done", wordsOf(message.text), el("span", { class: "check" }, "\u2713"), el("span", { class: "what" }, mode === "note" ? "Saved" : "Typed"));
    } else if (message.type === "dictationError") {
      show("error", wordsOf(message.message), el("span", { class: "what" }, mode === "note" ? "The note was not saved" : "Nothing typed"));
    }
  });
  var posted = 0;
  function postHeight(again = false) {
    const px = Math.ceil(root.getBoundingClientRect().height);
    if (px === posted && !again) return;
    posted = px;
    host.post({ type: "dictationHeight", px });
  }
  new ResizeObserver(() => postHeight()).observe(root);
  host.post({ type: "dictationReady" });
})();
