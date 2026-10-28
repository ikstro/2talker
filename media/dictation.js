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

  // src/hotkey.ts
  function hotkeyLabel(hotkey) {
    const name = (mod) => mod === "Control" ? "Ctrl" : mod === "Super" ? "Win" : mod;
    return hotkey.split("+").map((part) => {
      const [key, times] = part.split("*");
      const side = /^(Left|Right)(Control|Shift|Alt|Super)$/.exec(key ?? "");
      if (side) return `${side[1]} ${name(side[2])}${times === "2" ? " twice" : ""}`;
      if (part === "CapsLock") return "Caps Lock";
      if (part === "ScrollLock") return "Scroll Lock";
      if (part === "MouseBack") return "Mouse Back";
      if (part === "MouseForward") return "Mouse Forward";
      if (part === "CommandOrControl" || part === "CmdOrCtrl") return "Ctrl";
      return name(part);
    }).join("+");
  }

  // src/webview/keycaps.ts
  function caps(hotkey, chain) {
    const attrs = chain ? { class: "kg", "data-chain": chain } : { class: "kg" };
    if (!hotkey) return el("span", attrs, el("span", { class: "key none" }, "not set"));
    const twice = hotkey.endsWith("*2");
    const parts = hotkey.replace(/\*2$/, "").split("+");
    return el("span", attrs, ...parts.map((part) => el("span", { class: "key" }, hotkeyLabel(part))), twice ? el("span", { class: "x2" }, "\xD72") : null);
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
  var TITLES = { type: "Dictate", english: "Dictate in English", note: "Note" };
  var recorder;
  var mode = "type";
  var starting = Promise.resolve();
  var timer;
  function clock(seconds) {
    const s = Math.floor(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  function show(kind, ...children) {
    root.className = `badge ${kind}`;
    root.replaceChildren(...children);
  }
  function recording(key) {
    const time = el("span", { class: "time" }, "0:00");
    const bars = Array.from({ length: 5 }, () => el("i"));
    show(
      "rec",
      el("div", { class: "line" }, el("span", { class: "dot" }), el("span", { class: "what" }, TITLES[mode]), time, el("span", { class: "meter" }, ...bars)),
      el("div", { class: "hint" }, key ? caps(key) : "", el("span", {}, mode === "note" ? "save" : "type it"), caps("Escape"), el("span", {}, "cancel"))
    );
    clearInterval(timer);
    timer = window.setInterval(() => {
      if (!recorder) return;
      time.textContent = clock(recorder.seconds);
      const level = recorder.level();
      bars.forEach((bar, i) => bar.classList.toggle("on", level > (i + 0.5) / bars.length));
    }, 80);
  }
  async function start(next, key) {
    mode = next;
    recorder = mode === "note" ? new ChunkRecorder(host.call, { source: "note", slice: 2e3 }) : new PhraseRecorder();
    recording(key);
    try {
      starting = recorder.start();
      await starting;
    } catch (error) {
      recorder = void 0;
      clearInterval(timer);
      host.post({ type: "dictationFailed", message: micTrouble(error) });
    }
  }
  async function stop() {
    await starting.catch(() => void 0);
    clearInterval(timer);
    const r = recorder;
    recorder = void 0;
    if (!r) return;
    show("busy", el("div", { class: "line" }, el("span", { class: "spin" }), el("span", { class: "what" }, mode === "note" ? "Saving the note\u2026" : "Typing\u2026")));
    try {
      if (r instanceof ChunkRecorder) host.post({ type: "dictationNote", id: await r.finish() });
      else host.post({ type: "dictationAudio", mode, audio: await r.finish() });
    } catch (error) {
      host.post({ type: "dictationFailed", message: error instanceof Error ? error.message : String(error) });
    }
  }
  async function cancel() {
    await starting.catch(() => void 0);
    clearInterval(timer);
    const r = recorder;
    recorder = void 0;
    await r?.cancel();
    host.post({ type: "dictationCancelled" });
  }
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (event.source !== window || !message || typeof message.type !== "string") return;
    if (message.type === "dictation") {
      if (message.command === "start") void start(message.mode, message.key);
      else if (message.command === "stop") void stop();
      else void cancel();
    } else if (message.type === "dictationDone") {
      show("done", el("div", { class: "line" }, el("span", { class: "check" }, "\u2713"), el("span", { class: "what" }, mode === "note" ? "Saved" : "Typed")), el("div", { class: "hint name" }, message.text));
    } else if (message.type === "dictationError") {
      show("error", el("div", { class: "line" }, el("span", { class: "what" }, mode === "note" ? "The note was not saved" : "Nothing typed")), el("div", { class: "hint name" }, message.message));
    }
  });
  host.post({ type: "dictationReady" });
})();
