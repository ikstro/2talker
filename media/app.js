"use strict";
(() => {
  // src/natural.ts
  var NATURAL_PREFIX = "natural:";
  var NATURAL_VOICES = [
    { id: "af_heart", name: "Heart", accent: "US", gender: "female" },
    { id: "af_bella", name: "Bella", accent: "US", gender: "female" },
    { id: "bf_emma", name: "Emma", accent: "UK", gender: "female" },
    { id: "am_michael", name: "Michael", accent: "US", gender: "male" },
    { id: "bm_george", name: "George", accent: "UK", gender: "male" }
  ];
  function naturalLabel(v) {
    return `${v.name} \xB7 ${v.accent} \xB7 ${v.gender}`;
  }

  // src/hotkey.ts
  var DOUBLE_MS = 400;
  var MODS = ["Control", "Alt", "Shift", "Super"];
  var TAPS = [
    { name: "LeftControl", code: "ControlLeft", vk: 162, mod: "Control" },
    { name: "RightControl", code: "ControlRight", vk: 163, mod: "Control" },
    { name: "LeftShift", code: "ShiftLeft", vk: 160, mod: "Shift" },
    { name: "RightShift", code: "ShiftRight", vk: 161, mod: "Shift" },
    { name: "LeftAlt", code: "AltLeft", vk: 164, mod: "Alt" },
    { name: "RightAlt", code: "AltRight", vk: 165, mod: "Alt" },
    { name: "LeftSuper", code: "MetaLeft", vk: 91, mod: "Super" },
    { name: "RightSuper", code: "MetaRight", vk: 92, mod: "Super" }
  ];
  var BUTTONS = { MouseBack: 1, MouseForward: 2 };
  var LONE = { Pause: 19, CapsLock: 20, ScrollLock: 145, Insert: 45 };
  var NAMED = {
    Space: 32,
    Tab: 9,
    Enter: 13,
    Backspace: 8,
    Delete: 46,
    Home: 36,
    End: 35,
    PageUp: 33,
    PageDown: 34,
    Up: 38,
    Down: 40,
    Left: 37,
    Right: 39,
    "`": 192,
    "-": 189,
    "=": 187,
    "[": 219,
    "]": 221,
    "\\": 220,
    ";": 186,
    "'": 222,
    ",": 188,
    ".": 190,
    "/": 191
  };
  var SIGNS = { Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/" };
  function keyCode(name) {
    if (name in LONE) return { vk: LONE[name], alone: true };
    const f = /^F([1-9]|1\d|2[0-4])$/.exec(name);
    if (f) return { vk: 111 + Number(f[1]), alone: true };
    if (/^[A-Z0-9]$/.test(name)) return { vk: name.charCodeAt(0), alone: false };
    if (name in NAMED) return { vk: NAMED[name], alone: false };
    return void 0;
  }
  function parseHotkey(hotkey) {
    const parts = hotkey.split("+").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return void 0;
    if (parts.length === 1) {
      const [name, times] = parts[0].split("*");
      const tap = TAPS.find((t) => t.name === name);
      if (tap && times === void 0) return { kind: "tap", vk: tap.vk };
      if (tap && times === "2") return { kind: "double", vk: tap.vk };
    }
    const mods = parts.filter((p) => MODS.includes(p));
    const rest = parts.filter((p) => !MODS.includes(p));
    if (rest.length === 0) return mods.length >= 2 ? { kind: "chord", mods: sortMods(mods) } : void 0;
    if (rest.length !== 1) return void 0;
    const last = rest[0];
    const button = BUTTONS[last];
    if (button) return { kind: "mouse", mods: sortMods(mods), button };
    const key = keyCode(last);
    if (!key || !key.alone && mods.length === 0) return void 0;
    return { kind: "key", mods: sortMods(mods), vk: key.vk };
  }
  function sortMods(mods) {
    return MODS.filter((m) => mods.includes(m));
  }
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
  function nameOfCode(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Arrow(Up|Down|Left|Right)$/.test(code)) return code.slice(5);
    if (code in SIGNS) return SIGNS[code];
    if (code in LONE || code in NAMED || /^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
    return void 0;
  }
  var HotkeyRecorder = class {
    held = /* @__PURE__ */ new Set();
    peak = [];
    other = false;
    /** When the modifier held alone went down, and the last tap: when it was let go. */
    downAt = 0;
    lastTap;
    /** A key went down at `now` (ms); returns the hotkey a non-modifier key makes, if any. */
    keydown(code, now = 0) {
      if (TAPS.some((t) => t.code === code)) {
        if (this.held.size === 0) this.downAt = now;
        this.held.add(code);
        if (this.held.size > this.peak.length) this.peak = [...this.held];
        return void 0;
      }
      this.other = true;
      this.lastTap = void 0;
      const name = nameOfCode(code);
      return name ? this.withMods(name) : void 0;
    }
    /** A key went up at `now`; returns the tap, double or chord once the last modifier is let go. */
    keyup(code, now = 0) {
      if (!TAPS.some((t) => t.code === code)) return void 0;
      this.held.delete(code);
      if (this.held.size > 0) return void 0;
      const peak = this.peak;
      const other = this.other;
      this.peak = [];
      this.other = false;
      if (other || peak.length === 0) return void 0;
      if (peak.length > 1) {
        this.lastTap = void 0;
        const mods = sortMods(peak.map((c) => TAPS.find((t) => t.code === c)?.mod).filter((m) => !!m));
        return mods.length >= 2 ? { hotkey: mods.join("+") } : void 0;
      }
      const name = TAPS.find((t) => t.code === peak[0])?.name;
      if (!name) return void 0;
      const previous = this.lastTap;
      this.lastTap = void 0;
      if (previous?.name === name && this.downAt - previous.at <= DOUBLE_MS) return { hotkey: `${name}*2` };
      this.lastTap = { name, at: now };
      return { hotkey: name, more: true };
    }
    /** A mouse button went down: the back or forward button (3, 4 in DOM numbering) is a hotkey. */
    mouse(button) {
      this.lastTap = void 0;
      this.other = this.held.size > 0;
      const name = button === 3 ? "MouseBack" : button === 4 ? "MouseForward" : void 0;
      return name ? this.withMods(name) : void 0;
    }
    reset() {
      this.held.clear();
      this.peak = [];
      this.other = false;
      this.lastTap = void 0;
    }
    withMods(name) {
      const mods = sortMods([...this.held].map((c) => TAPS.find((t) => t.code === c)?.mod).filter((m) => !!m));
      const hotkey = [...mods, name].join("+");
      return parseHotkey(hotkey) ? { hotkey } : void 0;
    }
  };

  // src/settings.ts
  var RATES = [0.75, 0.9, 1, 1.15, 1.3, 1.5];

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
  function icon(name, extra = "") {
    return el("i", { class: `codicon codicon-${name}${extra ? " " + extra : ""}`, "aria-hidden": "true" });
  }
  function setIcon(node, name) {
    if (!node) return;
    for (const c of [...node.classList]) if (c.startsWith("codicon-")) node.classList.remove(c);
    node.classList.add(`codicon-${name}`);
  }

  // src/webview/glyphs.ts
  var GLYPHS = {
    play: '<path class="f" d="M5 3.2v9.6c0 .5.5.8.9.5l7-4.8a.6.6 0 0 0 0-1L5.9 2.7c-.4-.3-.9 0-.9.5z"/>',
    stop: '<rect class="f" x="3.5" y="3.5" width="9" height="9" rx="1.8"/>',
    prev: '<path d="M3.5 3.5v9"/><path class="f" d="M12.5 3.6v8.8c0 .4-.5.7-.8.4L6 8.4a.5.5 0 0 1 0-.8l5.7-4.4c.3-.3.8 0 .8.4z"/>',
    next: '<path d="M12.5 3.5v9"/><path class="f" d="M3.5 3.6v8.8c0 .4.5.7.8.4L10 8.4a.5.5 0 0 0 0-.8L4.3 3.2c-.3-.3-.8 0-.8.4z"/>',
    pin: '<path d="M6 2.5h4M7 2.5v3.8L4.5 9h7L9 6.3V2.5M8 9v4.5"/>',
    close: '<path d="M4 4l8 8M12 4l-8 8"/>',
    minimize: '<path d="M4 8h8"/>'
  };
  function glyph(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "glyph");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    svg.dataset.shape = name;
    svg.innerHTML = GLYPHS[name];
    return svg;
  }

  // src/webview/keycaps.ts
  var COPY_TWICE = "Control+C*2";
  function caps(hotkey, chain) {
    const attrs = chain ? { class: "kg", "data-chain": chain } : { class: "kg" };
    if (!hotkey) return el("span", attrs, el("span", { class: "key none" }, "not set"));
    const twice = hotkey.endsWith("*2");
    const parts = hotkey.replace(/\*2$/, "").split("+");
    return el("span", attrs, ...parts.map((part) => el("span", { class: "key" }, hotkeyLabel(part))), twice ? el("span", { class: "x2" }, "\xD72") : null);
  }

  // src/webview/app.ts
  var post = (message) => window.tutorHost.post(message);
  var save = (patch) => post({ type: "saveSettings", patch });
  var ACTIONS = ["listen", "translate", "screen", "dictate", "keyboard"];
  var isAction = (name) => ACTIONS.includes(name);
  var TITLES = {
    listen: "Listen",
    translate: "Translate",
    screen: "Screen",
    dictate: "Dictate",
    keyboard: "Keyboard",
    words: "Words",
    settings: "Settings",
    about: "About"
  };
  var view;
  var askedTab;
  var search = "";
  var keyTrouble;
  var pickedLayout = "";
  var addingApp = false;
  var reduced = matchMedia("(prefers-reduced-motion: reduce)");
  var frozenAt = (name) => {
    const m = new RegExp(`(?:^#|&)${name}=([\\d.]+)`).exec(location.hash);
    return m ? parseFloat(m[1]) : void 0;
  };
  var FROZEN_T = frozenAt("t");
  var FROZEN_PT = frozenAt("pt");
  var clamp = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
  var prog = (t, a, b) => clamp((t - a) / (b - a));
  var lerp = (a, b, p) => a + (b - a) * p;
  var spring = (x) => x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-8 * x) * (Math.cos(8.5 * x) + 8 / 8.5 * Math.sin(8.5 * x));
  var pop = (x) => x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-6.5 * x) * Math.cos(10 * x);
  var pspring = (x) => x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-9 * x) * (Math.cos(5 * x) + 1.8 * Math.sin(5 * x));
  var root = document.getElementById("root");
  function rel(node) {
    const w = root.getBoundingClientRect();
    const b = node.getBoundingClientRect();
    return { x: b.left - w.left, y: b.top - w.top, w: b.width, h: b.height };
  }
  var fontOf = (node) => parseFloat(getComputedStyle(node).fontSize) || 16;
  var SAMPLES = {
    Russian: { typed: "ghbdtn vbh", fixed: "\u043F\u0440\u0438\u0432\u0435\u0442 \u043C\u0438\u0440", from: "EN", to: "RU" },
    Ukrainian: { typed: "ghbdsn cdsn", fixed: "\u043F\u0440\u0438\u0432\u0456\u0442 \u0441\u0432\u0456\u0442", from: "EN", to: "UK" }
  };
  var sampleOf = (native) => SAMPLES[native] ?? SAMPLES.Russian;
  var said = (hotkey) => hotkey === COPY_TWICE ? "Ctrl + C twice" : hotkeyLabel(hotkey);
  var usage = (hotkey) => `${/^(Left|Right)(Control|Shift|Alt|Super)(\*2)?$/.test(hotkey) ? "tap" : "press"} ${said(hotkey)}`;
  function keyLines(action, s) {
    switch (action) {
      case "listen":
        if (s.doubleCopy && s.selectKey)
          return [
            { label: "copy", hotkey: COPY_TWICE, chain: "listen" },
            { label: "selection", hotkey: s.selectKey }
          ];
        return [{ label: "selection", hotkey: s.doubleCopy ? COPY_TWICE : s.selectKey, chain: "listen" }];
      case "translate":
        return [
          { label: "selection", hotkey: s.translateKey, chain: "translate" },
          { label: "paste", hotkey: "Enter" }
        ];
      case "screen":
        return [
          { label: "listen", hotkey: s.snipKey },
          { label: "translate", hotkey: s.textKey }
        ];
      case "dictate":
        return [{ label: "hold or tap", hotkey: "" }];
      case "keyboard":
        return [
          { label: "switch", hotkey: s.switchKey },
          { label: "fix", hotkey: s.fixKey, chain: "fix" }
        ];
    }
  }
  function keysOf(action, s, chained = false) {
    return keyLines(action, s).flatMap((k) => [el("span", { class: "kl" }, k.label), caps(k.hotkey, chained ? k.chain : void 0)]);
  }
  function cycleOf(v) {
    const chosen = v.settings.layouts.map((id) => v.layouts.find((l) => l.id === id)).filter((l) => !!l);
    return chosen.length > 0 ? chosen : v.layouts;
  }
  var naturalOn = (v) => v.natural.status === "ready" && (v.settings.voice === "" || v.settings.voice.startsWith(NATURAL_PREFIX));
  var pairOf = (v) => `${v.settings.native} \u21C4 English`;
  function actionText(action, v) {
    const title = TITLES[action];
    switch (action) {
      case "listen":
        return { title, cap: naturalOn(v) ? "natural voice" : "Windows voice", desc: "Reads English aloud, the translation under it." };
      case "translate":
        return { title, cap: pairOf(v), desc: "Your text into English. Enter pastes it back." };
      case "screen":
        return { title, cap: "Windows OCR", desc: "Draw a box over words you can\u2019t select." };
      case "dictate":
        return { title, cap: "coming", desc: `Say it and it types. Say it in ${v.settings.native}, get English.` };
      case "keyboard":
        return {
          title,
          cap: cycleOf(v).map((l) => l.short).join(" \xB7 "),
          desc: v.settings.autoFix ? "Fixes words typed in the wrong layout as you type." : "Switches the layout and fixes what was typed wrong."
        };
    }
  }
  var wordCount = el("span", { class: "n" });
  var pill = (page, ...children) => el("button", page === "home" ? { class: "pill", "data-home": true, onclick: () => closePage() } : { class: "pill", "data-page": page, onclick: () => openPage(page) }, ...children);
  var nav = el(
    "nav",
    { class: "nav" },
    pill("home", el("span", { class: "lbl" }, "Home")),
    pill("words", el("span", { class: "lbl" }, "Words"), wordCount),
    pill("about", el("span", { class: "lbl" }, "About")),
    el("span", { class: "gap" }),
    pill("settings", icon("settings"), el("span", { class: "lbl" }, "Settings"))
  );
  var winButtons = el(
    "div",
    { class: "wbtns" },
    el("button", { class: "icon-btn", title: "Minimize", "aria-label": "Minimize", onclick: () => post({ type: "window", action: "minimize" }) }, glyph("minimize")),
    el("button", { class: "icon-btn", title: "Close", "aria-label": "Close", onclick: () => post({ type: "window", action: "close" }) }, glyph("close"))
  );
  var top = el("header", { class: "top" }, el("div", { class: "brand" }, el("span", { class: "key" }, "alt"), el("span", { class: "wm" }, "altype")), nav, winButtons);
  var home = el("main", { class: "home" });
  var pGround = el("div", { class: "pgg" });
  var pBack = el("button", { class: "pback", onclick: () => closePage() }, icon("chevron-left"), "Back", el("span", { class: "key" }, "Esc"));
  var pTitle = el("span", { class: "ptitle" });
  var pCap = el("span", { class: "pcap" });
  var pKeys = el("div", { class: "pkeys keys" });
  var pLine = el("div", { class: "pline" });
  var pBody = el("div", { class: "pbody" });
  var pg = el("section", { class: "pg", role: "dialog" }, pGround, pBack, el("div", { class: "pth" }, pTitle, pCap), pKeys, pLine, pBody);
  root.append(top, home, pg);
  function updateNav() {
    const n = view?.words.length ?? 0;
    wordCount.textContent = n ? String(n) : "";
    for (const b of nav.querySelectorAll(".pill")) {
      const page = b.dataset.page;
      b.classList.toggle("on", open && !isAction(open.name) ? page === open.name : b.hasAttribute("data-home"));
    }
  }
  function readiness(v) {
    const translator = {
      ready: "ready",
      absent: "downloads on first use",
      downloading: "downloading",
      failed: "could not download; tries again on the next translation",
      unsupported: "has no offline translator yet"
    }[v.translator];
    const n = v.natural;
    const voice = n.status === "downloading" ? [el("b", {}, "natural voice"), ` ${Math.round(n.progress * 100)}%`] : n.status === "failed" ? [el("b", {}, "Windows voice"), " ready (the natural voice could not download)"] : [el("b", {}, naturalOn(v) ? "natural voice" : "Windows voice"), " ready"];
    return [el("b", {}, pairOf(v)), ` ${translator} \xB7 `, ...voice, " \xB7 runs on this computer"];
  }
  function homeRow(action, v) {
    const t = actionText(action, v);
    const go = () => openPage(action);
    return el(
      "li",
      {
        class: action === "dictate" ? "act soon" : "act",
        "data-page": action,
        role: "button",
        tabindex: 0,
        onclick: go,
        onkeydown: (event) => {
          const key = event.key;
          if (key === "Enter" || key === " ") event.preventDefault(), go();
        }
      },
      el("div", {}, el("div", { class: "an" }, el("b", {}, t.title), el("i", {}, t.cap)), el("div", { class: "ad" }, t.desc)),
      el("div", { class: "keys" }, ...keysOf(action, v.settings, true)),
      icon("chevron-right", "chev")
    );
  }
  function homeNodes(v) {
    const sample = sampleOf(v.settings.native);
    return [
      el(
        "div",
        { class: "head" },
        el(
          "div",
          { class: "hline" },
          el("span", { class: "hs h1" }, sample.typed),
          el("span", { class: "arr a1" }, "\u2192"),
          el("span", { class: "hs h2" }, sample.fixed),
          el("span", { class: "arr a2" }, "\u2192"),
          el("span", { class: "hs h3" }, "hello world"),
          el("button", { class: "replay", title: "Play the line again", onclick: () => playMoment(false) }, icon("play"), el("span", {}, "Replay"))
        ),
        el("p", { class: "hcap" }, ...readiness(v))
      ),
      el("ul", { class: "acts" }, ...ACTIONS.map((a) => homeRow(a, v))),
      el("p", { class: "foot" }, "Tap an action to change its keys.")
    ];
  }
  var homePending = false;
  function renderHome(force = false) {
    if (!view) return;
    if (moment || animating) {
      homePending = true;
      return;
    }
    homePending = false;
    const next = el("div", {}, ...homeNodes(view));
    if (!force && next.innerHTML === home.innerHTML) return;
    home.replaceChildren(...next.childNodes);
  }
  var T_END = 5.7;
  var TYPE0 = 0.2;
  var TYPE_STEP = 0.09;
  var FIX = 1.3;
  var FLIP0 = 1.36;
  var FLIP_STEP = 0.045;
  var FLIP_D = 0.3;
  var TR = [2.12, 2.26];
  var SWAP = 2.32;
  var LI = [3.02, 3.15];
  var WORDS = [
    [3.3, 3.76],
    [3.76, 4.26]
  ];
  var TRAVEL = 4.4;
  var moment;
  function buildMoment(v, markSeen) {
    const q = (s2) => home.querySelector(s2);
    const head = q(".head"), h1 = q(".h1"), h2 = q(".h2"), h3 = q(".h3"), replay = q(".replay"), hcap = q(".hcap"), foot = q(".foot");
    const kf = q("[data-chain=fix]"), kt = q("[data-chain=translate]"), kl = q("[data-chain=listen]");
    if (!head || !h1 || !h2 || !h3 || !replay || !hcap || !foot || !kf || !kt || !kl) return void 0;
    const s = v.settings;
    const sample = sampleOf(s.native);
    const cells = [...sample.typed].map((ch, i) => {
      const a = el("span", {}, ch === " " ? "\xA0" : ch);
      const b = el("span", {}, sample.fixed[i] === " " ? "\xA0" : sample.fixed[i] ?? "");
      return { c: el("span", { class: "cell" }, a, b), a, b, wa: 0, wb: 0 };
    });
    const caret = el("span", { class: "caret" });
    const badge = el("span", { class: "badge" }, sample.from);
    const line = el("div", { class: "big" }, ...cells.map((k) => k.c), caret, badge);
    const w1 = el("span", { class: "w" }, "hello");
    const w2 = el("span", { class: "w" }, "world");
    const line2 = el("div", { class: "big" }, w1, "\xA0", w2);
    const playIcon = icon("play");
    const play = el("div", { class: "play" }, playIcon);
    const t1 = el("div", { class: "trail t1" }, sample.typed);
    const t2 = el("div", { class: "trail t2" }, sample.fixed);
    const eyebrow = el("div", { class: "eyebrow" }, "One line, three keys");
    const listenKey = keyLines("listen", s)[0]?.hotkey ?? "";
    const step = (n, hotkey, what) => {
      const keys = caps(hotkey);
      const small = el("small", {}, el("em", {}, String(n)), what);
      return { keys, small, node: el("div", { class: "step" }, keys, small) };
    };
    const sf = step(1, s.fixKey, "fix"), st = step(2, s.translateKey, "translate"), sl = step(3, listenKey, "listen");
    const rail = el("div", { class: "rail" }, sf.node, st.node, sl.node);
    const stage = el("div", { class: "stage" }, eyebrow, t1, t2, line, line2, play, rail);
    stage.style.top = `${Math.round(Math.max(-40, Math.min(80, (root.clientHeight - 620) / 2)))}px`;
    root.append(stage);
    for (const k of cells) {
      k.wa = k.a.getBoundingClientRect().width;
      k.wb = k.b.getBoundingClientRect().width;
    }
    const l2 = rel(line2);
    play.style.left = `${l2.x + l2.w + 18}px`;
    play.style.top = `${l2.y - (parseFloat(stage.style.top) || 0) + (l2.h - 40) / 2}px`;
    const m = {
      raf: 0,
      markSeen,
      sample,
      stage,
      cells,
      caret,
      badge,
      t1,
      t2,
      line,
      line2,
      w1,
      w2,
      play,
      playIcon,
      eyebrow,
      smalls: [sf.small, st.small, sl.small],
      rail: { fix: sf.keys, translate: st.keys, listen: sl.keys },
      h: { head, h1, h2, h3, arrows: [...home.querySelectorAll(".arr")], replay, replayLabel: replay.querySelector("span") ?? replay, hcap, foot, rows: [...home.querySelectorAll(".act")], kf, kt, kl },
      g: {
        t1: rel(t1),
        t2: rel(t2),
        line: rel(line),
        line2: l2,
        play: rel(play),
        h1: rel(h1),
        h2: rel(h2),
        h3: rel(h3),
        replay: rel(replay),
        rf: rel(sf.keys),
        rt: rel(st.keys),
        rl: rel(sl.keys),
        kf: rel(kf),
        kt: rel(kt),
        kl: rel(kl)
      },
      f: { trail: fontOf(t1), big: fontOf(line), head: fontOf(h3) }
    };
    root.classList.add("playing");
    return m;
  }
  var press = (t, at) => t >= at && t < at + 0.11;
  function lightKeys(group, lit, down) {
    for (const k of group.querySelectorAll(".key")) {
      k.classList.toggle("lit", lit);
      k.classList.toggle("down", down);
    }
    group.classList.toggle("lit", lit);
  }
  function setStyle(node, opacity, transform = "") {
    node.style.opacity = String(opacity);
    node.style.transform = transform;
  }
  var shown = (node, on) => node.style.visibility = on ? "visible" : "hidden";
  function move(node, from, to, p, s1) {
    const s = lerp(1, s1, p);
    const dx = (to.x - from.x) * p;
    const dy = (to.y + to.h / 2 - (from.y + from.h / 2 * s1)) * p;
    node.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
  }
  function renderMoment(m, t) {
    const { g, h, f } = m;
    m.cells.forEach((k, i) => {
      k.c.style.display = t >= TYPE0 + i * TYPE_STEP ? "" : "none";
      const p = spring(prog(t, FLIP0 + i * FLIP_STEP, FLIP0 + i * FLIP_STEP + FLIP_D));
      k.c.style.width = `${lerp(k.wa, k.wb, clamp(p))}px`;
      setStyle(k.a, 1 - clamp(p * 2.2), `translateY(${-p * 26}px)`);
      setStyle(k.b, clamp((p - 0.25) * 1.6), `translateY(${(1 - p) * 26}px)`);
    });
    const typing = t >= TYPE0 && t < TYPE0 + m.cells.length * TYPE_STEP + 0.05;
    m.caret.style.opacity = t < SWAP && (typing || Math.floor(t * 2.4) % 2 === 0) ? "1" : "0";
    const out = prog(t, SWAP - 0.1, SWAP + 0.1);
    m.badge.textContent = t < FIX + 0.25 ? m.sample.from : m.sample.to;
    const pulse = t >= FIX + 0.25 ? 1 + 0.18 * Math.sin(Math.PI * prog(t, FIX + 0.25, FIX + 0.5)) : 1;
    setStyle(m.badge, 1 - out, `scale(${pulse * (1 - out)})`);
    const big = f.big / f.trail;
    const p1 = spring(prog(t, FIX + 0.04, FIX + 0.8));
    move(m.t1, g.t1, g.line, 1 - p1, big);
    m.t1.style.opacity = t < FIX + 0.04 ? "0" : String(clamp(p1 * 2.2));
    const p2 = spring(prog(t, SWAP, SWAP + 0.75));
    move(m.t2, g.t2, g.line, 1 - p2, big);
    m.t2.style.opacity = t < SWAP ? "0" : "1";
    m.line.style.opacity = t < SWAP ? "1" : "0";
    const inn = spring(prog(t, SWAP + 0.14, SWAP + 0.8));
    setStyle(m.line2, clamp(inn * 2), `translateY(${(1 - inn) * 34}px)`);
    const speaking = t >= WORDS[0][0] && t < WORDS[1][1];
    m.w1.classList.toggle("on", t >= WORDS[0][0] && t < WORDS[0][1]);
    m.w2.classList.toggle("on", t >= WORDS[1][0] && t < WORDS[1][1]);
    setIcon(m.playIcon, speaking ? "primitive-square" : "play");
    m.play.classList.toggle("speaking", speaking);
    lightKeys(m.rail.fix, t >= FIX && t < SWAP, press(t, FIX));
    lightKeys(m.rail.translate, t >= TR[0] && t < LI[0], press(t, TR[0]) || press(t, TR[1]));
    lightKeys(m.rail.listen, t >= LI[0] && t < WORDS[1][1] + 0.1, press(t, LI[0]) || press(t, LI[1]));
    const T = (d, dur = 0.8) => spring(prog(t, TRAVEL + d, TRAVEL + d + dur));
    if (t >= TRAVEL) {
      move(m.line2, g.line2, g.h3, T(0), f.head / f.big);
      move(m.t2, g.t2, g.h2, T(0.06), f.head / f.trail);
      move(m.t1, g.t1, g.h1, T(0.12), f.head / f.trail);
      m.t1.style.opacity = "1";
      m.t2.style.opacity = "1";
    }
    if (t < TRAVEL) setStyle(m.play, t >= LI[0] ? 1 : 0, `scale(${pop(prog(t, LI[0] + 0.02, LI[0] + 0.5))})`);
    else {
      m.play.style.opacity = "1";
      move(m.play, g.play, { x: g.replay.x, y: g.replay.y, w: 28, h: 28 }, T(0.02), 28 / 40);
    }
    const flights = [
      [m.rail.listen, g.rl, g.kl, 0],
      [m.rail.translate, g.rt, g.kt, 0.06],
      [m.rail.fix, g.rf, g.kf, 0.12]
    ];
    for (const [node, from, to, d] of flights) {
      const p = T(0.1 + d);
      node.style.transform = t >= TRAVEL ? `translate(${(to.x - from.x) * p}px, ${(to.y - from.y) * p}px)` : "";
    }
    const fade = 1 - prog(t, TRAVEL, TRAVEL + 0.25);
    m.eyebrow.style.opacity = String(fade);
    for (const s of m.smalls) s.style.opacity = String(fade);
    h.rows.forEach((row2, i) => {
      const p = spring(prog(t, TRAVEL + 0.22 + i * 0.06, TRAVEL + 0.92 + i * 0.06));
      setStyle(row2, clamp(p * 1.3), `translateY(${(1 - p) * 14}px)`);
    });
    const hp = spring(prog(t, TRAVEL + 0.45, TRAVEL + 1));
    for (const a of h.arrows) setStyle(a, hp, `translateX(${(1 - hp) * -8}px)`);
    setStyle(h.hcap, hp, `translateY(${(1 - hp) * 6}px)`);
    h.head.style.borderBottomColor = `color-mix(in srgb, var(--border-soft) ${hp * 100}%, transparent)`;
    h.foot.style.opacity = String(spring(prog(t, TRAVEL + 0.8, TRAVEL + 1.2)));
    const landed = (d) => t >= TRAVEL + d + 0.8;
    shown(h.h3, landed(0)), shown(m.line2, !landed(0));
    shown(h.h2, landed(0.06)), shown(m.t2, !landed(0.06));
    shown(h.h1, landed(0.12)), shown(m.t1, !landed(0.12));
    shown(h.kl, landed(0.1)), shown(m.rail.listen, !landed(0.1));
    shown(h.kt, landed(0.16)), shown(m.rail.translate, !landed(0.16));
    shown(h.kf, landed(0.22)), shown(m.rail.fix, !landed(0.22));
    shown(m.play, !landed(0.02));
    const rp = spring(prog(t, TRAVEL + 0.82, TRAVEL + 1.3));
    shown(h.replay, landed(0.02));
    h.replay.style.width = `${lerp(28, g.replay.w, rp)}px`;
    h.replayLabel.style.opacity = String(rp);
  }
  function playMoment(markSeen, at) {
    if (!view) return;
    if (moment) finishMoment();
    if (open) closePage(false);
    const v = view;
    void document.fonts.ready.then(() => {
      if (moment) return;
      renderHome(true);
      const m = buildMoment(v, markSeen);
      if (!m) return;
      moment = m;
      renderMoment(m, Math.min(at ?? 0, T_END));
      if (at !== void 0) return;
      const t0 = performance.now();
      const tick = (now) => {
        const t = (now - t0) / 1e3;
        if (t >= T_END) return finishMoment();
        renderMoment(m, t);
        m.raf = requestAnimationFrame(tick);
      };
      m.raf = requestAnimationFrame(tick);
    });
  }
  function finishMoment() {
    const m = moment;
    if (!m) return;
    cancelAnimationFrame(m.raf);
    m.stage.remove();
    root.classList.remove("playing");
    moment = void 0;
    renderHome(true);
    if (m.markSeen) save({ introSeen: true });
  }
  var PD = 0.45;
  var open;
  var praf = 0;
  var animating = false;
  function sourceOf(name) {
    return isAction(name) ? home.querySelector(`.act[data-page="${name}"]`) : nav.querySelector(`[data-page="${name}"]`);
  }
  function measureGrowth(source) {
    pTitle.style.transform = "";
    pCap.style.transform = "";
    pKeys.style.transform = "";
    const dst = { title: rel(pTitle), cap: rel(pCap), keys: rel(pKeys), tfont: fontOf(pTitle) };
    const row2 = source.classList.contains("act");
    const box = rel(source);
    const title = (row2 ? source.querySelector(".an b") : source.querySelector(".lbl")) ?? source;
    const cap = row2 ? source.querySelector(".an i") : null;
    const keys = row2 ? source.querySelector(".keys") : null;
    return {
      source,
      row: row2,
      src: { ground: { ...box, r: row2 ? 12 : box.h / 2 }, title: rel(title), tfont: fontOf(title), cap: cap ? rel(cap) : null, keys: keys ? rel(keys) : null },
      dst
    };
  }
  function renderGrowth(gr, p) {
    const { src, dst, source } = gr;
    const q = clamp(p);
    const W = root.clientWidth;
    const H = root.clientHeight;
    const B = top.offsetHeight;
    const gs = src.ground;
    const gx = lerp(gs.x, 0, p), gy = lerp(gs.y, B, p), gw = lerp(gs.w, W, p), gh = lerp(gs.h, H - B, p), r = lerp(gs.r, 0, q);
    const done = p >= 1;
    pGround.style.left = done ? "" : `${gx}px`;
    pGround.style.top = done ? "" : `${gy}px`;
    pGround.style.width = done ? "" : `${gw}px`;
    pGround.style.height = done ? "" : `${gh}px`;
    pGround.style.borderRadius = done ? "" : `${r}px`;
    pg.style.clipPath = done ? "" : `inset(${gy}px ${W - gx - gw}px ${H - gy - gh}px ${gx}px round ${r}px)`;
    pg.style.visibility = p <= 0 ? "hidden" : "";
    const s0 = src.tfont / dst.tfont;
    const s = lerp(s0, 1, p);
    const ty = src.title.y + src.title.h / 2 - (dst.title.y + dst.title.h * s0 / 2);
    pTitle.style.transform = done ? "" : `translate(${(src.title.x - dst.title.x) * (1 - p)}px, ${ty * (1 - p)}px) scale(${s})`;
    if (src.cap) setStyle(pCap, 1, done ? "" : `translate(${(src.cap.x - dst.cap.x) * (1 - p)}px, ${(src.cap.y - dst.cap.y) * (1 - p)}px)`);
    else setStyle(pCap, clamp((p - 0.45) * 2), done ? "" : `translateX(${(1 - q) * -8}px)`);
    pKeys.style.transform = src.keys && !done ? `translate(${(src.keys.x - dst.keys.x) * (1 - p)}px, ${(src.keys.y - dst.keys.y) * (1 - p)}px)` : "";
    const late = clamp((p - 0.82) / 0.18);
    setStyle(pBack, late, done ? "" : `translateX(${(1 - late) * -10}px)`);
    setStyle(pLine, late, done ? "" : `scaleX(${0.6 + 0.4 * late})`);
    setStyle(pBody, late, done ? "" : `translateY(${(1 - late) * 14}px)`);
    for (const row2 of home.querySelectorAll(".act")) {
      if (row2 === source) continue;
      setStyle(row2, 1 - clamp(q * 1.5), `translateY(${q * 36}px)`);
    }
    if (gr.row) source.style.visibility = p > 0 ? "hidden" : "";
    source.classList.toggle("pressed", p <= 0);
  }
  function resetHome() {
    for (const node of root.querySelectorAll(".act, .nav .pill")) {
      node.style.transform = "";
      node.style.opacity = "";
      node.style.visibility = "";
      node.classList.remove("pressed");
    }
  }
  function grow(gr, opening, done) {
    cancelAnimationFrame(praf);
    if (FROZEN_PT !== void 0 && opening) return renderGrowth(gr, FROZEN_PT >= PD ? 1 : pspring(FROZEN_PT / PD));
    animating = true;
    const t0 = performance.now();
    const tick = (now) => {
      const t = (now - t0) / 1e3;
      const k = t >= PD ? 1 : pspring(t / PD);
      renderGrowth(gr, opening ? k : 1 - k);
      if (t < PD) praf = requestAnimationFrame(tick);
      else {
        animating = false;
        done?.();
        if (homePending) renderHome();
      }
    };
    praf = requestAnimationFrame(tick);
  }
  function openPage(name, animate = !reduced.matches) {
    if (!view || open?.name === name) return;
    if (moment) finishMoment();
    if (open) closePage(false);
    open = { name };
    search = "";
    pickedLayout = "";
    addingApp = false;
    keyTrouble = void 0;
    fillHeader();
    pBody.replaceChildren();
    renderBody();
    pBody.scrollTop = 0;
    root.classList.add("page-open");
    updateNav();
    const source = sourceOf(name);
    const settle = () => pBack.focus({ preventScroll: true });
    if (!source || !animate) {
      resetHome();
      for (const node of [pg, pGround, pTitle, pCap, pKeys, pBack, pLine, pBody]) node.removeAttribute("style");
      return settle();
    }
    const gr = measureGrowth(source);
    renderGrowth(gr, 0);
    grow(gr, true, settle);
  }
  function closePage(animate = !reduced.matches) {
    if (!open) return;
    const name = open.name;
    const done = () => {
      root.classList.remove("page-open");
      pg.style.visibility = "";
      pg.style.clipPath = "";
      resetHome();
      open = void 0;
      updateNav();
      if (homePending) renderHome();
    };
    cancelAnimationFrame(praf);
    animating = false;
    const source = sourceOf(name);
    if (!source || !animate) return done();
    const back = pg.contains(document.activeElement);
    grow(measureGrowth(source), false, () => {
      done();
      if (back) source.focus({ preventScroll: true });
    });
  }
  function fillHeader() {
    if (!view || !open) return;
    const name = open.name;
    const v = view;
    pTitle.textContent = TITLES[name];
    pCap.textContent = isAction(name) ? actionText(name, v).cap : name === "words" ? v.words.length ? `${v.words.length} saved \xB7 from your cards` : "none yet \xB7 from your cards" : name === "about" ? `Altype ${v.version}` : "";
    const keys = isAction(name) ? keysOf(name, v.settings) : [];
    const next = el("div", {}, ...keys);
    if (next.innerHTML !== pKeys.innerHTML) pKeys.replaceChildren(...next.childNodes);
  }
  var bodyPending = false;
  var pointerDown = false;
  function busy() {
    const a = document.activeElement;
    return !!a && pBody.contains(a) && (a.matches("input[type=text], input[type=search]") || a.classList.contains("recording"));
  }
  function renderBody() {
    if (!view || !open) return;
    const next = el("div", {}, ...bodyOf(open.name, view));
    if (next.innerHTML === pBody.innerHTML) return;
    if (busy()) {
      bodyPending = true;
      return;
    }
    bodyPending = false;
    const scroll = pBody.scrollTop;
    pBody.replaceChildren(...next.childNodes);
    pBody.scrollTop = scroll;
  }
  pBody.addEventListener("focusout", () => {
    if (!bodyPending) return;
    const later = () => window.setTimeout(renderBody, 0);
    if (pointerDown) window.addEventListener("pointerup", later, { once: true });
    else later();
  });
  window.addEventListener("pointerdown", () => pointerDown = true, true);
  window.addEventListener("pointerup", () => pointerDown = false, true);
  function bodyOf(name, v) {
    switch (name) {
      case "listen":
        return listenPage(v);
      case "translate":
        return translatePage(v);
      case "screen":
        return screenPage(v);
      case "dictate":
        return dictatePage();
      case "keyboard":
        return keyboardPage(v);
      case "words":
        return wordsPage(v);
      case "settings":
        return settingsPage(v);
      case "about":
        return aboutPage(v);
    }
  }
  var grp = (text) => el("div", { class: "grp" }, text);
  var bad = (text) => el("small", { class: "bad" }, text);
  function row(label, notes, ...controls) {
    return el("div", { class: "row" }, el("div", { class: "l" }, label, ...notes.filter((n) => !!n).map((n) => typeof n === "string" ? el("small", {}, n) : n)), ...controls);
  }
  function toggle(label, on, onchange, ...notes) {
    const knob = el("span", { class: on ? "tg on" : "tg" });
    const node = el(
      "button",
      {
        class: "row trow",
        role: "switch",
        "aria-checked": String(on),
        onclick: () => {
          const next = node.getAttribute("aria-checked") !== "true";
          node.setAttribute("aria-checked", String(next));
          knob.classList.toggle("on", next);
          onchange(next);
        }
      },
      el("span", { class: "l" }, label, ...notes.filter((n) => !!n).map((n) => typeof n === "string" ? el("small", {}, n) : n)),
      knob
    );
    return node;
  }
  function seg(value, options, onchange, mono = false) {
    const node = el("span", { class: mono ? "seg mono" : "seg", role: "radiogroup" });
    for (const [v, label] of options) {
      const b = el(
        "button",
        {
          class: v === value ? "on" : "",
          role: "radio",
          "aria-checked": String(v === value),
          onclick: () => {
            for (const other of node.children) {
              other.classList.toggle("on", other === b);
              other.setAttribute("aria-checked", String(other === b));
            }
            onchange(v);
          }
        },
        label
      );
      node.append(b);
    }
    return node;
  }
  function select(value, options, onchange) {
    const node = el("select", {
      onchange: (event) => {
        const raw = event.target.value;
        const picked = options.find(([v]) => String(v) === raw)?.[0];
        if (picked !== void 0) onchange(picked);
      }
    });
    for (const [v, label] of options) node.append(el("option", v === value ? { value: String(v), selected: true } : { value: String(v) }, label));
    return el("span", { class: "sel" }, node, icon("chevron-down"));
  }
  var linkBtn = (text, onclick, disabled = false) => el("button", { class: "link", disabled, onclick }, text);
  var chip = (text, cls = "") => el("span", { class: `chip${cls ? " " + cls : ""}` }, text);
  function link(url, text) {
    return el("a", { href: url, onclick: (event) => (event.preventDefault(), post({ type: "openLink", url })) }, text);
  }
  function tryIt(text, how) {
    return el("div", { class: "try" }, el("p", {}, text), el("small", {}, how));
  }
  var KEY_USE = {
    selectKey: "listening to the selection",
    snipKey: "listening to a piece of the screen",
    translateKey: "translating the selection",
    textKey: "translating a piece of the screen",
    switchKey: "switching the layout",
    fixKey: "fixing the layout"
  };
  function saveKey(name, key) {
    const s = view?.settings;
    const other = s && Object.keys(KEY_USE).find((n) => n !== name && s[n] === key);
    if (other) {
      keyTrouble = { name, text: `${hotkeyLabel(key)} is already for ${KEY_USE[other]}.` };
      return renderBody();
    }
    keyTrouble = void 0;
    save({ [name]: key });
  }
  function keyRow(name, label, note, taken = false) {
    const current = view?.settings[name] ?? "";
    const recorder = new HotkeyRecorder();
    let waiting;
    const field = el("button", {
      class: "krec",
      title: "Click, then press the keys: Ctrl+Alt+T, Left Ctrl twice, Pause, a mouse side button\u2026",
      "aria-label": `${label}: ${current ? hotkeyLabel(current) : "not set"}. Click to change.`
    });
    field.append(caps(current));
    const showing = (...nodes) => field.replaceChildren(...nodes);
    const done = (key) => {
      window.clearTimeout(waiting);
      field.blur();
      saveKey(name, key);
    };
    const recorded = (r) => {
      window.clearTimeout(waiting);
      if (!r) return;
      if (!r.more) return done(r.hotkey);
      showing(caps(r.hotkey), el("span", { class: "x2" }, "\u2026"));
      waiting = window.setTimeout(() => done(r.hotkey), DOUBLE_MS);
    };
    const listen = () => {
      if (field.classList.contains("recording")) return;
      recorder.reset();
      field.classList.add("recording");
      showing(el("span", { class: "key rec" }, "Press keys\u2026"));
    };
    field.addEventListener("focus", listen);
    field.addEventListener("click", () => (field.focus(), listen()));
    field.addEventListener("blur", () => {
      window.clearTimeout(waiting);
      field.classList.remove("recording");
      showing(caps(current));
    });
    field.addEventListener("keydown", (event) => {
      if (!field.classList.contains("recording")) return;
      event.preventDefault();
      if (event.key === "Escape") return field.blur();
      if (event.repeat) return;
      window.clearTimeout(waiting);
      recorded(recorder.keydown(event.code, event.timeStamp));
    });
    field.addEventListener("keyup", (event) => {
      if (!field.classList.contains("recording")) return;
      event.preventDefault();
      recorded(recorder.keyup(event.code, event.timeStamp));
    });
    field.addEventListener("mousedown", (event) => {
      if (document.activeElement !== field || event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      recorded(recorder.mouse(event.button));
    });
    field.addEventListener("mouseup", (event) => {
      if (event.button === 3 || event.button === 4) event.preventDefault();
    });
    const clear = current ? el(
      "button",
      {
        class: "kx",
        title: "Clear",
        "aria-label": `Clear ${label}`,
        onclick: () => {
          keyTrouble = void 0;
          save({ [name]: "" });
        }
      },
      icon("close")
    ) : null;
    const trouble = keyTrouble?.name === name ? keyTrouble.text : "";
    return row(
      label,
      [note, taken && current ? bad("Taken by another program; choose another.") : null, trouble ? bad(trouble) : null],
      el("span", { class: "kchg" }, field, clear, linkBtn(current ? "Change" : "Set", () => field.click()))
    );
  }
  var fixedKey = (label, hotkey, note) => row(label, [note], caps(hotkey));
  function listenPage(v) {
    const s = v.settings;
    const how = s.doubleCopy ? "Select this text, press Ctrl + C twice." : s.selectKey ? `Select this text, press ${said(s.selectKey)}.` : "Turn on Ctrl + C twice or set a key above, then select this text.";
    return [
      grp("Keys"),
      row(
        "Copied text",
        ["press Ctrl + C twice, quickly"],
        el("span", { class: "kchg" }, caps(COPY_TWICE), el("span", { class: "tgwrap" }, toggleKnob(s.doubleCopy, (doubleCopy) => save({ doubleCopy }), "Ctrl + C twice")))
      ),
      keyRow("selectKey", "Selected text", s.selectKey ? "Altype copies the selection itself" : "one key, if you want one", !v.keysOk.select),
      keyRow("snipKey", "A piece of the screen", "draw a box over the words", !v.keysOk.snip),
      grp("In the card"),
      row("Play or stop \xB7 step through sentences", [], el("span", { class: "kg2" }, caps("Space"), caps("\u2190"), caps("\u2192"))),
      row("A word: its meanings, its sound, a star to keep it in Words", ["click it"], null),
      row("A sentence: its translation marked", ["click it \xB7 \u25B6 in the margin reads one paragraph"], null),
      row("Close, and stop the voice", [], caps("Esc")),
      tryIt("The morning was quiet. A small boat drifted along the river, and two children watched the ducks from the bridge.", how)
    ];
  }
  function toggleKnob(on, onchange, label) {
    const node = el("button", {
      class: on ? "tg on" : "tg",
      role: "switch",
      "aria-checked": String(on),
      "aria-label": label,
      onclick: () => {
        const next = node.getAttribute("aria-checked") !== "true";
        node.setAttribute("aria-checked", String(next));
        node.classList.toggle("on", next);
        onchange(next);
      }
    });
    return node;
  }
  var TRY_TRANSLATE = {
    Russian: "\u041A\u043E\u043D\u0435\u0447\u043D\u043E, \u043F\u0440\u0438\u0448\u043B\u044E \u043E\u0431\u043D\u043E\u0432\u043B\u0451\u043D\u043D\u044B\u0435 \u043C\u0430\u043A\u0435\u0442\u044B \u0434\u043E \u0441\u043E\u0437\u0432\u043E\u043D\u0430.",
    Ukrainian: "\u0417\u0432\u0456\u0441\u043D\u043E, \u043D\u0430\u0434\u0456\u0448\u043B\u044E \u043E\u043D\u043E\u0432\u043B\u0435\u043D\u0456 \u043C\u0430\u043A\u0435\u0442\u0438 \u0434\u043E \u0434\u0437\u0432\u0456\u043D\u043A\u0430."
  };
  function translatorChip(v) {
    switch (v.translator) {
      case "ready":
        return [chip("ready"), "translator \xB7 on this computer"];
      case "absent":
        return [chip("on first use", "off"), "downloads once from Mozilla on the first translation, then works offline"];
      case "downloading":
        return [chip("downloading"), "downloading once from Mozilla"];
      case "failed":
        return [chip("failed", "bad"), "could not download; the next translation tries again"];
      case "unsupported":
        return [chip("not offered", "off"), "Firefox Translations has no offline model for this language yet"];
    }
  }
  function translatePage(v) {
    const s = v.settings;
    const [state, note] = translatorChip(v);
    const text = TRY_TRANSLATE[s.native] ?? "Of course, I will send the updated layouts before the call.";
    const how = s.translateKey ? `Select it, ${usage(s.translateKey)}.` : "Set a key above, then select it and press the key.";
    return [
      grp("Keys"),
      keyRow("translateKey", "Selected text", s.translateKey ? usage(s.translateKey) : "one key: Left Ctrl twice, for example", !v.keysOk.translate),
      keyRow("textKey", "A piece of the screen", "draw a box over the words", !v.keysOk.text),
      fixedKey("Paste the translation over the selection", "Enter"),
      grp("Languages"),
      row(pairOf(v), [note], state),
      tryIt(text, how)
    ];
  }
  function screenPage(v) {
    return [
      grp("Keys"),
      keyRow("snipKey", "Listen to a piece of the screen", "", !v.keysOk.snip),
      keyRow("textKey", "Translate a piece of the screen", "", !v.keysOk.text),
      grp("How"),
      row("Windows dims the screen; draw a box over the words", [], null),
      row("Windows OCR reads them on this computer", ["in the languages Windows can read; add one there"], linkBtn("Languages\u2026", () => post({ type: "openLanguageSettings" }))),
      row("Fix what it misread in the card, then translate", [], null)
    ];
  }
  function dictatePage() {
    return [
      grp("Keys"),
      fixedKey("Dictate", "", "types what you say"),
      fixedKey("Dictate in English", "", "say it in your language, English is typed"),
      row("Tap to start and stop, or hold while you talk", [], chip("coming", "off")),
      grp("Speech model"),
      row("Downloads once, then works offline", ["nothing to set yet: Dictate comes in a later version"], chip("~700 MB", "off"))
    ];
  }
  function layoutChips(v) {
    const cycle = cycleOf(v);
    const ids = cycle.map((l) => l.id);
    const rest = v.layouts.filter((l) => !ids.includes(l.id));
    const at = ids.indexOf(pickedLayout);
    const move2 = (to) => {
      const next = ids.filter((id) => id !== pickedLayout);
      next.splice(to, 0, pickedLayout);
      save({ layouts: next });
    };
    const pick = (id) => {
      pickedLayout = pickedLayout === id ? "" : id;
      renderBody();
    };
    const picked = cycle[at];
    return row(
      "In this order",
      [picked ? `${picked.name} \xB7 move it, or leave it out` : "tap one to move it or leave it out"],
      el(
        "span",
        { class: "chips" },
        ...cycle.map((l) => el("button", { class: l.id === pickedLayout ? "chip lit" : "chip", title: l.name, "aria-pressed": String(l.id === pickedLayout), onclick: () => pick(l.id) }, l.short)),
        ...rest.map((l) => el("button", { class: "chip off", title: `Add ${l.name}`, onclick: () => save({ layouts: [...ids, l.id] }) }, `+ ${l.short}`)),
        picked ? el(
          "span",
          { class: "chipctl" },
          el("button", { class: "ib", title: "Earlier", "aria-label": "Earlier", disabled: at === 0, onclick: () => move2(at - 1) }, icon("arrow-left")),
          el("button", { class: "ib", title: "Later", "aria-label": "Later", disabled: at === ids.length - 1, onclick: () => move2(at + 1) }, icon("arrow-right")),
          // The last one left cannot go: the keys need a layout to go to.
          linkBtn(
            "Leave out",
            () => {
              pickedLayout = "";
              save({ layouts: ids.filter((id) => id !== picked.id) });
            },
            ids.length === 1
          )
        ) : null
      )
    );
  }
  function chipList(items, remove) {
    return el(
      "div",
      { class: "chiprow" },
      ...items.map((item) => el("span", { class: "chip" }, item, el("button", { class: "ib", title: "Remove", "aria-label": `Remove ${item}`, onclick: () => remove(item) }, icon("close"))))
    );
  }
  function programsRow(v) {
    const s = v.settings;
    const add = (exe) => {
      const name = exe.trim().toLowerCase();
      addingApp = false;
      if (!name) return renderBody();
      const apps = view?.settings.fixApps ?? s.fixApps;
      save({ fixApps: [...apps, /\.exe$/.test(name) ? name : `${name}.exe`] });
    };
    const input = addingApp ? el("input", {
      type: "text",
      class: "field",
      placeholder: "program.exe",
      "aria-label": "Program to leave out",
      onkeydown: (event) => {
        const key = event.key;
        if (key === "Enter") add(event.target.value);
        if (key === "Escape") event.preventDefault(), addingApp = false, renderBody();
      }
    }) : null;
    if (input) window.setTimeout(() => input.focus(), 0);
    const suggest = v.lastApp && !s.fixApps.includes(v.lastApp) ? linkBtn(`Add ${v.lastApp}`, () => add(v.lastApp ?? "")) : null;
    return [
      row(
        "Not in these programs",
        [s.fixApps.length ? "words typed there are never fixed by themselves" : "none"],
        el(
          "span",
          { class: "kchg" },
          input,
          suggest,
          input ? null : linkBtn("Add\u2026", () => {
            addingApp = true;
            renderBody();
          })
        )
      ),
      s.fixApps.length ? chipList(s.fixApps, (exe) => save({ fixApps: s.fixApps.filter((a) => a !== exe) })) : null
    ].filter((n) => n !== null);
  }
  function othersLine(v) {
    const presses = "presses keys by itself; Altype ignores those.";
    const text = v.keyboardApps.length ? `Also using the keyboard: ${v.keyboardApps.join(", ")}.${v.foreignKeys ? ` One of them ${presses}` : ""}` : v.foreignKeys ? `A program ${presses}` : "";
    return text ? el("p", { class: "aside" }, icon("info"), text) : null;
  }
  function keyboardPage(v) {
    const s = v.settings;
    const sample = sampleOf(s.native);
    const [typed = "", fixed = ""] = [sample.typed.split(" ")[0], sample.fixed.split(" ")[0]];
    const warn = (text) => el("p", { class: "warn" }, icon("warning"), text);
    return [
      grp("Keys"),
      keyRow("switchKey", "Switch the layout", s.switchKey && usage(s.switchKey).startsWith("tap") ? "tap it alone" : "to the next of the layouts below"),
      keyRow("fixKey", "Fix what was typed wrong", "since the last click, or the selection"),
      grp("Layouts"),
      layoutChips(v),
      toggle("Fix words as I type", s.autoFix, (autoFix) => save({ autoFix }), `${typed} \u2192 ${fixed} on the space \xB7 Backspace takes it back`),
      toggle("Show the layout by the cursor", s.layoutBadge, (layoutBadge) => save({ layoutBadge })),
      ...s.autoFix ? programsRow(v) : [],
      s.keepWords.length ? row("Kept as typed", ["a fix was taken back from them"]) : null,
      s.keepWords.length ? chipList(s.keepWords, (word) => save({ keepWords: s.keepWords.filter((w) => w !== word) })) : null,
      v.rivals.length ? warn(`${v.rivals.join(" and ")} ${v.rivals.length > 1 ? "are" : "is"} running: turn off its layout switching, or words get fixed twice.`) : null,
      v.keyboardTrouble ? warn(`The keyboard helper: ${v.keyboardTrouble}`) : null,
      othersLine(v),
      el("p", { class: "privacy" }, icon("lock"), "Altype looks only at the keys of what you are typing, keeps nothing and sends nothing anywhere.")
    ].filter((n) => n !== null);
  }
  var matches = (w, q) => `${w.word} ${w.base} ${w.sentence} ${w.senses.map((s) => s[1]).join(" ")}`.toLowerCase().includes(q);
  function dateOf(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = /* @__PURE__ */ new Date();
    if (d.toDateString() === now.toDateString()) return "today";
    return d.toLocaleDateString("en-US", d.getFullYear() === now.getFullYear() ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  }
  function sentenceOf(w) {
    const at = w.word ? w.sentence.toLowerCase().indexOf(w.word.toLowerCase()) : -1;
    if (at < 0) return el("div", { class: "ws" }, w.sentence);
    return el("div", { class: "ws" }, w.sentence.slice(0, at), el("mark", {}, w.sentence.slice(at, at + w.word.length)), w.sentence.slice(at + w.word.length));
  }
  function wordRow(w) {
    const senses = w.senses.map(([, t]) => t).join("; ");
    const full = w.senses.map(([pos, t]) => pos ? `${pos}: ${t}` : t).join("\n");
    return el(
      "li",
      { class: "wi" },
      el(
        "div",
        { class: "wh" },
        el("b", {}, w.base),
        w.word.toLowerCase() !== w.base.toLowerCase() ? el("span", { class: "form" }, `from ${w.word}`) : null,
        el("span", { class: "tr", title: full }, senses)
      ),
      w.sentence ? sentenceOf(w) : null,
      el(
        "div",
        { class: "wr" },
        el("button", { class: "star", title: "Remove from Words", "aria-label": `Remove ${w.base} from Words`, onclick: () => post({ type: "removeWord", id: w.id }) }, icon("star-full")),
        el("span", { class: "d" }, dateOf(w.addedAt))
      )
    );
  }
  function wordsPage(v) {
    const list = el("ul", { class: "wl" });
    const fill = () => {
      const words = view?.words ?? v.words;
      const q = search.trim().toLowerCase();
      const shown2 = q ? words.filter((w) => matches(w, q)) : words;
      list.replaceChildren(
        ...shown2.length ? shown2.map(wordRow) : [el("li", { class: "empty" }, words.length ? "No such word." : "No words yet. Click a word in a card and tap its star.")]
      );
    };
    fill();
    const none = v.words.length === 0;
    return [
      el(
        "div",
        { class: "tools" },
        el(
          "label",
          { class: "search" },
          icon("search"),
          el("input", {
            type: "search",
            placeholder: "Search words and sentences",
            value: search,
            oninput: (event) => {
              search = event.target.value;
              fill();
            }
          })
        ),
        el("button", { class: "btn", disabled: none, onclick: () => post({ type: "exportWords" }) }, icon("export"), "Export for Anki\u2026"),
        el("button", { class: "btn", disabled: none, onclick: () => post({ type: "copyWords" }) }, icon("copy"), "Copy")
      ),
      list
    ];
  }
  function voiceOptions(v) {
    const options = [["", "Automatic"]];
    if (v.natural.status === "ready") for (const voice of NATURAL_VOICES) options.push([NATURAL_PREFIX + voice.id, naturalLabel(voice)]);
    for (const h of v.hostVoices) if (/^en\b/i.test(h.lang)) options.push([h.name, h.name]);
    return options;
  }
  function naturalRow(v) {
    const n = v.natural;
    const download = (text) => linkBtn(text, () => post({ type: "downloadNatural" }));
    switch (n.status) {
      case "absent":
        return row("Natural voice", [`Kokoro \xB7 ${n.size} MB \xB7 downloads once, then reads on this computer`], download("Download"));
      case "failed":
        return row("Natural voice", [bad("The download failed.")], download("Try again"));
      case "downloading": {
        const bar = el("i", { class: "fill" });
        bar.style.width = `${Math.round(n.progress * 100)}%`;
        return row("Natural voice", [el("span", { class: "bar" }, bar)], el("span", { class: "pct" }, `${Math.round(n.progress * 100)}%`));
      }
      default:
        return null;
    }
  }
  function updateText(u) {
    switch (u.status) {
      case "dev":
        return "a run from source does not update";
      case "checking":
        return "checking\u2026";
      case "none":
        return "this is the latest version";
      case "downloading":
        return "downloading an update\u2026";
      case "ready":
        return `version ${u.version} is ready: it installs when Altype quits`;
      case "failed":
        return `could not check: ${u.message}`;
      default:
        return "";
    }
  }
  function settingsPage(v) {
    const s = v.settings;
    const u = v.update;
    const voiceNote = naturalOn(v) ? `natural \xB7 ${v.natural.size} MB, on this computer` : "a Windows voice";
    return [
      grp("Language and voice"),
      row(
        "Your language",
        [],
        select(
          s.native,
          v.languages.map((l) => [l.name, `${l.native} \xB7 ${l.name}`]),
          (native) => save({ native })
        )
      ),
      row("Voice", [voiceNote], select(s.voice, voiceOptions(v), (voice) => save({ voice }))),
      naturalRow(v),
      row(
        "Speed",
        [],
        seg(
          s.rate,
          RATES.map((r) => [r, String(r)]),
          (rate) => save({ rate }),
          true
        )
      ),
      row(
        "Theme",
        [],
        seg(
          s.theme,
          [
            ["system", "As Windows"],
            ["light", "Light"],
            ["dark", "Dark"]
          ],
          (theme) => save({ theme })
        )
      ),
      grp("The card"),
      toggle("Read aloud when a card opens", s.autoRead, (autoRead) => save({ autoRead })),
      toggle("Dotted line under less common words", s.rareWords, (rareWords) => save({ rareWords })),
      toggle("Listen reads one sentence at a time", s.oneAtATime, (oneAtATime) => save({ oneAtATime })),
      row(
        "Word meanings on",
        [],
        select(
          s.wordHint,
          [
            ["shift", "Click, or Shift + hover"],
            ["hover", "Click, or hover"],
            ["off", "Click only"]
          ],
          (wordHint) => save({ wordHint })
        )
      ),
      grp("This computer"),
      toggle("Start with Windows", s.startWithWindows, (startWithWindows) => save({ startWithWindows })),
      row(
        `Version ${v.version}`,
        [u.status === "failed" ? bad(updateText(u)) : updateText(u)],
        linkBtn("Check for updates", () => post({ type: "checkUpdates" }), u.status === "dev" || u.status === "checking" || u.status === "downloading")
      )
    ].filter((n) => n !== null);
  }
  function aboutPage(v) {
    const update = updateText(v.update);
    const fact = (term, ...detail) => [el("dt", {}, term), el("dd", {}, ...detail)];
    return [
      el(
        "div",
        { class: "about" },
        el("div", { class: "mk" }, el("span", { class: "key bigkey" }, "alt"), el("span", { class: "bigwm" }, "altype")),
        el("p", { class: "tag" }, "Your language. ", el("span", {}, "Your shortcut.")),
        el("p", { class: "ver" }, `Version ${v.version}${update ? ` \xB7 ${update}` : ""} \xB7 free and open source, MIT`),
        el(
          "dl",
          { class: "facts" },
          ...fact("made by", "Yevhen Peshynskyi \xB7 Design automation engineer", el("br"), link("https://ikstro.com", "ikstro.com")),
          ...fact(
            "on this computer",
            "Firefox Translations by Mozilla \xB7 Kokoro-82M by hexgrad, eSpeak NG \xB7 Windows OCR \xB7 WikDict, from Wiktionary \xB7 FrequencyWords by Hermit Dave ",
            el("span", { class: "q" }, "\u2014 your text is never sent anywhere")
          ),
          ...fact("made with", "Inter and JetBrains Mono (SIL OFL) \xB7 Electron \xB7 VS Code icons"),
          ...fact("uses the network", `Updates, and each part once: the translator for your language, the natural voice (${v.natural.size} MB), word meanings`),
          ...fact(
            "links",
            link("https://github.com/ikstro/2talker/releases", "Releases and what changed"),
            " \xB7 ",
            link("https://github.com/ikstro/2talker", "Source on GitHub"),
            " \xB7 ",
            link("https://github.com/ikstro/2talker/blob/main/NOTICE", "Licenses")
          )
        )
      )
    ];
  }
  function showTab(tab) {
    if (tab === "home" || tab === "howto") closePage();
    else openPage(tab);
  }
  function start(v) {
    const asked = askedTab && askedTab !== "home" && askedTab !== "howto" ? askedTab : void 0;
    if (asked) return openPage(asked, false);
    if (FROZEN_T !== void 0) return playMoment(false, FROZEN_T);
    if (v.settings.introSeen) return;
    if (reduced.matches) return save({ introSeen: true });
    playMoment(true);
  }
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const m = event.data;
    if (m.type === "appTab") {
      if (view) showTab(m.tab);
      else askedTab = m.tab;
      return;
    }
    if (m.type !== "app") return;
    const first = view === void 0;
    view = m.view;
    updateNav();
    renderHome();
    if (open) {
      fillHeader();
      renderBody();
    }
    if (first) start(m.view);
  });
  window.addEventListener("pointerdown", () => moment && moment.raf && finishMoment(), true);
  window.addEventListener("keydown", (event) => {
    if (moment?.raf) return finishMoment();
    if (event.defaultPrevented) return;
    if (event.key === "Escape" && open) {
      event.preventDefault();
      closePage();
    }
  });
  post({ type: "appReady" });
})();
