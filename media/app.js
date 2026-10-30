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
      const side2 = /^(Left|Right)(Control|Shift|Alt|Super)$/.exec(key ?? "");
      if (side2) return `${side2[1]} ${name(side2[2])}${times === "2" ? " twice" : ""}`;
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

  // src/languages.ts
  var LANGUAGES = [
    { name: "English", native: "English", ru: "\u0430\u043D\u0433\u043B\u0438\u0439\u0441\u043A\u0438\u0439", code: "en" },
    { name: "Spanish", native: "Espa\xF1ol", ru: "\u0438\u0441\u043F\u0430\u043D\u0441\u043A\u0438\u0439", code: "es" },
    { name: "German", native: "Deutsch", ru: "\u043D\u0435\u043C\u0435\u0446\u043A\u0438\u0439", code: "de" },
    { name: "French", native: "Fran\xE7ais", ru: "\u0444\u0440\u0430\u043D\u0446\u0443\u0437\u0441\u043A\u0438\u0439", code: "fr" },
    { name: "Italian", native: "Italiano", ru: "\u0438\u0442\u0430\u043B\u044C\u044F\u043D\u0441\u043A\u0438\u0439", code: "it" },
    { name: "Portuguese", native: "Portugu\xEAs", ru: "\u043F\u043E\u0440\u0442\u0443\u0433\u0430\u043B\u044C\u0441\u043A\u0438\u0439", code: "pt" },
    { name: "Russian", native: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439", ru: "\u0440\u0443\u0441\u0441\u043A\u0438\u0439", code: "ru" },
    { name: "Ukrainian", native: "\u0423\u043A\u0440\u0430\u0457\u043D\u0441\u044C\u043A\u0430", ru: "\u0443\u043A\u0440\u0430\u0438\u043D\u0441\u043A\u0438\u0439", code: "uk" },
    { name: "Polish", native: "Polski", ru: "\u043F\u043E\u043B\u044C\u0441\u043A\u0438\u0439", code: "pl" },
    { name: "Czech", native: "\u010Ce\u0161tina", ru: "\u0447\u0435\u0448\u0441\u043A\u0438\u0439", code: "cs" },
    { name: "Dutch", native: "Nederlands", ru: "\u043D\u0438\u0434\u0435\u0440\u043B\u0430\u043D\u0434\u0441\u043A\u0438\u0439", code: "nl" },
    { name: "Swedish", native: "Svenska", ru: "\u0448\u0432\u0435\u0434\u0441\u043A\u0438\u0439", code: "sv" },
    { name: "Norwegian", native: "Norsk", ru: "\u043D\u043E\u0440\u0432\u0435\u0436\u0441\u043A\u0438\u0439", code: "nb" },
    { name: "Danish", native: "Dansk", ru: "\u0434\u0430\u0442\u0441\u043A\u0438\u0439", code: "da" },
    { name: "Finnish", native: "Suomi", ru: "\u0444\u0438\u043D\u0441\u043A\u0438\u0439", code: "fi" },
    { name: "Greek", native: "\u0395\u03BB\u03BB\u03B7\u03BD\u03B9\u03BA\u03AC", ru: "\u0433\u0440\u0435\u0447\u0435\u0441\u043A\u0438\u0439", code: "el" },
    { name: "Turkish", native: "T\xFCrk\xE7e", ru: "\u0442\u0443\u0440\u0435\u0446\u043A\u0438\u0439", code: "tr" },
    { name: "Romanian", native: "Rom\xE2n\u0103", ru: "\u0440\u0443\u043C\u044B\u043D\u0441\u043A\u0438\u0439", code: "ro" },
    { name: "Hungarian", native: "Magyar", ru: "\u0432\u0435\u043D\u0433\u0435\u0440\u0441\u043A\u0438\u0439", code: "hu" },
    { name: "Bulgarian", native: "\u0411\u044A\u043B\u0433\u0430\u0440\u0441\u043A\u0438", ru: "\u0431\u043E\u043B\u0433\u0430\u0440\u0441\u043A\u0438\u0439", code: "bg" },
    { name: "Serbian", native: "\u0421\u0440\u043F\u0441\u043A\u0438", ru: "\u0441\u0435\u0440\u0431\u0441\u043A\u0438\u0439", code: "sr" },
    { name: "Croatian", native: "Hrvatski", ru: "\u0445\u043E\u0440\u0432\u0430\u0442\u0441\u043A\u0438\u0439", code: "hr" },
    { name: "Georgian", native: "\u10E5\u10D0\u10E0\u10D7\u10E3\u10DA\u10D8", ru: "\u0433\u0440\u0443\u0437\u0438\u043D\u0441\u043A\u0438\u0439", code: "ka" },
    { name: "Armenian", native: "\u0540\u0561\u0575\u0565\u0580\u0565\u0576", ru: "\u0430\u0440\u043C\u044F\u043D\u0441\u043A\u0438\u0439", code: "hy" },
    { name: "Kazakh", native: "\u049A\u0430\u0437\u0430\u049B \u0442\u0456\u043B\u0456", ru: "\u043A\u0430\u0437\u0430\u0445\u0441\u043A\u0438\u0439", code: "kk" },
    { name: "Arabic", native: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629", ru: "\u0430\u0440\u0430\u0431\u0441\u043A\u0438\u0439", code: "ar" },
    { name: "Hebrew", native: "\u05E2\u05D1\u05E8\u05D9\u05EA", ru: "\u0438\u0432\u0440\u0438\u0442", code: "he" },
    { name: "Persian", native: "\u0641\u0627\u0631\u0633\u06CC", ru: "\u043F\u0435\u0440\u0441\u0438\u0434\u0441\u043A\u0438\u0439", code: "fa" },
    { name: "Hindi", native: "\u0939\u093F\u0928\u094D\u0926\u0940", ru: "\u0445\u0438\u043D\u0434\u0438", code: "hi" },
    { name: "Chinese", native: "\u4E2D\u6587", ru: "\u043A\u0438\u0442\u0430\u0439\u0441\u043A\u0438\u0439", code: "zh" },
    { name: "Japanese", native: "\u65E5\u672C\u8A9E", ru: "\u044F\u043F\u043E\u043D\u0441\u043A\u0438\u0439", code: "ja" },
    { name: "Korean", native: "\uD55C\uAD6D\uC5B4", ru: "\u043A\u043E\u0440\u0435\u0439\u0441\u043A\u0438\u0439", code: "ko" },
    { name: "Vietnamese", native: "Ti\u1EBFng Vi\u1EC7t", ru: "\u0432\u044C\u0435\u0442\u043D\u0430\u043C\u0441\u043A\u0438\u0439", code: "vi" },
    { name: "Thai", native: "\u0E44\u0E17\u0E22", ru: "\u0442\u0430\u0439\u0441\u043A\u0438\u0439", code: "th" },
    { name: "Indonesian", native: "Bahasa Indonesia", ru: "\u0438\u043D\u0434\u043E\u043D\u0435\u0437\u0438\u0439\u0441\u043A\u0438\u0439", code: "id" }
  ];
  function findLanguage(name) {
    if (!name) return void 0;
    const key = name.trim().toLowerCase();
    return LANGUAGES.find((l) => l.name.toLowerCase() === key || l.native.toLowerCase() === key || l.code === key);
  }
  var SCRIPT_BY_CODE = {
    ru: "Cyrillic",
    uk: "Cyrillic",
    bg: "Cyrillic",
    sr: "Cyrillic",
    kk: "Cyrillic",
    el: "Greek",
    ar: "Arabic",
    fa: "Arabic",
    he: "Hebrew",
    hi: "Devanagari",
    zh: "Han",
    ja: "Japanese",
    ko: "Hangul",
    ka: "Georgian",
    hy: "Armenian",
    th: "Thai"
  };
  function scriptFor(name) {
    const language = findLanguage(name);
    if (!language) return void 0;
    return SCRIPT_BY_CODE[language.code] ?? "Latin";
  }

  // src/hardware.ts
  function nvidiaCard(p) {
    return p?.gpus.filter((g) => g.vendor === "nvidia").sort((a, b) => b.vramMb - a.vramMb)[0];
  }
  function mainCard(p) {
    return nvidiaCard(p) ?? p?.gpus.slice().sort((a, b) => b.vramMb - a.vramMb)[0];
  }
  function shortCpu(name) {
    return name.replace(/\((R|TM|C)\)/gi, "").replace(/\s+@.*$/, "").replace(/\b(CPU|Processor)\b/gi, "").replace(/\s+with\s+.*graphics.*$/i, "").replace(/\s+\d+-Core\b/gi, "").replace(/\s+/g, " ").trim();
  }
  function cardText(g) {
    const name = g.name.replace(/\((R|TM)\)/gi, "").replace(/\s+/g, " ").trim();
    return g.vramMb >= 1024 ? `${name} \xB7 ${Math.round(g.vramMb / 1024)} GB` : name;
  }
  var LEVEL_VRAM_MB = { accurate: 3500, most: 9e3 };
  function cudaReady(g) {
    if (!g) return false;
    if (g.computeCap && g.computeCap < 5) return false;
    return !/^\d{3}\.\d+$/.test(g.driver) || Number(g.driver.split(".")[0]) >= 551;
  }
  function fitter(p) {
    const vram = p?.gpus.reduce((most, g) => Math.max(most, g.vramMb), 0) ?? 0;
    const nvidia = cudaReady(nvidiaCard(p)) && (nvidiaCard(p)?.vramMb ?? 0) === vram;
    return (need) => vram >= need ? { where: "card", slow: false, cuda: false } : vram >= need / 2 ? { where: "part", slow: true, cuda: nvidia } : { where: "processor", slow: true, cuda: false };
  }
  function translationAdvice(p) {
    const fit = fitter(p);
    const accurate = fit(LEVEL_VRAM_MB.accurate);
    const most = fit(LEVEL_VRAM_MB.most);
    return { advised: most.where === "card" ? "most" : accurate.where === "card" ? "accurate" : "fast", accurate, most };
  }

  // src/settings.ts
  var RATES = [0.75, 0.9, 1, 1.15, 1.3, 1.5];
  var LEVEL_NAMES = { fast: "Fast", accurate: "Accurate", most: "Most accurate" };
  var DEFAULTS = {
    native: "Russian",
    languages: [],
    voice: "",
    rate: 1,
    autoRead: true,
    oneAtATime: false,
    wordHint: "shift",
    rareWords: true,
    theme: "system",
    cardWidth: 440,
    cardHeight: 0,
    doubleCopy: true,
    selectKey: "",
    snipKey: "Control+Alt+S",
    translateKey: "",
    textKey: "Control+Alt+T",
    inPlaceKey: "",
    checkKey: "",
    typeKey: "",
    typeCheckKey: "",
    switchKey: "",
    switchOn: true,
    layouts: [],
    layoutKeys: {},
    autoFix: false,
    fixTwoCaps: true,
    fixCapsLock: true,
    keepCaps: false,
    fixOnPause: false,
    fixSound: false,
    learn: true,
    fixKey: "",
    fixKeyOn: true,
    apps: [],
    keepWords: [],
    layoutBadge: false,
    trayLayout: false,
    quietFullScreen: true,
    pauseKey: "",
    windowKey: "",
    dictateKey: "Control+Alt+D",
    englishKey: "",
    noteKey: "Control+Alt+N",
    againKey: "",
    practiceKey: "",
    dictationBadge: { dx: 0, dy: 0 },
    vocabulary: [],
    translationLevel: "fast",
    model: "accurate",
    speechPrefer: "accuracy",
    dictationModel: "",
    transcriptsModel: "",
    speakersDevice: "auto",
    speechTestAgreed: false,
    speechTestDeclinedKey: "",
    speechTestDeclinedAt: 0,
    startWithWindows: true,
    naturalDismissed: false,
    introSeen: false,
    paused: false,
    setupDone: true
  };
  var keptForm = (text) => text.trim().toLowerCase();
  function myLanguages(s) {
    return [...new Set([findLanguage(s.native)?.code ?? "", "en", ...s.languages].filter(Boolean))];
  }

  // src/vocabulary.ts
  function parseEntry(line) {
    const open2 = line.indexOf("(");
    if (open2 < 0) return { word: line.trim(), heard: [] };
    const close = line.indexOf(")", open2);
    const inside = line.slice(open2 + 1, close < 0 ? void 0 : close);
    const word = line.slice(0, open2).trim();
    const heard2 = [...new Set(inside.split(",").map((h) => h.trim()).filter((h) => h && h.toLowerCase() !== word.toLowerCase()))];
    return { word, heard: heard2 };
  }

  // src/worddiff.ts
  function tokens(text) {
    const list2 = [];
    let end = 0;
    for (const m of text.matchAll(/(\s*)([\p{L}\p{N}\p{M}'’]+|\S)/gu)) {
      list2.push({ pre: m[1] ?? "", word: m[2] ?? "" });
      end = (m.index ?? 0) + m[0].length;
    }
    return { list: list2, tail: text.slice(end) };
  }
  var MAX_CELLS = 4e6;
  function diffTokens(a, b) {
    let start3 = 0;
    while (start3 < a.length && start3 < b.length && a[start3].word === b[start3].word) start3++;
    let endA = a.length;
    let endB = b.length;
    while (endA > start3 && endB > start3 && a[endA - 1].word === b[endB - 1].word) {
      endA--;
      endB--;
    }
    const head = b.slice(0, start3).map((token) => ({ kind: "same", token }));
    const tail = b.slice(endB).map((token) => ({ kind: "same", token }));
    const x = a.slice(start3, endA);
    const y = b.slice(start3, endB);
    const n = x.length;
    const m = y.length;
    const middle = [];
    if (n * m > MAX_CELLS) {
      middle.push(...x.map((token) => ({ kind: "del", token })), ...y.map((token) => ({ kind: "ins", token })));
    } else {
      const w = m + 1;
      const dp = new Uint32Array((n + 1) * w);
      for (let i2 = n - 1; i2 >= 0; i2--)
        for (let j2 = m - 1; j2 >= 0; j2--)
          dp[i2 * w + j2] = x[i2].word === y[j2].word ? dp[(i2 + 1) * w + j2 + 1] + 1 : Math.max(dp[(i2 + 1) * w + j2], dp[i2 * w + j2 + 1]);
      let i = 0;
      let j = 0;
      while (i < n || j < m) {
        if (i < n && j < m && x[i].word === y[j].word) {
          middle.push({ kind: "same", token: y[j] });
          i++;
          j++;
        } else if (j >= m || i < n && dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
          middle.push({ kind: "del", token: x[i++] });
        } else {
          middle.push({ kind: "ins", token: y[j++] });
        }
      }
    }
    return [...head, ...middle, ...tail];
  }
  function diffLine(original, corrected) {
    const a = tokens(original);
    const b = tokens(corrected);
    const ops = diffTokens(a.list, b.list);
    const parts = [];
    const push = (kind, text) => {
      if (!text) return;
      const last = parts.at(-1);
      if (last?.kind === kind) last.text += text;
      else parts.push({ kind, text });
    };
    for (let k = 0; k < ops.length; ) {
      const op = ops[k];
      if (op.kind === "same") {
        push("same", op.token.pre + op.token.word);
        k++;
        continue;
      }
      const struck = [];
      const added = [];
      for (; k < ops.length && ops[k].kind !== "same"; k++) (ops[k].kind === "del" ? struck : added).push(ops[k].token);
      const join = (list2) => list2.map((t, i) => (i ? t.pre : "") + t.word).join("");
      push("same", (added[0] ?? struck[0]).pre);
      push("del", join(struck));
      push("ins", join(added));
    }
    push("same", b.tail);
    return parts;
  }
  function wordDiff(original, corrected) {
    const a = original.split("\n");
    const b = corrected.split("\n");
    if (a.length !== b.length) return diffLine(original, corrected);
    const parts = [];
    a.forEach((line, i) => {
      for (const part of [...i ? [{ kind: "same", text: "\n" }] : [], ...diffLine(line, b[i])]) {
        const last = parts.at(-1);
        if (last?.kind === part.kind && part.kind === "same") last.text += part.text;
        else parts.push({ ...part });
      }
    });
    return parts;
  }
  function changesOf(parts) {
    const out = [];
    for (let k = 0; k < parts.length; k++) {
      const part = parts[k];
      if (part.kind === "del") {
        const next = parts[k + 1];
        if (next?.kind === "ins") k++;
        out.push({ wrong: part.text, right: next?.kind === "ins" ? next.text : "" });
      } else if (part.kind === "ins") out.push({ wrong: "", right: part.text });
    }
    return out;
  }

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
  function html(markup) {
    const template = document.createElement("template");
    template.innerHTML = markup;
    return template.content;
  }

  // src/webview/brand.ts
  function logo() {
    return el(
      "span",
      { class: "logo", "aria-label": "Krya" },
      el("span", {}, "Krya"),
      el("span", { class: "duck", "aria-hidden": "true" }, "(", el("span", { class: "eye" }, "'"), ")>")
    );
  }
  function tile(px) {
    const svg = html(
      `<svg class="tile" width="${px}" height="${px}" viewBox="0 0 256 256" aria-hidden="true"><rect x="16" y="16" width="224" height="224" rx="52" fill="#141414"/><g transform="translate(-4 -2)" fill="none" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"><path stroke="#FFFFFF" d="M118 58C92 58 84 68 84 88V96C84 108 78 114 62 114C78 114 84 120 84 132V174C84 194 92 202 118 202"/><path stroke="#FFD60A" d="M166 86L202 114L166 142"/></g><circle cx="132" cy="96" r="13" fill="#FFFFFF"/></svg>`
    ).firstElementChild;
    return svg;
  }

  // src/webview/glyphs.ts
  var GLYPHS = {
    play: '<path class="f" d="M5 3.2v9.6c0 .5.5.8.9.5l7-4.8a.6.6 0 0 0 0-1L5.9 2.7c-.4-.3-.9 0-.9.5z"/>',
    stop: '<rect class="f" x="3.5" y="3.5" width="9" height="9" rx="1.8"/>',
    prev: '<path d="M3.5 3.5v9"/><path class="f" d="M12.5 3.6v8.8c0 .4-.5.7-.8.4L6 8.4a.5.5 0 0 1 0-.8l5.7-4.4c.3-.3.8 0 .8.4z"/>',
    next: '<path d="M12.5 3.5v9"/><path class="f" d="M3.5 3.6v8.8c0 .4.5.7.8.4L10 8.4a.5.5 0 0 0 0-.8L4.3 3.2c-.3-.3-.8 0-.8.4z"/>',
    pin: '<path d="M6 2.5h4M7 2.5v3.8L4.5 9h7L9 6.3V2.5M8 9v4.5"/>',
    close: '<path d="M4 4l8 8M12 4l-8 8"/>',
    minimize: '<path d="M4 8h8"/>',
    maximize: '<rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/>',
    restore: '<rect x="3.5" y="5.5" width="7" height="7" rx="1.5"/><path d="M6 3.5h5a1.5 1.5 0 0 1 1.5 1.5v5"/>'
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

  // src/webview/lucide.ts
  var LUCIDE = {
    "volume-2": '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" /> <path d="M16 9a5 5 0 0 1 0 6" /> <path d="M19.364 18.364a9 9 0 0 0 0-12.728" />',
    "languages": '<path d="m5 8 6 6" /> <path d="m4 14 6-6 2-3" /> <path d="M2 5h12" /> <path d="M7 2h1" /> <path d="m22 22-5-10-5 10" /> <path d="M14 18h6" />',
    "graduation-cap": '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" /> <path d="M22 10v6" /> <path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" />',
    "scan": '<path d="M3 7V5a2 2 0 0 1 2-2h2" /> <path d="M17 3h2a2 2 0 0 1 2 2v2" /> <path d="M21 17v2a2 2 0 0 1-2 2h-2" /> <path d="M7 21H5a2 2 0 0 1-2-2v-2" />',
    "mic": '<path d="M12 19v3" /> <path d="M19 10v2a7 7 0 0 1-14 0v-2" /> <rect x="9" y="2" width="6" height="13" rx="3" />',
    "audio-lines": '<path d="M2 10v3" /> <path d="M6 6v11" /> <path d="M10 3v18" /> <path d="M14 8v7" /> <path d="M18 5v13" /> <path d="M22 10v3" />',
    "keyboard": '<path d="M10 8h.01" /> <path d="M12 12h.01" /> <path d="M14 8h.01" /> <path d="M16 12h.01" /> <path d="M18 8h.01" /> <path d="M6 8h.01" /> <path d="M7 16h10" /> <path d="M8 12h.01" /> <rect width="20" height="16" x="2" y="4" rx="2" />',
    "file-text": '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /> <path d="M14 2v5a1 1 0 0 0 1 1h5" /> <path d="M10 9H8" /> <path d="M16 13H8" /> <path d="M16 17H8" />',
    "notebook-pen": '<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4" /> <path d="M2 6h4" /> <path d="M2 10h4" /> <path d="M2 14h4" /> <path d="M2 18h4" /> <path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />',
    "book-open": '<path d="M12 5v16" /> <path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z" />',
    "list-checks": '<path d="M13 5h8" /> <path d="M13 12h8" /> <path d="M13 19h8" /> <path d="m3 17 2 2 4-4" /> <path d="m3 7 2 2 4-4" />',
    "house": '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /> <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />',
    "info": '<circle cx="12" cy="12" r="10" /> <path d="M12 16v-4" /> <path d="M12 8h.01" />',
    "settings": '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /> <circle cx="12" cy="12" r="3" />',
    "list-ordered": '<path d="M11 5h10" /> <path d="M11 12h10" /> <path d="M11 19h10" /> <path d="M4 4h1v5" /> <path d="M4 9h2" /> <path d="M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02" />',
    "message-square-text": '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" /> <path d="M7 11h10" /> <path d="M7 15h6" /> <path d="M7 7h8" />',
    "arrow-left": '<path d="m12 19-7-7 7-7" /> <path d="M19 12H5" />',
    "file-audio": '<path d="M4 6.835V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-.343" /> <path d="M14 2v5a1 1 0 0 0 1 1h5" /> <path d="M2 19a2 2 0 0 1 4 0v1a2 2 0 0 1-4 0v-4a6 6 0 0 1 12 0v4a2 2 0 0 1-4 0v-1a2 2 0 0 1 4 0" />',
    "users": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /> <path d="M16 3.128a4 4 0 0 1 0 7.744" /> <path d="M22 21v-2a4 4 0 0 0-3-3.87" /> <circle cx="9" cy="7" r="4" />',
    "spell-check": '<path d="m20 15-5.5 5.5L12 18" /> <path d="m4 16 6-12 5.115 10.23" /> <path d="M6 12h8" />',
    "video": '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" /> <rect x="2" y="6" width="14" height="12" rx="2" />',
    "cpu": '<path d="M12 20v2" /> <path d="M12 2v2" /> <path d="M17 20v2" /> <path d="M17 2v2" /> <path d="M2 12h2" /> <path d="M2 17h2" /> <path d="M2 7h2" /> <path d="M20 12h2" /> <path d="M20 17h2" /> <path d="M20 7h2" /> <path d="M7 20v2" /> <path d="M7 2v2" /> <rect x="4" y="4" width="16" height="16" rx="2" /> <rect x="8" y="8" width="8" height="8" rx="1" />',
    "folder": '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />',
    "copy": '<rect width="14" height="14" x="8" y="8" rx="2" ry="2" /> <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />',
    "external-link": '<path d="M15 3h6v6" /> <path d="M10 14 21 3" /> <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />',
    "rotate-cw": '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /> <path d="M21 3v5h-5" />',
    "rotate-ccw": '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /> <path d="M3 3v5h5" />',
    "database": '<ellipse cx="12" cy="5" rx="9" ry="3" /> <path d="M3 5V19A9 3 0 0 0 21 19V5" /> <path d="M3 12A9 3 0 0 0 21 12" />',
    "play": '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />',
    "pause": '<rect x="14" y="3" width="5" height="18" rx="1" /> <rect x="5" y="3" width="5" height="18" rx="1" />',
    "power": '<path d="M12 2v10" /> <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />',
    "list": '<path d="M3 5h.01" /> <path d="M3 12h.01" /> <path d="M3 19h.01" /> <path d="M8 5h13" /> <path d="M8 12h13" /> <path d="M8 19h13" />',
    "monitor": '<rect width="20" height="14" x="2" y="3" rx="2" /> <line x1="8" x2="16" y1="21" y2="21" /> <line x1="12" x2="12" y1="17" y2="21" />',
    "clock": '<circle cx="12" cy="12" r="10" /> <path d="M12 6v6l4 2" />',
    "lock": '<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /> <path d="M7 11V7a5 5 0 0 1 10 0v4" />',
    "download": '<path d="M12 15V3" /> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /> <path d="m7 10 5 5 5-5" />',
    "globe": '<circle cx="12" cy="12" r="10" /> <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /> <path d="M2 12h20" />',
    "type": '<path d="M12 4v16" /> <path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" /> <path d="M9 20h6" />',
    "message-square": '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />',
    "star": '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />',
    "search": '<path d="m21 21-4.34-4.34" /> <circle cx="11" cy="11" r="8" />',
    "trash-2": '<path d="M10 11v6" /> <path d="M14 11v6" /> <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /> <path d="M3 6h18" /> <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />',
    "circle-alert": '<circle cx="12" cy="12" r="10" /> <line x1="12" x2="12" y1="8" y2="12" /> <line x1="12" x2="12.01" y1="16" y2="16" />',
    "circle-check": '<circle cx="12" cy="12" r="10" /> <path d="m16 9-5.5 5.5L8 12" />',
    "check": '<path d="M20 6 9 17l-5-5" />',
    "link": '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /> <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />',
    "memory-stick": '<path d="M12 12v-2" /> <path d="M12 18v-2" /> <path d="M16 12v-2" /> <path d="M16 18v-2" /> <path d="M2 11h1.5" /> <path d="M20 18v-2" /> <path d="M20.5 11H22" /> <path d="M4 18v-2" /> <path d="M8 12v-2" /> <path d="M8 18v-2" /> <rect x="2" y="6" width="20" height="10" rx="2" />',
    "hard-drive": '<path d="M10 16h.01" /> <path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /> <path d="M21.946 12.013H2.054" /> <path d="M6 16h.01" />',
    "laptop": '<path d="M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z" /> <path d="M20.054 15.987H3.946" />',
    "sparkles": '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" /> <path d="M20 2v4" /> <path d="M22 4h-4" /> <circle cx="4" cy="20" r="2" />',
    "wand-sparkles": '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" /> <path d="m14 7 3 3" /> <path d="M5 6v4" /> <path d="M19 14v4" /> <path d="M10 2v2" /> <path d="M7 8H3" /> <path d="M21 16h-4" /> <path d="M11 3H9" />',
    "thumbs-up": '<path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" /> <path d="M7 10v12" />',
    "loader": '<path d="M12 2v4" /> <path d="m16.2 7.8 2.9-2.9" /> <path d="M18 12h4" /> <path d="m16.2 16.2 2.9 2.9" /> <path d="M12 18v4" /> <path d="m4.9 19.1 2.9-2.9" /> <path d="M2 12h4" /> <path d="m4.9 4.9 2.9 2.9" />',
    "pencil-line": '<path d="M13 21h8" /> <path d="m15 5 4 4" /> <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />',
    "monitor-speaker": '<path d="M5.5 20H8" /> <path d="M17 9h.01" /> <rect width="10" height="16" x="12" y="4" rx="2" /> <path d="M8 6H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h4" /> <circle cx="17" cy="15" r="1" />',
    "scan-text": '<path d="M3 7V5a2 2 0 0 1 2-2h2" /> <path d="M17 3h2a2 2 0 0 1 2 2v2" /> <path d="M21 17v2a2 2 0 0 1-2 2h-2" /> <path d="M7 21H5a2 2 0 0 1-2-2v-2" /> <path d="M7 8h8" /> <path d="M7 12h10" /> <path d="M7 16h6" />',
    "text-cursor": '<path d="M17 22h-1a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4h1" /> <path d="M7 22h1a4 4 0 0 0 4-4" /> <path d="M7 2h1a4 4 0 0 1 4 4" />',
    "panel-bottom": '<rect width="18" height="18" x="3" y="3" rx="2" /> <path d="M3 15h18" />',
    "plus": '<path d="M5 12h14" /> <path d="M12 5v14" />',
    "x": '<path d="M18 6 6 18" /> <path d="m6 6 12 12" />',
    "minus": '<path d="M5 12h14" />',
    "square": '<rect width="18" height="18" x="3" y="3" rx="2" />',
    "chevron-right": '<path d="m9 18 6-6-6-6" />',
    "chevron-left": '<path d="m15 18-6-6 6-6" />',
    "chevron-down": '<path d="m6 9 6 6 6-6" />',
    "arrow-up": '<path d="m5 12 7-7 7 7" /> <path d="M12 19V5" />',
    "arrow-down": '<path d="M12 5v14" /> <path d="m19 12-7 7-7-7" />'
  };
  function lucide(name, cls = "") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", cls ? `lu ${cls}` : "lu");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = LUCIDE[name];
    return svg;
  }

  // src/webview/ui.ts
  var post = (message) => window.tutorHost.post(message);
  var grp = (text, n, right) => el("div", { class: "grp" }, text, n !== void 0 && n !== "" ? el("span", { class: "n" }, String(n)) : null, right ?? null);
  var bad = (text) => el("small", { class: "bad" }, text);
  var notesOf = (notes) => notes.filter((n) => !!n).map((n) => typeof n === "string" ? el("small", {}, n) : n);
  function row(label, notes, ...controls) {
    return el("div", { class: "row" }, el("div", { class: "l" }, label, ...notesOf(notes)), ...controls);
  }
  function card(name, label, notes, ...controls) {
    const node = row(label, notes, ...controls);
    node.prepend(lucide(name));
    return node;
  }
  function navCard(name, title, note, value, onOpen, id = "", ok = false) {
    return el(
      "button",
      { class: "row navc", "data-sub": id || void 0, onclick: onOpen },
      name ? lucide(name) : null,
      el("div", { class: "l" }, title, ...notesOf(Array.isArray(note) ? note : [note])),
      value ? el("span", { class: ok ? "v ok" : "v" }, ok ? lucide("check", "s") : null, value) : null,
      lucide("chevron-right", "chev")
    );
  }
  function ib(name, label, onclick, disabled = false) {
    return el("button", { class: "ib", title: label, "aria-label": label, disabled, onclick }, lucide(name));
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
      el("span", { class: "l" }, label, ...notesOf(notes)),
      knob
    );
    return node;
  }
  function toggleCard(name, label, on, onchange, ...notes) {
    const node = toggle(label, on, onchange, ...notes);
    node.prepend(lucide(name));
    return node;
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
    return el("span", { class: "sel" }, node, lucide("chevron-down", "s"));
  }
  var linkBtn = (text, onclick, disabled = false) => el("button", { class: "link", disabled, onclick }, text);
  var chip = (text, cls = "") => el("span", { class: `chip${cls ? " " + cls : ""}` }, text);
  function btn(label, onclick, cls = "", title) {
    return el("button", { class: `btn${cls ? " " + cls : ""}`, onclick, title, "aria-label": title }, ...typeof label === "string" ? [label] : label);
  }
  function link(url, text) {
    return el("a", { href: url, onclick: (event) => (event.preventDefault(), post({ type: "openLink", url })) }, text);
  }
  function bar(progress) {
    const fill = el("i", { class: "fill" });
    fill.style.width = `${Math.round(progress * 100)}%`;
    return el("span", { class: "bar" }, fill);
  }
  var aside = (name, ...text) => el("p", { class: "aside" }, lucide(name, "s"), el("span", {}, ...text));
  var warn = (...text) => el("p", { class: "warn" }, lucide("circle-alert", "s"), el("span", {}, ...text));
  function liveField(id, placeholder, label, onkey) {
    const field = el("input", {
      type: "text",
      class: "field",
      placeholder,
      autocomplete: "off",
      spellcheck: "false",
      "aria-label": label,
      "data-live": id
    });
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        onkey(event.key, field);
      }
    });
    return field;
  }
  function listPage(o) {
    const norm = o.normalize ?? ((t) => t.trim());
    const add = (field2) => {
      const item = norm(field2.value);
      if (!item) return field2.focus();
      field2.value = "";
      field2.focus();
      if (o.items.some((x) => x.toLowerCase() === item.toLowerCase())) return;
      o.add(item);
    };
    const field = liveField("add", o.placeholder, o.label, (key, f) => key === "Enter" ? add(f) : (f.value = "", f.blur()));
    const addCard = el(
      "div",
      { class: "row add" },
      el("div", { class: "fields" }, field, btn([lucide("plus", "s"), "Add"], () => add(field), "primary")),
      o.note ? el("small", {}, o.note) : null
    );
    const items = o.items.map((item) => {
      const note = o.itemNote?.(item);
      return el("div", { class: "row" }, el("div", { class: "l" }, item, note ? el("small", {}, note) : null), ib("x", `Remove ${item}`, () => o.remove(item)));
    });
    return [
      grp(o.label),
      addCard,
      o.extra ?? null,
      grp(o.count, o.items.length || void 0),
      ...items.length ? items : [aside("info", o.empty)]
    ].filter((n) => n !== null);
  }

  // engine/models.json
  var models_default = {
    about: "The speech models Krya can use, read by the engine (asr.py) and by Krya (src/speechplan.ts). rank: how accurate, higher is better. phrase: seconds to recognize a 7 s phrase as Dictate does; rtf: seconds per second of a long recording as Transcribe does (words with their times). Both are first guesses, measured on an i9-9900K (cpu, int8) and an RTX 2080 SUPER (cuda, float16) on 2026-10-28, until this computer is tested. Whisper pads every phrase to a 30 s window, so a phrase costs one window whatever its length; turbo's decoder is light, so on long recordings it is nearly as quick as small. ramMb: memory on the processor; vramMb: on the card, per compute type. Parakeet (NVIDIA's TDT 0.6B v3 through onnx-asr, int8, on the processor) costs what the sound lasts, not a window: a 7 s phrase in 0.3 s on the i9, Russian as good as turbo on the card in a test on a LibriVox reading; it dictates in its 25 languages. devices and features: where and for what a model is used.",
    speakers: {
      cpu: {
        rtf: 0.8
      },
      cuda: {
        rtf: 0.03
      }
    },
    models: [
      {
        name: "tiny",
        label: "Whisper tiny",
        about: "fastest, rough",
        backend: "whisper",
        repo: "Systran/faster-whisper-tiny",
        bytes: 77e6,
        rank: 1,
        languages: "all",
        cpu: {
          phrase: 0.25,
          rtf: 0.05
        },
        cuda: {
          phrase: 0.1,
          rtf: 0.02
        },
        ramMb: 300,
        vramMb: {
          float16: 400,
          int8_float16: 300
        },
        devices: [
          "cpu",
          "cuda"
        ],
        features: [
          "dictation",
          "transcripts"
        ]
      },
      {
        name: "base",
        label: "Whisper base",
        about: "fast, fair",
        backend: "whisper",
        repo: "Systran/faster-whisper-base",
        bytes: 147e6,
        rank: 2,
        languages: "all",
        cpu: {
          phrase: 0.45,
          rtf: 0.09
        },
        cuda: {
          phrase: 0.12,
          rtf: 0.03
        },
        ramMb: 450,
        vramMb: {
          float16: 500,
          int8_float16: 400
        },
        devices: [
          "cpu",
          "cuda"
        ],
        features: [
          "dictation",
          "transcripts"
        ]
      },
      {
        name: "small",
        label: "Whisper small",
        about: "good",
        backend: "whisper",
        repo: "Systran/faster-whisper-small",
        bytes: 486e6,
        rank: 3,
        languages: "all",
        cpu: {
          phrase: 1.4,
          rtf: 0.2
        },
        cuda: {
          phrase: 0.22,
          rtf: 0.055
        },
        ramMb: 900,
        vramMb: {
          float16: 1e3,
          int8_float16: 700
        },
        devices: [
          "cpu",
          "cuda"
        ],
        features: [
          "dictation",
          "transcripts"
        ]
      },
      {
        name: "large-v3-turbo",
        label: "Whisper turbo",
        about: "very good",
        backend: "whisper",
        repo: "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
        bytes: 162e7,
        rank: 5,
        languages: "all",
        cpu: {
          phrase: 4.5,
          rtf: 0.25
        },
        cuda: {
          phrase: 0.26,
          rtf: 0.025
        },
        ramMb: 2e3,
        vramMb: {
          float16: 2600,
          int8_float16: 1600
        },
        devices: [
          "cpu",
          "cuda"
        ],
        features: [
          "dictation",
          "transcripts"
        ]
      },
      {
        name: "large-v3",
        label: "Whisper large",
        about: "the most accurate, slow",
        backend: "whisper",
        repo: "Systran/faster-whisper-large-v3",
        bytes: 309e7,
        rank: 6,
        languages: "all",
        cpu: {
          phrase: 9,
          rtf: 0.8
        },
        cuda: {
          phrase: 0.5,
          rtf: 0.06
        },
        ramMb: 3600,
        vramMb: {
          float16: 4600,
          int8_float16: 2700
        },
        devices: [
          "cpu",
          "cuda"
        ],
        features: [
          "dictation",
          "transcripts"
        ]
      },
      {
        name: "parakeet-tdt-0.6b-v3",
        label: "Parakeet",
        about: "very good and quick \xB7 25 European languages",
        backend: "parakeet",
        repo: "istupakov/parakeet-tdt-0.6b-v3-onnx",
        onnx: "nemo-parakeet-tdt-0.6b-v3",
        bytes: 6705e5,
        rank: 5,
        languages: [
          "bg",
          "hr",
          "cs",
          "da",
          "nl",
          "en",
          "et",
          "fi",
          "fr",
          "de",
          "el",
          "hu",
          "it",
          "lv",
          "lt",
          "mt",
          "pl",
          "pt",
          "ro",
          "sk",
          "sl",
          "es",
          "sv",
          "ru",
          "uk"
        ],
        devices: [
          "cpu"
        ],
        features: [
          "dictation"
        ],
        cpu: {
          phrase: 0.3,
          rtf: 0.035
        },
        cuda: {
          phrase: 0.3,
          rtf: 0.035
        },
        ramMb: 1200,
        vramMb: {
          float16: 0,
          int8_float16: 0
        }
      }
    ]
  };

  // src/speechplan.ts
  var MODELS = models_default.models;
  var SPEAKERS = models_default.speakers;
  function seconds(s) {
    return s < 10 ? `${(Math.round(s * 10) / 10).toFixed(1)} s` : `${Math.round(s)} s`;
  }
  function minutes(m) {
    const r = Math.max(1, Math.round(m));
    return r >= 60 ? `${Math.floor(r / 60)} h${r % 60 ? ` ${r % 60} min` : ""}` : `${r} min`;
  }
  function estimateText(feature, c) {
    return feature === "dictation" ? `\u2248${seconds(c.estimate)} a phrase` : `\u2248${minutes(c.estimate)} an hour`;
  }
  var BASIS_TEXT = { measured: "measured here", scaled: "from this computer\u2019s test", guess: "first guess" };

  // src/setup.ts
  var VOICE_CORES = 4;
  var DICTIONARY_MB = 5;
  function recommend(v) {
    const s = v.speech;
    const d = s.device;
    const plan = s.plan;
    const cyrillic = scriptFor(v.settings.native) === "Cyrillic";
    const weak = d.cpu.cores < VOICE_CORES;
    const chosen = plan.transcripts.chosen;
    const hourCpu = minutes(chosen.estimate);
    const rough = chosen.model === "tiny" || chosen.model === "base";
    return {
      voice: weak ? { on: false, why: "a Windows voice is instant; the natural one would pause between sentences on this processor" } : { on: true, why: "reads like a person; this computer makes its speech faster than it plays" },
      autoFix: cyrillic ? { on: true, why: `${v.settings.native} and English share the keyboard: a word typed in the wrong layout is typed again right` } : { on: false, why: "your language shares the Latin layout; turn it on if you also type in another" },
      gpu: plan.offers.gpu ? { on: true, why: `speech on the graphics card: a phrase in \u2248${seconds(s.firstModel.cuda.phrase)}, not \u2248${seconds(s.firstModel.cpu.phrase)}` } : { on: false, why: d.at ? "no NVIDIA card that can take it; speech runs on the processor" : "looking at the graphics card\u2026" },
      dictate: { on: true, why: `${s.firstModel.cpu.model} writes a phrase in \u2248${seconds(s.firstModel.cpu.phrase)} on this processor` },
      transcribe: chosen.fits && !rough ? { on: true, why: `${chosen.label}: an hour of a meeting in \u2248${hourCpu} on this computer${plan.offers.gpu ? ", quicker on the graphics card" : ""}` } : { on: false, why: `possible, but ${rough ? "rough" : "slow"} here: ${chosen.label} writes an hour in \u2248${hourCpu}` },
      speakers: plan.offers.speakersGpu && plan.speakers.cuda !== void 0 ? { on: true, why: `the voices told apart on the graphics card: an hour in \u2248${minutes(plan.speakers.cuda)}` } : { on: false, why: `possible, but slow here: on the processor an hour\u2019s voices take \u2248${minutes(plan.speakers.cpu)}` },
      startWithWindows: { on: true, why: "the keys work from the first minute" }
    };
  }
  function recommendedChoice(v) {
    const r = recommend(v);
    return {
      voice: r.voice.on ? "natural" : "windows",
      autoFix: r.autoFix.on,
      layoutBadge: false,
      gpu: r.gpu.on,
      dictate: r.dictate.on,
      transcribe: r.transcribe.on,
      speakers: r.speakers.on && r.transcribe.on,
      speakersOn: v.speech.plan.speakers.advised,
      startWithWindows: true,
      test: true
    };
  }
  var speechNeeded = (c) => c.dictate || c.transcribe;
  function speakersWhere(c, v) {
    return c.speakersOn === "cuda" && c.gpu && v.speech.pack.nvidia && v.speech.plan.offers.speakersGpu ? "cuda" : "cpu";
  }
  function cost(c, v) {
    const s = v.speech;
    const items = [];
    let disk = 0;
    const t = v.translatorState;
    if (t.status !== "unsupported") {
      const mb = t.status === "ready" ? 0 : t.size;
      items.push({ key: "translator", label: `The translator for ${v.settings.native} \u21C4 English`, note: mb ? "Firefox Translations, once \xB7 then offline" : "here already", mb });
      disk += mb;
    }
    const dict = v.dictionary.status;
    if (dict !== "none") {
      const mb = dict === "ready" ? 0 : DICTIONARY_MB;
      items.push({ key: "dictionary", label: "The word dictionary", note: mb ? "meanings of English words, once" : "here already", mb });
      disk += mb;
    }
    if (c.voice === "natural") {
      const here = v.natural.status === "ready";
      items.push({ key: "voice", label: "The natural voice", note: here ? "here already" : "Kokoro \xB7 reads on this computer", mb: here ? 0 : v.natural.size });
      if (!here) disk += v.natural.size;
    }
    const parts = [];
    const models = [];
    if (speechNeeded(c)) {
      const have = new Set(s.pack.parts);
      const wanted = ["core", ...c.gpu && s.pack.nvidia ? ["gpu"] : [], ...c.transcribe && c.speakers ? ["speakers"] : []];
      for (const part of wanted) if (!have.has(part)) parts.push(part);
      const where2 = speakersWhere(c, v);
      const cardInside = where2 === "cuda" && wanted.includes("speakers");
      const size2 = (p, kind) => p === "speakers" ? s.speakers.sizes[where2][kind] : p === "gpu" && cardInside ? 0 : s[kind][p];
      const mb = parts.reduce((n, p) => n + size2(p, "download"), 0);
      const onDisk = parts.reduce((n, p) => n + size2(p, "installed"), 0);
      const names = { core: "speech to text", gpu: "the graphics card\u2019s part", speakers: "the speakers\u2019 part" };
      items.push({ key: "engine", label: "The speech engine", note: parts.length ? `${parts.map((p) => names[p]).join(", ")} \xB7 ${Math.round(onDisk)} MB on the disk` : "here already", mb });
      disk += onDisk;
      const downloaded = new Set(s.health?.downloaded ?? s.plan.dictation.choices.filter((x) => x.downloaded).map((x) => x.model));
      const want = [...c.dictate ? [s.plan.dictation.chosen] : [], ...c.transcribe ? [s.plan.transcripts.chosen] : []];
      for (const m of want) {
        if (models.includes(m.model)) continue;
        models.push(m.model);
        const here = downloaded.has(m.model) || m.downloaded;
        items.push({ key: `model:${m.model}`, label: m.label, note: here ? "here already" : m.about, mb: here ? 0 : m.mb });
        if (!here) disk += m.mb;
      }
    }
    const download = items.reduce((n, i) => n + i.mb, 0);
    const free = s.disk.freeMb;
    return { items, download, disk, parts, models: models.filter((m) => !(s.health?.downloaded ?? []).includes(m)), fits: free <= 0 || free >= disk * 1.1 };
  }
  function sizeText(mb) {
    return mb >= 1e3 ? `${(Math.round(mb / 100) / 10).toFixed(1)} GB` : `${Math.max(1, Math.round(mb))} MB`;
  }

  // src/webview/speech.ts
  var SpeechError = class extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  };
  async function api(method, route, body) {
    const r = await window.tutorHost.call({ call: "speech", method, route, body });
    if (!r.ok) throw new SpeechError(r.error, r.status);
    return r.data;
  }
  var problem = (error) => error instanceof Error ? error.message : String(error);
  var fileName = (path) => path.split(/[\\/]/).pop() ?? path;
  var redraw = () => {
  };
  function onRedraw(fn) {
    redraw = fn;
  }
  var redrawPage = () => redraw();
  function clock(seconds2) {
    const s = Math.max(0, Math.floor(seconds2));
    const h = Math.floor(s / 3600);
    const m = Math.floor(s % 3600 / 60);
    const ss = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  }
  function minutesPerHour(v) {
    return Math.max(1, Math.round(v.speech.plan.transcripts.chosen.estimate));
  }
  function length(seconds2) {
    if (seconds2 < 60) return `${Math.round(seconds2)} s`;
    const minutes2 = Math.round(seconds2 / 60);
    return minutes2 >= 60 ? `${Math.floor(minutes2 / 60)} h ${minutes2 % 60} min` : `${minutes2} min`;
  }
  var toasts = el("div", { class: "toasts", role: "status" });
  document.body.append(toasts);
  function toast(text, action, fault2 = false) {
    const node = el(
      "div",
      { class: fault2 ? "toast bad" : "toast" },
      el("span", {}, text),
      action ? el("button", { class: "link", onclick: () => (action.run(), node.remove()) }, action.label) : null
    );
    toasts.append(node);
    window.setTimeout(() => node.remove(), action ? 7e3 : 3500);
  }
  var fault = (error) => toast(problem(error), void 0, true);
  var showFile = (path) => ({ label: "Show", run: () => post({ type: "showInFolder", path }) });
  var engine;
  var asking = false;
  function engineSettings(v) {
    if (v.speech.service !== "ready") return void 0;
    if (!engine && !asking) {
      asking = true;
      api("GET", "/settings").then(
        (s) => {
          engine = s;
          asking = false;
          redraw();
        },
        () => asking = false
      );
    }
    return engine;
  }
  function forgetEngine() {
    engine = void 0;
  }
  async function saveEngine(changes) {
    try {
      engine = await api("PUT", "/settings", changes);
      redraw();
      return true;
    } catch (error) {
      fault(error);
      return false;
    }
  }
  async function pickKb() {
    const folder = await window.tutorHost.call({ call: "pickFolder", title: "The knowledge base folder", current: engine?.kbDir ?? "" });
    if (folder && await saveEngine({ kbDir: folder })) toast(`Knowledge base: ${folder}`);
  }
  var installed = (v) => v.speech.pack.parts.includes("core");
  var hasPart = (v, part) => v.speech.pack.parts.includes(part);
  var running = (v) => installed(v) && v.speech.service === "ready";
  var withGpu = true;
  function packWork(v) {
    const p = v.speech.pack;
    if (p.status === "removing") return row("Removing the speech engine\u2026", [], null);
    if (p.status !== "installing") return void 0;
    const what = p.step === "tool" ? "the Python manager" : "the packages";
    const pct = Math.round((p.progress ?? 0) * 100);
    const parts = (p.installing ?? []).filter((x) => !p.parts.includes(x));
    const name = parts.includes("speakers") && p.parts.includes("core") ? "Downloading the speakers part" : "Downloading the speech engine";
    return row(name, [`${what}; you can close this window, the download goes on`, bar(p.progress ?? 0)], el("span", { class: "pct" }, `${pct}%`));
  }
  function engineRows(v, feature) {
    const s = v.speech;
    const work = packWork(v);
    if (work && !installed(v)) return [work];
    if (!installed(v)) {
      const gpu = s.pack.nvidia && withGpu;
      const mb = s.download.core + (gpu ? s.download.gpu : 0);
      const first = gpu ? s.firstModel.cuda : s.firstModel.cpu;
      const keeps = s.installed.core + (gpu ? s.installed.gpu : 0) + first.mb;
      const needs = Math.round((keeps + mb) * 1.1);
      const short = s.disk.freeMb > 0 && s.disk.freeMb < needs;
      const go2 = () => post({ type: "installSpeech", parts: gpu ? ["core", "gpu"] : ["core"] });
      const failed = s.pack.status === "failed";
      const card2 = nvidiaCard(s.device);
      const download = btn(failed ? "Try again" : "Download", go2, "primary");
      download.disabled = short;
      return [
        row(
          `${feature} needs the speech engine`,
          [
            failed ? bad(`The download stopped: ${s.pack.message ?? "unknown error"}`) : `${size(mb)} to download, then it works offline; ${size(keeps)} on the disk (with the ${first.model} model)`,
            short ? bad(`Needs ${size(needs)} free; ${s.disk.drive} has ${size(s.disk.freeMb)}`) : s.disk.freeMb > 0 ? `${size(s.disk.freeMb)} free on ${s.disk.drive}` : null
          ],
          download
        ),
        s.pack.nvidia ? row(
          "Use the graphics card",
          [`${size(s.download.gpu)} more to download; a phrase takes about ${seconds(s.firstModel.cuda.phrase)} instead of ${seconds(s.firstModel.cpu.phrase)} (${card2 ? cardText(card2) : "NVIDIA"})`],
          toggleKnob(withGpu, (on) => (withGpu = on, redraw()), "Use the graphics card")
        ) : null
      ].filter((n) => n !== null);
    }
    if (work) return [work];
    if (s.service === "starting" || s.service === "off") return [row("The speech engine is starting\u2026", [], null)];
    if (s.service === "down") return [row("The speech engine is not running", [bad(s.trouble ?? "it stopped")], linkBtn("Restart", () => post({ type: "restartSpeech" })))];
    return [];
  }
  function size(mb) {
    return mb >= 1e3 ? `${(Math.round(mb / 100) / 10).toFixed(1)} GB` : `${Math.max(1, Math.round(mb))} MB`;
  }
  var where = (c) => c.device === "cuda" ? "graphics card" : "processor";
  function liveModel(v, feature) {
    return v.speech.health?.models[feature === "dictation" ? "dictation" : "transcripts"];
  }
  function modelRows(v, feature) {
    const p = feature === "dictation" ? v.speech.plan.dictation : v.speech.plan.transcripts;
    const key = feature === "dictation" ? "dictationModel" : "transcriptsModel";
    const save2 = (model) => post({ type: "saveSettings", patch: { [key]: model } });
    const live = liveModel(v, feature);
    const budget = feature === "dictation" ? `answers in \u2248${seconds(p.budget)}` : `writes an hour\u2019s words in \u2248${minutes(p.budget)}`;
    const out = [
      row(
        "Automatic",
        [`the most accurate model that ${budget} on this computer \xB7 now ${p.chosen.label}`, v.settings.speechPrefer === "speed" ? "quicker ones preferred (Settings)" : null],
        toggleKnob(!p.pinned, (on) => save2(on ? "" : p.chosen.model), "Automatic")
      )
    ];
    for (const c of p.choices) {
      const chosen = c.model === p.chosen.model;
      const fetching = live && live.name === c.model && live.state === "downloading";
      const notes = c.why ? [`${c.about} \xB7 ${c.why}`] : [
        `${estimateText(feature, c)} \xB7 ${where(c)} \xB7 ${BASIS_TEXT[c.basis]}${!c.fits && chosen && p.pinned ? " \xB7 slower than usual here" : ""}`,
        `${c.about}${c.downloaded ? "" : ` \xB7 ${size(c.mb)}, ${chosen ? "downloads with its first use" : "downloads when picked"}`}${p.better?.model === c.model ? " \xB7 fits this computer best" : ""}`,
        fetching ? bar(live.progress ?? 0) : null
      ];
      const control = c.why ? null : fetching ? el("span", { class: "pct" }, `${Math.round((live.progress ?? 0) * 100)}%`) : chosen ? chip(p.pinned ? "picked" : "in use", "lit") : linkBtn("Use", () => {
        if (!c.downloaded) post({ type: "downloadSpeechModel", model: c.model });
        save2(c.model);
      });
      const node = row(c.label, notes, control);
      if (c.why) node.classList.add("dim");
      out.push(node);
    }
    return out;
  }
  function testWork(v) {
    const t = v.speech.health?.calibration;
    if (!t || t.state !== "running" && t.state !== "waiting") return null;
    const share = t.total ? t.done / t.total : 0;
    const what = t.state === "waiting" ? "waits until the engine is free" : `${t.current || "starting"} \xB7 step ${Math.min(t.total, t.done + 1)} of ${t.total}`;
    return row("Testing this computer", [what, bar(share)], el("span", { class: "pct" }, `${Math.round(share * 100)}%`));
  }
  function testOffer(v) {
    const work = testWork(v);
    if (work) return work;
    const t = v.speech.test;
    if (!t.offer) return null;
    return el(
      "div",
      { class: "offer" },
      icon("dashboard"),
      el(
        "div",
        { class: "ot" },
        el("b", {}, "Test your computer to pick the best speech models?"),
        el("small", {}, `Each downloaded model runs once on a short clip, about ${t.runs > 1 ? "a minute or two" : "a minute"}, in the background. Until then the times shown are guesses.`),
        el("span", { class: "acts" }, btn("Run the test", () => post({ type: "testSpeech" }), "primary"), linkBtn("Not now", () => post({ type: "declineSpeechTest" })))
      )
    );
  }
  function computerRows(v) {
    const d = v.speech.device;
    const card2 = mainCard(d);
    const cpu = `${shortCpu(d.cpu.name)} \xB7 ${d.cpu.cores} cores \xB7 ${d.ramGb} GB${d.laptop ? " \xB7 a laptop" : ""}`;
    const cards = card2 ? cardText(card2) : d.at ? "no graphics card of its own" : "looking at the graphics card\u2026";
    const plan = v.speech.plan;
    const tested = plan.measured ? "the speech models\u2019 times are measured here" : running(v) ? "the times are first guesses until the test" : "tested once the speech engine is here";
    const t = testWork(v);
    return [
      row(
        "This computer",
        [cpu, cards, tested],
        running(v) && !t ? linkBtn(v.speech.test.agreed && plan.measured ? "Test again" : "Test", () => post({ type: "testSpeech" }), v.speech.test.runs === 0 && !plan.dictation.choices.some((c) => c.downloaded)) : null
      ),
      ...t ? [t] : []
    ];
  }
  function cardNote(v) {
    const s = v.speech;
    const card2 = mainCard(s.device);
    const gpuPart = hasPart(v, "gpu");
    if (!card2) return s.device.at ? "none of its own \xB7 speech runs on the processor" : "looking\u2026";
    const name = cardText(card2);
    if (card2.vendor !== "nvidia") return `${name} \xB7 speech runs on the processor: only NVIDIA cards run it for now`;
    if (!s.pack.nvidia && !gpuPart) return `${name} \xB7 too old or too small for speech \xB7 the processor does it`;
    if (!gpuPart) return `${name} \xB7 add its part to use it`;
    if (s.health?.fallback) return `${name} \xB7 it would not take the model, so the processor does it`;
    if (s.plan.device === "cpu") return `${name}, but the engine runs on the processor`;
    return `${name} \xB7 speech is recognized on it`;
  }
  var HF = {
    join: "https://huggingface.co/join",
    model: "https://huggingface.co/pyannote/speaker-diarization-community-1",
    tokens: "https://huggingface.co/settings/tokens"
  };
  var DIARIZATION = {
    "needs-token": ["", "needs a free Hugging Face key, once, to download the speakers\u2019 model"],
    checking: ["busy", "checking the key\u2026"],
    downloading: ["busy", "the key works \xB7 downloading the speakers\u2019 model\u2026"],
    "bad-token": ["bad", "the key did not work: copy it whole, and make it of type Read"],
    "no-access": ["bad", "the key works, but the model is not open to it yet: fill in the form on its page (step 2), then Check again"],
    failed: ["bad", "could not check the key"],
    missing: ["", "key saved \xB7 the model downloads with the first transcription"],
    ready: ["ok", "the model is here \xB7 speakers are told apart offline, no key needed any more"]
  };
  var replacing = false;
  var draft = "";
  var expected;
  function diarizationOf(v) {
    const real = v.speech.health?.diarization ?? "needs-token";
    if (expected && Date.now() < expected.until && (real === "needs-token" || real === "missing" || real === "bad-token" || real === "no-access" || real === "failed")) return expected.state;
    expected = void 0;
    return real;
  }
  var follow = (state) => {
    expected = { state, until: Date.now() + 3e3 };
    redraw();
  };
  function speakerRows(v) {
    const s = v.speech;
    const out = [...speakersDeviceRows(v), ...speakersInstallRows(v)];
    if (!hasPart(v, "speakers")) return out;
    if (!running(v)) return [...out, card("lock", "The voices\u2019 model", ["set up once the speech engine runs"], null)];
    return [...out, grp("The voices\u2019 model"), ...keyRows(v)];
  }
  var DEVICE_NAMES = { cuda: "graphics card", cpu: "processor" };
  function speakersDeviceRows(v) {
    const s = v.speech;
    const plan = s.plan.speakers;
    const pick = (on) => post({ type: "saveSettings", patch: { speakersDevice: on === plan.advised ? "auto" : on } });
    const option = (on) => {
      const sz = s.speakers.sizes[on];
      const time = plan[on];
      const chosen = s.speakers.on === on;
      const node = card(
        on === "cuda" ? "monitor" : "cpu",
        on === "cuda" ? "Graphics card" : "Processor",
        [
          time === void 0 ? null : `an hour\u2019s voices in \u2248${minutes(time)} here${plan.advised === on ? " \xB7 advised" : ""}`,
          on === "cuda" ? `PyTorch for the card \xB7 \u2248${size(sz.download)} download \xB7 ${size(sz.installed)} on the disk, in place of the card\u2019s part` : `PyTorch for the processor \xB7 \u2248${size(sz.download)} download \xB7 ${size(sz.installed)} on the disk`
        ],
        chosen ? chip("chosen", "lit") : linkBtn("Use", () => pick(on))
      );
      if (chosen) node.classList.add("picked");
      return node;
    };
    const rows = [aside("info", "The words are recognized already. Telling the voices apart is another model; it runs on PyTorch, which is what downloads here."), grp("Runs on")];
    if (s.plan.offers.speakersGpu && plan.cuda !== void 0) rows.push(option("cuda"));
    rows.push(option("cpu"));
    return rows;
  }
  function speakersInstallRows(v) {
    const s = v.speech;
    const work = packWork(v);
    if (work) return [work];
    const on = s.speakers.on;
    const sz = s.speakers.sizes[on];
    const parts = on === "cuda" && !hasPart(v, "gpu") ? ["gpu", "speakers"] : ["speakers"];
    const install = (label) => btn(label, () => post({ type: "installSpeech", parts }), "primary");
    const model = s.speakers.model ? "the voices\u2019 model is here already: no Hugging Face key needed" : "then a free Hugging Face key, once, for the voices\u2019 model";
    const room = s.disk.freeMb > 0 && s.disk.freeMb < sz.installed * 1.1 ? bad(`Needs \u2248${size(sz.installed * 1.1)} free; ${s.disk.drive} has ${size(s.disk.freeMb)}`) : null;
    if (!hasPart(v, "speakers")) {
      return [grp("Download"), card("download", `Who spoke when, on the ${DEVICE_NAMES[on]}`, [`\u2248${size(sz.download)} download, once \xB7 ${model}`, s.pack.status === "failed" ? bad(`The download stopped: ${s.pack.message ?? "unknown error"}`) : room], install(s.pack.status === "failed" ? "Try again" : "Download"))];
    }
    const there = s.pack.speakersOn ?? "cpu";
    if (there !== on) {
      return [grp("Installed"), card("rotate-cw", `On the ${DEVICE_NAMES[there]} now`, [`switching to the ${DEVICE_NAMES[on]}: \u2248${size(sz.download)} download; the other PyTorch goes`, room], install("Switch"))];
    }
    return [grp("Installed"), card("circle-check", `Installed \xB7 on the ${DEVICE_NAMES[on]}`, [el("small", { class: "ok" }, `an hour\u2019s voices in \u2248${minutes(s.plan.speakers[on] ?? s.plan.speakers.cpu)} here`)], null)];
  }
  function keyRows(v) {
    const s = v.speech;
    const state = diarizationOf(v);
    const [kind, words] = DIARIZATION[state];
    const message = state === "failed" && s.health?.diarizationMessage ? `${words}: ${s.health.diarizationMessage}` : words;
    const note = el("small", { class: kind ? `kstate ${kind}` : "kstate" }, kind === "busy" ? el("i", { class: "spin" }) : kind === "ok" ? icon("check") : null, message);
    const again = (label) => linkBtn(label, async () => {
      try {
        await api("POST", "/diarization/setup");
        follow("checking");
      } catch (error) {
        fault(error);
      }
    });
    const field = el("input", {
      type: "password",
      class: "field wide",
      placeholder: "hf_\u2026",
      autocomplete: "off",
      spellcheck: "false",
      "aria-label": "Hugging Face key",
      oninput: (event) => draft = event.target.value
    });
    field.value = draft;
    const saveKey2 = async () => {
      const value = field.value.trim();
      if (!value) return field.focus();
      field.blur();
      draft = "";
      replacing = false;
      if (await saveEngine({ hfToken: value })) follow("checking");
    };
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void saveKey2();
      if (event.key === "Escape" && replacing) event.preventDefault(), replacing = false, field.blur(), redraw();
    });
    const entry = el("span", { class: "kchg" }, field, btn("Save", () => void saveKey2(), "primary"));
    const settled = state === "ready" || state === "missing";
    const control = settled && !replacing ? linkBtn("Replace key", () => {
      replacing = true;
      redraw();
    }) : state === "no-access" ? again("Check again") : state === "failed" ? again("Try again") : null;
    if (state === "ready" && !replacing) return [row("The voices\u2019 model", [note], null)];
    const out = [row("Hugging Face key", [note], control)];
    const typing = !settled && state !== "checking" && state !== "downloading" || replacing;
    if (typing) {
      out.push(
        el(
          "ol",
          { class: "steps" },
          el("li", {}, link(HF.join, "Sign up at Hugging Face"), ", free."),
          el("li", {}, "Open ", link(HF.model, "the model\u2019s page"), " and fill in its form: Company or university, anything, your own name will do; Use case: ", el("b", {}, "Meeting note taker"), ". Then Agree and access."),
          el("li", {}, "Open ", link(HF.tokens, "Access Tokens"), " \u2192 Create new token \u2192 type ", el("b", {}, "Read"), " \u2192 copy the hf_\u2026 key."),
          el("li", {}, "Paste it here and Save. The model downloads once; after that, everything works offline.", el("span", { class: "kline" }, entry))
        )
      );
    }
    return out;
  }
  function speakersMissing(v, go2) {
    if (!installed(v)) return null;
    const state = v.speech.health?.diarization;
    if (hasPart(v, "speakers") && state !== "needs-token" && state !== "bad-token" && state !== "no-access" && state !== "failed") return null;
    const why = !hasPart(v, "speakers") ? "Speakers are not told apart yet: their part is not downloaded." : "Speakers are not told apart yet: a Hugging Face key is needed.";
    return aside("users", why, " ", linkBtn("Set up", go2));
  }

  // src/webview/setup.ts
  var STEPS = ["Your language", "This computer", "What you need", "Download"];
  var CAPS = ["English is what Krya teaches", "what speech can run on here", "advised for this computer", "one button, then it goes on by itself"];
  var step = 1;
  var choice;
  var started = false;
  var firstNative = "";
  function resetSetup() {
    step = 1;
    choice = void 0;
    started = false;
    firstNative = "";
  }
  function advised(node, a) {
    if (!a.on) return node;
    const l = node.querySelector(".l");
    const first = l?.querySelector("small");
    const mark2 = el("span", { class: "chip good" }, lucide("check", "s"), "Recommended");
    if (l) l.insertBefore(mark2, first ?? null);
    return node;
  }
  function setupNodes(v, h) {
    if (!firstNative) firstNative = v.settings.native;
    const c = choice ??= recommendedChoice(v);
    const r = recommend(v);
    const body = step === 1 ? languageStep(v, h) : step === 2 ? computerStep(v, h, c, r) : step === 3 ? needStep(v, h, c, r) : downloadStep(v, h, c);
    const go2 = (to) => {
      step = Math.max(1, Math.min(4, to));
      h.redraw();
    };
    const finish = () => h.save({ setupDone: true, speechTestAgreed: c.test });
    const skip = () => h.save({ setupDone: true });
    const download = () => {
      start(v, h, c);
      started = true;
      go2(4);
    };
    const room = step === 3 ? cost(c, v).fits : true;
    const next = step === 3 ? btn([lucide("download", "s"), "Download"], download, "primary") : step === 4 ? btn("Finish", finish, "primary") : btn(["Next", lucide("chevron-right", "s")], () => go2(step + 1), "primary");
    if (!room) next.disabled = true;
    return [
      el(
        "div",
        { class: "shead" },
        el("div", { class: "sprog" }, ...STEPS.map((_, i) => el("i", { class: i + 1 === step ? "on" : i + 1 < step ? "done" : "" })), el("span", {}, `Step ${step} of ${STEPS.length}`)),
        el("div", { class: "stitle-line" }, el("span", { class: "stitle" }, STEPS[step - 1]), el("span", { class: "scap" }, CAPS[step - 1])),
        el("div", { class: "sline" })
      ),
      el("div", { class: "sbody" }, ...body),
      el(
        "div",
        { class: "sfoot" },
        step > 1 && !(step === 4 && started) ? linkBtn("Back", () => go2(step - 1)) : null,
        el("span", { class: "gap" }),
        step < 4 ? linkBtn("Skip for now", skip) : null,
        next
      )
    ];
  }
  function languageStep(v, h) {
    const s = v.settings;
    const nameOf = (code) => LANGUAGES.find((l) => l.code === code)?.name ?? code;
    const used = [s.native, "English", ...s.languages.map(nameOf)];
    const rest = LANGUAGES.filter((l) => !used.includes(l.name));
    const own = card(
      "languages",
      "Your language",
      ["what Krya translates into and listens for; English is the language it teaches"],
      select(
        s.native,
        v.languages.map((l) => [l.name, `${l.native} \xB7 ${l.name}`]),
        (native) => {
          choice = void 0;
          h.save({ native });
        }
      )
    );
    if (s.native === firstNative) advised(own, { on: true, why: "" });
    return [
      grp("Your language"),
      own,
      s.native === firstNative ? aside("info", `Windows is in ${s.native}: the same language is advised.`) : null,
      grp("Other languages you use"),
      card(
        "plus",
        "Add a language",
        ["dictation never picks another; translation and the screen\u2019s text guess among them"],
        select("", [["", "Pick a language"], ...rest.map((l) => [l.code, `${l.name} \xB7 ${l.native}`])], (code) => code && h.save({ languages: [...s.languages, code] }))
      ),
      card("globe", "English", ["always"], null),
      ...s.languages.map((code) => card("globe", nameOf(code), [], ib("x", `Remove ${nameOf(code)}`, () => h.save({ languages: s.languages.filter((x) => x !== code) }))))
    ].filter((n) => n !== null);
  }
  function computerStep(v, h, c, r) {
    const s = v.speech;
    const d = s.device;
    const looking = d.at === 0;
    const gpu = mainCard(d);
    const spin = () => el("i", { class: "spin" });
    const cardNote2 = looking ? el("small", { class: "kstate busy" }, spin(), "looking at the graphics card\u2026") : gpu ? cardText(gpu) : "none of its own";
    const onCard = s.plan.offers.gpu && c.gpu;
    const verdict = onCard ? card("sparkles", "Speech can run on the graphics card", [`a dictated phrase in \u2248${seconds(s.firstModel.cuda.phrase)} with ${s.firstModel.cuda.model} \xB7 an hour of a meeting in minutes`], null) : card("sparkles", "Speech runs on the processor", [`a dictated phrase in \u2248${seconds(s.firstModel.cpu.phrase)} with ${s.firstModel.cpu.model} \xB7 an hour of a meeting in \u2248${minutes(s.plan.transcripts.chosen.estimate)}`], null);
    verdict.classList.add("total");
    return [
      grp("Hardware"),
      card("cpu", "Processor", [looking ? el("small", { class: "kstate busy" }, spin(), `${shortCpu(d.cpu.name)} \xB7 looking\u2026`) : `${shortCpu(d.cpu.name)} \xB7 ${d.cpu.cores} cores${d.laptop ? " \xB7 a laptop" : ""}`], null),
      card("memory-stick", "Memory", [`${d.ramGb} GB`], null),
      card("monitor", "Graphics card", [cardNote2], null),
      grp("What it means"),
      verdict,
      s.plan.offers.gpu ? advised(
        toggleCard(
          "monitor",
          "Use the graphics card",
          c.gpu,
          (on) => {
            c.gpu = on;
            h.redraw();
          },
          r.gpu.why
        ),
        r.gpu
      ) : null,
      looking ? aside("info", "Still looking at this computer; Next does not wait, the advice follows once it is known.") : null
    ].filter((n) => n !== null);
  }
  function needStep(v, h, c, r) {
    const s = v.speech;
    const t = v.translatorState;
    const flip = (key) => (on) => {
      ;
      c[key] = on;
      if (key === "transcribe" && !on) c.speakers = false;
      h.redraw();
    };
    const translatorNote = t.status === "unsupported" ? "no offline translator for this language yet" : t.status === "ready" ? `the translator for ${v.settings.native} \u21C4 English is here` : `the translator for ${v.settings.native} \u21C4 English \xB7 ${sizeText(t.size)}, once`;
    const dictNote = { ready: "the word dictionary is here", absent: "the word dictionary \xB7 a few MB, once", downloading: "the word dictionary is coming", failed: "the word dictionary \xB7 a few MB, once", none: "no word dictionary for this language yet" }[v.dictionary.status];
    const engineMb = s.download.core + (c.gpu && s.pack.nvidia ? s.download.gpu : 0);
    const dictateModel = s.plan.dictation.chosen;
    const transcribeModel = s.plan.transcripts.chosen;
    const all = cost(c, v);
    const total = card(
      "hard-drive",
      `\u2248${sizeText(all.download)} to download`,
      [`${sizeText(all.disk)} on the disk once installed \xB7 ${s.disk.freeMb > 0 ? `${sizeText(s.disk.freeMb)} free on ${s.disk.drive}` : "free space unknown"}`, all.fits ? null : bad("Not enough room: turn something off, or free some space.")],
      null
    );
    total.classList.add("total");
    if (!all.fits) total.classList.add("bad");
    return [
      grp("Always"),
      card("languages", "Listen & Translate", [translatorNote, dictNote], el("span", { class: "chip" }, "always on")),
      advised(
        card(
          "volume-2",
          "Voice",
          [r.voice.why],
          seg(
            c.voice,
            [
              ["natural", v.natural.status === "ready" ? "Natural \xB7 here" : `Natural \xB7 ${sizeText(v.natural.size)}`],
              ["windows", "Windows voice"]
            ],
            (voice) => {
              c.voice = voice;
              h.redraw();
            }
          )
        ),
        { on: r.voice.on, why: "" }
      ),
      grp("Keyboard"),
      advised(toggleCard("keyboard", "Fix the layout as I type", c.autoFix, flip("autoFix"), r.autoFix.why), r.autoFix),
      toggleCard("type", "Show the layout by the cursor", c.layoutBadge, flip("layoutBadge"), "a small badge whenever the layout changes"),
      grp("Speech"),
      advised(toggleCard("mic", "Dictate", c.dictate, flip("dictate"), `${r.dictate.why} \xB7 the speech engine ${sizeText(engineMb)} + ${dictateModel.label} ${dictateModel.downloaded ? "here" : sizeText(dictateModel.mb)}`), r.dictate),
      advised(toggleCard("audio-lines", "Transcribe meetings and files", c.transcribe, flip("transcribe"), `${r.transcribe.why} \xB7 ${transcribeModel.label} ${transcribeModel.downloaded ? "here" : sizeText(transcribeModel.mb)}${c.dictate ? "" : ` + the speech engine ${sizeText(engineMb)}`}`), r.transcribe),
      c.transcribe ? advised(toggleCard("users", "Who spoke when", c.speakers, flip("speakers"), `${r.speakers.why} \xB7 ${sizeText(s.speakers.sizes[speakersWhere(c, v)].download)}`), r.speakers) : null,
      c.transcribe && c.speakers ? speakersOnCard(v, h, c) : null,
      grp("Krya"),
      advised(toggleCard("power", "Start with Windows", c.startWithWindows, flip("startWithWindows"), r.startWithWindows.why), r.startWithWindows),
      grp("All of it"),
      total,
      aside("info", "Keys are set on each action\u2019s page; everything here can be changed later in Settings.")
    ].filter((n) => n !== null);
  }
  function speakersOnCard(v, h, c) {
    const s = v.speech;
    const where2 = speakersWhere(c, v);
    const time = (on) => s.plan.speakers[on];
    const canCard = s.plan.offers.speakersGpu && c.gpu && s.pack.nvidia && time("cuda") !== void 0;
    const note = `an hour\u2019s voices in \u2248${minutes(time(where2) ?? s.plan.speakers.cpu)} here`;
    if (!canCard) return card("cpu", "Runs on the processor", [note], null);
    const advice = s.plan.speakers.advised === "cuda" ? "the graphics card" : "the processor";
    const node = card(
      "cpu",
      "Runs on",
      [note, where2 === s.plan.speakers.advised ? null : `${advice} is advised on this computer`],
      seg(
        where2,
        [
          ["cuda", `Graphics card \xB7 ${sizeText(s.speakers.sizes.cuda.download)}`],
          ["cpu", `Processor \xB7 ${sizeText(s.speakers.sizes.cpu.download)}`]
        ],
        (on) => {
          c.speakersOn = on;
          h.redraw();
        }
      )
    );
    return where2 === s.plan.speakers.advised ? advised(node, { on: true, why: "" }) : node;
  }
  function start(v, h, c) {
    const all = cost(c, v);
    h.save({
      voice: "",
      naturalDismissed: c.voice === "windows",
      autoFix: c.autoFix,
      layoutBadge: c.layoutBadge,
      startWithWindows: c.startWithWindows,
      speechTestAgreed: c.test,
      // The advice stays "automatic", so it follows the computer; another choice is kept as made.
      speakersDevice: speakersWhere(c, v) === v.speech.plan.speakers.advised ? "auto" : speakersWhere(c, v)
    });
    const t = v.translatorState.status;
    if (t === "absent" || t === "failed") h.post({ type: "prepareTranslator" });
    const d = v.dictionary.status;
    if (d === "absent" || d === "failed") h.post({ type: "prepareDictionary" });
    if (c.voice === "natural" && (v.natural.status === "absent" || v.natural.status === "failed")) h.post({ type: "downloadNatural" });
    if (c.dictate || c.transcribe) {
      if (all.parts.length === 0 && running(v)) for (const model of all.models) h.post({ type: "downloadSpeechModel", model });
      else if (all.parts.length || all.models.length) h.post({ type: "installSpeech", parts: all.parts.length ? all.parts : ["core"], models: all.models });
    }
  }
  function downloadStep(v, h, c) {
    const all = cost(c, v);
    const rows = all.items.map((item) => itemRow(item, v, h));
    return [
      grp(started ? "Downloading" : "To download", all.items.length),
      ...rows,
      grp("Then"),
      advised(
        toggleCard(
          "play",
          "Test the speech models when they are here",
          c.test,
          (on) => {
            c.test = on;
            h.save({ speechTestAgreed: on });
          },
          "each downloaded model runs once on a short clip, a minute or two in the background; then the times here are this computer\u2019s own"
        ),
        { on: true, why: "" }
      ),
      aside("info", started ? "You can close this window: the downloads go on, and Home shows how far they are." : "Nothing has started yet: go back to Download, or Finish to set everything up later from the pages.")
    ].filter((n) => n !== null);
  }
  var done = (what) => el("small", { class: "kstate ok" }, lucide("check", "s"), what);
  var waiting = (what) => el("small", {}, what);
  function itemRow(item, v, h) {
    const s = v.speech;
    const icons = { translator: "languages", dictionary: "book-open", voice: "volume-2", engine: "cpu" };
    const icon2 = icons[item.key] ?? "audio-lines";
    const pct = (p) => el("span", { class: "pct" }, `${Math.round(p * 100)}%`);
    let note = item.note;
    let control = null;
    if (item.key === "translator") {
      const t = v.translatorState;
      if (t.status === "ready") note = done("here");
      else if (t.status === "downloading") note = bar(t.progress), control = pct(t.progress);
      else if (t.status === "failed") note = bad("the download failed"), control = linkBtn("Try again", () => h.post({ type: "prepareTranslator" }));
      else note = started ? waiting("starting\u2026") : item.note;
    } else if (item.key === "dictionary") {
      const d = v.dictionary.status;
      if (d === "ready") note = done("here");
      else if (d === "downloading") note = waiting("coming\u2026");
      else if (d === "failed") note = bad("the download failed"), control = linkBtn("Try again", () => h.post({ type: "prepareDictionary" }));
      else note = started ? waiting("starting\u2026") : item.note;
    } else if (item.key === "voice") {
      const n = v.natural;
      if (n.status === "ready") note = done("here");
      else if (n.status === "downloading") note = bar(n.progress), control = pct(n.progress);
      else if (n.status === "failed") note = bad("the download failed"), control = linkBtn("Try again", () => h.post({ type: "downloadNatural" }));
      else note = started ? waiting("starting\u2026") : item.note;
    } else if (item.key === "engine") {
      const p = s.pack;
      if (p.status === "installing") note = el("span", {}, bar(p.progress ?? 0), el("small", {}, p.step === "tool" ? "the Python manager" : "the packages \xB7 the window can be closed, it goes on")), control = pct(p.progress ?? 0);
      else if (installed(v) && !item.mb) note = done("here");
      else if (p.status === "failed") note = bad(p.message ?? "the install failed"), control = linkBtn("Try again", () => h.post({ type: "installSpeech", parts: cost(choice ?? recommendedChoice(v), v).parts }));
      else note = started ? waiting("starting\u2026") : item.note;
    } else {
      const model = item.key.slice("model:".length);
      const live = Object.values(s.health?.models ?? {}).find((m) => m.name === model);
      if (item.mb === 0 || s.health?.downloaded?.includes(model)) note = done("here");
      else if (live?.state === "downloading") note = bar(live.progress ?? 0), control = pct(live.progress ?? 0);
      else note = started ? waiting(running(v) ? "next" : "after the speech engine") : item.note;
    }
    const row2 = card(icon2, item.label, [note, item.mb ? `${sizeText(item.mb)}` : null], control);
    return row2;
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
  function stopped(recorder) {
    if (!recorder || recorder.state === "inactive") return Promise.resolve();
    return new Promise((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
  }
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

  // src/webview/transcripts.ts
  var hooks = { view: () => void 0, shown: () => false, show: () => {
  }, setup: () => {
  } };
  var setTranscriptHooks = (h) => hooks = h;
  var SOURCES = {
    file: { label: "file", icon: "file-media" },
    mic: { label: "microphone", icon: "mic" },
    meet: { label: "Google Meet", icon: "organization" },
    note: { label: "note", icon: "note" }
  };
  var STAGES = [
    ["decode", "Preparing the sound"],
    ["words", "Recognizing speech"],
    ["speakers", "Telling speakers apart"],
    ["save", "Saving"]
  ];
  var WEIGHTS = { decode: [0, 0.1], words: [0.1, 0.6], speakers: [0.6, 0.95], save: [0.95, 1] };
  var FORMATS = [
    ["docx", "Word \xB7 .docx"],
    ["md", "Markdown \xB7 .md"],
    ["txt", "Text \xB7 .txt"],
    ["srt", "Subtitles \xB7 .srt"],
    ["vtt", "Subtitles \xB7 .vtt"],
    ["json", "Data \xB7 .json"]
  ];
  var CODES = {
    Russian: "ru",
    Ukrainian: "uk",
    German: "de",
    French: "fr",
    Spanish: "es",
    Italian: "it",
    Polish: "pl",
    Portuguese: "pt",
    Turkish: "tr",
    Dutch: "nl",
    Czech: "cs",
    Japanese: "ja",
    Chinese: "zh",
    Korean: "ko",
    Arabic: "ar",
    Persian: "fa",
    Kazakh: "kk",
    Hebrew: "he",
    Swedish: "sv",
    Greek: "el",
    Hungarian: "hu",
    Romanian: "ro",
    Bulgarian: "bg",
    Finnish: "fi",
    Danish: "da",
    Norwegian: "no",
    Serbian: "sr",
    Croatian: "hr",
    Slovak: "sk",
    Lithuanian: "lt",
    Latvian: "lv",
    Estonian: "et"
  };
  var tx = {
    rows: void 0,
    query: "",
    /** The transcript open on the page; empty: the library. */
    openId: "",
    row: void 0,
    transcript: void 0,
    recorder: void 0,
    language: "auto",
    speakers: 0,
    /** The delete button was tapped once: it asks. */
    deleting: false,
    /** The export menu is open. */
    exporting: false,
    /** "Transcribe again" was tapped once: it asks. */
    redoing: false
  };
  var DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  var DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  function meta(r, long = false) {
    const parts = [(long ? DAY : DATE).format(new Date(r.created))];
    if (r.duration) parts.push(length(r.duration));
    parts.push(SOURCES[r.source]?.label ?? r.source);
    return parts.join(" \xB7 ");
  }
  var languages = (v) => {
    const own = CODES[v.settings.native];
    return [["auto", "Auto"], ["en", "English"], ...own ? [[own, v.settings.native]] : []];
  };
  async function transcribeFiles(files) {
    const ids = [];
    for (const file of files) {
      const path = window.tutorHost.pathOf(file);
      if (!path) continue;
      try {
        ids.push((await api("POST", "/transcripts", { path, language: tx.language === "auto" ? null : tx.language, speakers: tx.speakers || null })).id);
      } catch (error) {
        toast(`${file.name}: ${problem(error)}`, void 0, true);
      }
    }
    if (ids.length === 1) openTranscript(ids[0]);
    else if (ids.length > 1) {
      toast(`${ids.length} files are waiting their turn`);
      openTranscript("");
    }
  }
  var picker = el("input", {
    type: "file",
    accept: "audio/*,video/*,.mkv,.m4a,.opus,.flac",
    multiple: true,
    hidden: true,
    onchange: (event) => {
      const input = event.target;
      void transcribeFiles([...input.files ?? []]).finally(() => input.value = "");
    }
  });
  document.body.append(picker);
  function newRows(v) {
    const zone = el(
      "div",
      { class: "zone", role: "button", tabindex: 0, onclick: () => picker.click(), onkeydown: (e) => e.key === "Enter" && picker.click() },
      icon("cloud-upload"),
      el("div", { class: "zt" }, el("b", {}, "Drop a video or audio file"), el("small", {}, `here or anywhere in the window \xB7 mp4, mov, mkv, webm, mp3, m4a, wav\u2026 \xB7 read where it is, never copied \xB7 an hour takes \u2248${minutesPerHour(v) >= 60 ? "an hour" : `${minutesPerHour(v)} min`} here`)),
      btn("Pick a file\u2026", (event) => (event.stopPropagation(), picker.click()))
    );
    return [
      zone,
      card("languages", "Language", ["Auto: heard from the first seconds"], seg(tx.language, languages(v), (language) => tx.language = language)),
      card(
        "users",
        "Speakers",
        ["how many talk \xB7 Auto finds out"],
        seg(tx.speakers, [[0, "Auto"], [1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5"], [6, "6"]], (speakers) => tx.speakers = speakers, true)
      ),
      micRow()
    ];
  }
  function micRow() {
    const r = tx.recorder;
    if (!r) return card("mic", "Record from the microphone", ["a talk, a lecture, people in the room \xB7 the text comes after Stop"], btn([el("i", { class: "dot" }), "Record"], () => void startMic(), "rec"));
    return el(
      "div",
      { class: "row live" },
      el("div", { class: "l" }, el("span", { class: "livehead" }, el("i", { class: "dot pulse" }), "Recording", el("span", { class: "mtime" }, clock(r.seconds))), el("span", { class: "level" }, el("i"))),
      el("span", { class: "kchg" }, linkBtn("Cancel", () => void cancelMic()), btn("Stop and transcribe", () => void stopMic(), "primary"))
    );
  }
  window.setInterval(() => {
    const r = tx.recorder;
    if (!r) return;
    for (const t of document.querySelectorAll(".mtime")) t.textContent = clock(r.seconds);
    for (const l of document.querySelectorAll(".level i")) l.style.width = `${Math.round(r.level() * 100)}%`;
  }, 100);
  async function startMic() {
    const r = new ChunkRecorder(window.tutorHost.call, { source: "mic", slice: 1e4, language: tx.language === "auto" ? void 0 : tx.language, speakers: tx.speakers || void 0 });
    try {
      await r.start();
      tx.recorder = r;
      post({ type: "micRecording", on: true });
    } catch (error) {
      toast(micTrouble(error), void 0, true);
    }
    redrawPage();
  }
  async function stopMic() {
    const r = tx.recorder;
    tx.recorder = void 0;
    post({ type: "micRecording", on: false });
    redrawPage();
    if (!r) return;
    try {
      const id = await r.finish();
      if (r.lost) toast("A piece of the recording did not reach the engine", void 0, true);
      openTranscript(id);
    } catch (error) {
      fault(error);
    }
  }
  async function cancelMic() {
    const r = tx.recorder;
    tx.recorder = void 0;
    post({ type: "micRecording", on: false });
    redrawPage();
    await r?.cancel();
  }
  var drop = el("div", { class: "drop" }, el("div", {}, icon("cloud-upload"), el("b", {}, "Drop to transcribe")));
  document.body.append(drop);
  var dragDepth = 0;
  var carriesFiles = (event) => !!event.dataTransfer?.types.includes("Files");
  window.addEventListener("dragenter", (event) => {
    if (!carriesFiles(event)) return;
    dragDepth++;
    drop.classList.add("on");
  });
  window.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) drop.classList.remove("on");
  });
  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    drop.classList.remove("on");
    const files = [...event.dataTransfer?.files ?? []];
    if (!files.length) return;
    const v = hooks.view();
    if (!v || !running(v)) return hooks.setup();
    void transcribeFiles(files);
  });
  var searchTimer;
  async function loadRows() {
    try {
      const rows = await api("GET", `/transcripts?q=${encodeURIComponent(tx.query)}`);
      const changed = JSON.stringify(rows) !== JSON.stringify(tx.rows);
      tx.rows = rows;
      if (changed && hooks.shown() && !tx.openId) redrawPage();
    } catch {
    }
  }
  function transcriptsCap() {
    const n = tx.rows?.length;
    if (n === void 0 || tx.query) return "searched by their words";
    return n ? `${n} \xB7 searched by their words` : "none yet";
  }
  function transcriptsBody(v) {
    if (!installed(v)) return [row("Transcripts need the speech engine", ["it downloads once, on the Transcribe page"], linkBtn("Transcribe\u2026", () => hooks.setup()))];
    if (!running(v)) return [row("The speech engine is starting\u2026", ["the transcripts show once it runs"], null)];
    return tx.openId ? transcriptPage(v) : libraryPage(v);
  }
  function libraryPage(v) {
    const kb = v.speech.health?.kbDir;
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
            placeholder: "Search every transcript",
            value: tx.query,
            oninput: (event) => {
              tx.query = event.target.value;
              window.clearTimeout(searchTimer);
              searchTimer = window.setTimeout(() => void loadRows(), 200);
            }
          })
        ),
        btn([icon("add"), "New"], () => hooks.setup(), "", "A new transcription")
      ),
      kb === "" ? aside("book-open", "Notes need a knowledge base folder.", " ", linkBtn("Choose\u2026", () => void pickKb())) : null,
      speakersMissing(v, () => hooks.setup()),
      list(v)
    ].filter((n) => n !== null);
  }
  function list(v) {
    const rows = tx.rows;
    if (!rows) return el("ul", { class: "tl" }, el("li", { class: "empty" }, "Opening the library\u2026"));
    if (!rows.length) {
      if (tx.query) return el("ul", { class: "tl" }, el("li", { class: "empty" }, "Nothing found."));
      const tip = (glyph2, ...text) => el("li", {}, icon(glyph2), el("span", {}, ...text));
      return el(
        "div",
        { class: "tempty" },
        el("b", {}, "Transcripts will be here"),
        el(
          "ul",
          {},
          tip("cloud-upload", "Drop a video or audio file into this window"),
          tip("mic", "Record from the microphone on the Transcribe page"),
          tip("note", "Dictate a note: ", caps(v.settings.noteKey), " in any program"),
          tip("organization", "Record a Google Meet call with the Chrome extension")
        )
      );
    }
    return el(
      "ul",
      { class: "tl" },
      ...rows.map(
        (r) => el(
          "li",
          {},
          el(
            "button",
            { class: "ti", onclick: () => openTranscript(r.id) },
            el("span", { class: "src" }, icon(SOURCES[r.source]?.icon ?? "file")),
            el("span", { class: "tm" }, el("b", {}, r.title), el("small", {}, meta(r)), r.snippet ? snippet(r.snippet) : null),
            statusChip(r)
          )
        )
      )
    );
  }
  function snippet(text) {
    const out = el("span", { class: "snip" });
    for (const part of text.split(/(\[[^\]]*\])/)) {
      if (part.startsWith("[") && part.endsWith("]")) out.append(el("mark", {}, part.slice(1, -1)));
      else if (part) out.append(part);
    }
    return out;
  }
  function statusChip(r) {
    if (r.status === "done") return null;
    if (r.status === "failed") return el("span", { class: "chip bad" }, "failed");
    if (r.status === "recording") return el("span", { class: "chip rec" }, el("i", { class: "dot pulse" }), "recording");
    if (r.status === "queued") return el("span", { class: "chip off" }, "waiting");
    return el("span", { class: "chip lit" }, `${Math.round(r.progress * 100)}%`);
  }
  function openTranscript(id) {
    if (id !== tx.openId) stopPlayer();
    tx.openId = id;
    tx.deleting = tx.exporting = tx.redoing = false;
    if (id && tx.row?.id !== id) {
      tx.row = void 0;
      tx.transcript = void 0;
    }
    if (id) void loadTranscript();
    else void loadRows();
    if (hooks.shown()) redrawPage();
    else hooks.show();
  }
  function backToList() {
    if (!tx.openId) return false;
    openTranscript("");
    return true;
  }
  function leaveTranscripts() {
    stopPlayer();
  }
  var busy = (status) => status === "queued" || status === "working";
  async function loadTranscript() {
    const id = tx.openId;
    try {
      const r = await api("GET", `/transcripts/${id}`);
      if (id !== tx.openId) return;
      const before = tx.row?.id === id ? tx.row : void 0;
      tx.row = r.row;
      if (r.transcript || r.row.status !== "done") tx.transcript = r.transcript ?? void 0;
      pace.see(r.row);
      if (!hooks.shown()) return;
      if (r.row.status === "done" && before?.status === "done") return;
      const card2 = document.querySelector(".progress");
      if (card2 && busy(before?.status) && busy(r.row.status)) return updateProgress(card2, r.row);
      redrawPage();
    } catch (error) {
      if (error instanceof SpeechError && error.status === 404) openTranscript("");
    }
  }
  function transcriptPage(v) {
    const r = tx.row;
    if (!r || r.id !== tx.openId) return [el("p", { class: "opening" }, "Opening\u2026")];
    const t = tx.transcript;
    const title = el("h2", {
      class: "ttitle",
      contenteditable: t ? "plaintext-only" : false,
      spellcheck: "false",
      title: t ? "Rename" : void 0,
      onkeydown: (event) => {
        const e = event;
        if (e.key === "Enter") e.preventDefault(), e.target.blur();
        if (e.key === "Escape") e.preventDefault(), e.target.textContent = t?.title ?? r.title, e.target.blur();
      },
      onblur: (event) => {
        const node = event.target;
        const text = node.textContent?.trim() ?? "";
        if (t && text && text !== t.title) void patch({ title: text }).then(() => void loadRows());
        else node.textContent = t?.title ?? r.title;
      }
    });
    title.textContent = t?.title ?? r.title;
    const head = el("div", { class: "thead" }, title, el("small", { class: "tmeta" }, meta(t ?? r, true)));
    if (r.status !== "done" || !t) {
      stopPlayer();
      return [head, progressCard(r)];
    }
    return [head, actions(t), ...notices(v, r, t), speakersStrip(t), utterances(t), player(v, t)].filter((n) => n !== null);
  }
  function progressCard(r) {
    if (r.status === "failed") {
      return el(
        "div",
        { class: "card bad" },
        el("b", {}, "Could not transcribe it"),
        el("small", {}, r.error),
        el(
          "div",
          { class: "cardbtns" },
          btn("Try again", async () => {
            try {
              await api("POST", `/transcripts/${r.id}/retry`);
              void loadTranscript();
            } catch (error) {
              fault(error);
            }
          }),
          linkBtn("Delete", () => void remove(r.id))
        )
      );
    }
    if (r.status === "recording") return el("div", { class: "card" }, el("b", {}, el("i", { class: "dot pulse" }), " Recording"), el("small", {}, "The text comes once the recording stops."));
    const card2 = el(
      "div",
      { class: "card progress" },
      el("b", { class: "plead" }),
      el("span", { class: "track" }, el("i")),
      el("small", { class: "pstat" }),
      el("ol", { class: "stages" }, ...STAGES.map(([, label]) => el("li", {}, label))),
      el("small", { class: "pnote" }, "The window can be closed: it goes on in the background.")
    );
    updateProgress(card2, r);
    return card2;
  }
  function updateProgress(card2, r) {
    const at = STAGES.findIndex((s) => s[0] === r.stage);
    const lead = card2.querySelector(".plead");
    if (lead) lead.textContent = r.status === "queued" ? "Waiting its turn" : `${STAGES[at]?.[1] ?? "Starting"}\u2026`;
    const track = card2.querySelector(".track");
    track?.classList.toggle("live", r.status === "working");
    const fill = track?.firstElementChild;
    if (fill) fill.style.width = `${(r.progress * 100).toFixed(1)}%`;
    const line = card2.querySelector(".pstat");
    if (line) line.textContent = progressLine(r);
    card2.querySelectorAll(".stages li").forEach((li, i) => li.className = i < at ? "done" : i === at ? "now" : "");
  }
  function progressLine(r) {
    if (r.status === "queued") return "Starts once the one before it is done.";
    const [a, b] = WEIGHTS[r.stage] ?? [0, 1];
    const part = Math.min(1, Math.max(0, (r.progress - a) / (b - a)));
    const parts = [];
    if (r.stage === "words" && part === 0) parts.push("loading the model, finding speech");
    else if (r.stage === "words" && r.duration && r.source !== "meet") parts.push(position(part * r.duration, r.duration));
    else if (part > 0) parts.push(`${Math.round(part * 100)}%`);
    const left = part > 0 ? pace.left(r) : "";
    if (left) parts.push(left);
    return parts.join(" \xB7 ");
  }
  function position(at, total) {
    return total >= 120 ? `${Math.floor(at / 60)} of ${Math.round(total / 60)} min` : `${clock(at)} of ${clock(total)}`;
  }
  var pace = {
    id: "",
    seen: [],
    see(r) {
      const now = Date.now();
      if (this.id !== r.id) this.id = r.id, this.seen = [];
      this.seen = this.seen.filter(([t, p]) => now - t < 3e4 && p <= r.progress);
      this.seen.push([now, r.progress]);
    },
    left(r) {
      const first = this.seen[0];
      if (this.id !== r.id || !first) return "";
      const spent = (Date.now() - first[0]) / 1e3;
      const done2 = r.progress - first[1];
      if (spent < 8 || done2 < 0.01) return "";
      const left = (1 - r.progress) * spent / done2;
      return left < 60 ? "under a minute left" : `about ${Math.round(left / 60)} min left`;
    }
  };
  async function patch(changes) {
    try {
      const t = await api("PATCH", `/transcripts/${tx.openId}`, changes);
      const recount = t.utterances.length !== tx.transcript?.utterances.length;
      tx.transcript = t;
      if (recount) redrawPage();
    } catch (error) {
      fault(error);
    }
  }
  function actions(t) {
    const copy = btn([icon("copy"), "Copy"], async () => {
      try {
        await window.tutorHost.call({ call: "copy", text: await api("GET", `/transcripts/${t.id}/text?format=txt`) });
        toast("The text is copied");
      } catch (error) {
        fault(error);
      }
    });
    const menu = tx.exporting ? el(
      "div",
      { class: "menu", role: "menu" },
      ...FORMATS.map(
        ([format, label]) => el(
          "button",
          {
            class: "mi",
            role: "menuitem",
            onclick: async () => {
              tx.exporting = false;
              redrawPage();
              try {
                const path = await window.tutorHost.call({ call: "exportTranscript", id: t.id, format, name: t.title });
                if (path) toast(`Saved: ${fileName(path)}`, showFile(path));
              } catch (error) {
                fault(error);
              }
            }
          },
          label
        )
      )
    ) : null;
    const exporter = el(
      "span",
      { class: "menuwrap" },
      btn([icon("desktop-download"), "Export", icon("chevron-down")], (event) => {
        event.stopPropagation();
        tx.exporting = !tx.exporting;
        redrawPage();
      }),
      menu
    );
    const toKb = t.source !== "note" ? btn([icon("book"), "To knowledge base"], async () => {
      try {
        const { path } = await api("POST", `/transcripts/${t.id}/to-kb`);
        toast(`In the knowledge base: ${fileName(path)}`, showFile(path));
      } catch (error) {
        const choose = error instanceof SpeechError && error.status === 409;
        toast(problem(error), choose ? { label: "Choose a folder", run: () => void pickKb() } : void 0, true);
      }
    }) : null;
    const del = tx.deleting ? el(
      "span",
      { class: "confirm" },
      el("small", {}, "Delete for good?"),
      btn("Delete", () => void remove(t.id), "danger"),
      linkBtn("Keep", () => (tx.deleting = false, redrawPage()))
    ) : el("button", { class: "ib del", title: "Delete", "aria-label": "Delete", onclick: () => (tx.deleting = true, redrawPage()) }, icon("trash"));
    return el("div", { class: "tools tacts" }, copy, exporter, toKb, el("span", { class: "gap" }), del);
  }
  window.addEventListener("click", (event) => {
    if (!tx.exporting || event.target.closest?.(".menuwrap")) return;
    tx.exporting = false;
    redrawPage();
  });
  async function remove(id) {
    try {
      await api("DELETE", `/transcripts/${id}`);
      toast("Deleted");
      openTranscript("");
    } catch (error) {
      fault(error);
    }
  }
  function notices(v, r, t) {
    const out = [];
    const note = t.note;
    if (note) {
      out.push(
        aside("book-open", "In the knowledge base: ", el("b", {}, fileName(note)), " ", linkBtn("Open", () => post({ type: "openPath", path: note })), linkBtn("Show in folder", () => post({ type: "showInFolder", path: note })))
      );
    }
    if (t.noteError) out.push(aside("info", t.noteError, " ", linkBtn("Choose a folder", () => void pickKb())));
    if (r.error) out.push(aside("circle-alert", r.error));
    const speakers = speakersNotice(v, t);
    if (speakers) out.push(speakers);
    return out;
  }
  function splitWay(t) {
    if (t.source === "note" || t.speakersStatus === "ok") return null;
    if (t.hasWords) return "words";
    return t.source === "file" || t.source === "mic" ? "redo" : null;
  }
  function speakersNotice(v, t) {
    if (t.source === "note" || t.speakersStatus === "ok" || t.speakersStatus === "single") return null;
    const meet = t.source === "meet" ? " Your microphone is Me; the call\u2019s voices are one speaker." : "";
    const why = t.speakersStatus === "failed" ? "Speakers could not be told apart; the text is one stream." : t.speakersStatus === "no-part" ? `Speakers are not told apart: who spoke when was not installed yet.${meet}` : `Speakers are not told apart: the voices\u2019 model needed a Hugging Face key.${meet}`;
    const missing = speakersMissing(v, () => hooks.setup());
    if (missing) return aside("users", why, " ", linkBtn("Set up speakers", () => hooks.setup()));
    const way = splitWay(t);
    if (!way) return aside("users", `${why} This meeting can no longer be split: its words were not kept.`);
    const run = () => void splitSpeakers(t.id);
    if (way === "words") return aside("users", `${why} The text is not recognized again; edits stay.`, " ", linkBtn("Split by speaker", run));
    const minutes2 = Math.max(1, Math.round(t.duration / 3600 * minutesPerHour(v)));
    if (tx.redoing) {
      return aside(
        "users",
        t.edited ? "Edits to the text will be lost. Go on?" : "Go on?",
        " ",
        linkBtn("Transcribe again", run),
        linkBtn("Not now", () => (tx.redoing = false, redrawPage()))
      );
    }
    return aside("users", `${why} It can be transcribed again, with speakers: about ${minutes2} min.`, " ", linkBtn("Transcribe again", () => (tx.redoing = true, redrawPage())));
  }
  async function splitSpeakers(id) {
    tx.redoing = false;
    try {
      await api("POST", `/transcripts/${id}/speakers`, {});
      if (tx.openId === id && tx.row) {
        tx.row = { ...tx.row, status: "queued", progress: 0, stage: "" };
        redrawPage();
      }
    } catch (error) {
      fault(error);
    }
  }
  function speakerClass(t, key) {
    if (key === "me") return "sp-me";
    return `sp-${Object.keys(t.speakers).filter((k) => k !== "me").indexOf(key) % 6 + 1}`;
  }
  function speakersStrip(t) {
    const keys = Object.keys(t.speakers);
    if (keys.length < 2) return null;
    const strip = el("div", { class: "spk" });
    for (const key of keys) {
      const name = t.speakers[key]?.name ?? key;
      const chipNode = el("button", { class: `chip sp ${speakerClass(t, key)}`, title: "Rename" }, el("i", { class: "sw" }), name);
      chipNode.addEventListener("click", () => {
        const input = el("input", { type: "text", class: "field", value: name, "aria-label": "Speaker\u2019s name" });
        let done2 = false;
        const finish = (keep) => {
          if (done2) return;
          done2 = true;
          const next = input.value.trim();
          const s = t.speakers[key];
          if (keep && next && s && next !== s.name) {
            s.name = next;
            void patch({ speakers: { [key]: next } });
            for (const who of document.querySelectorAll(`.who[data-speaker="${key}"]`)) who.textContent = next;
            chipNode.lastChild.textContent = next;
          }
          input.replaceWith(chipNode);
        };
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") finish(true);
          if (event.key === "Escape") event.preventDefault(), finish(false);
        });
        input.addEventListener("blur", () => finish(true));
        chipNode.replaceWith(input);
        input.select();
      });
      strip.append(chipNode);
    }
    strip.append(el("small", {}, "tap a name to rename"));
    return strip;
  }
  function speakerMenu(t, i, label) {
    document.querySelector(".whomenu")?.remove();
    const menu = el(
      "div",
      { class: "menu whomenu", role: "menu" },
      ...Object.entries(t.speakers).map(
        ([key, s]) => el(
          "button",
          {
            class: `mi ${speakerClass(t, key)}`,
            role: "menuitem",
            onclick: () => {
              menu.remove();
              const u = t.utterances[i];
              if (!u || u.speaker === key) return;
              u.speaker = key;
              void patch({ utterances: { [i]: { speaker: key } } }).then(redrawPage);
            }
          },
          el("i", { class: "sw" }),
          s.name
        )
      )
    );
    label.after(menu);
    window.setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }));
  }
  function utterances(t) {
    const many2 = Object.keys(t.speakers).length > 1;
    const list2 = el("div", { class: "utts" });
    t.utterances.forEach((u, i) => {
      const first = i === 0 || t.utterances[i - 1]?.speaker !== u.speaker;
      const text = el("div", {
        class: "ut",
        contenteditable: "plaintext-only",
        spellcheck: "false",
        onkeydown: (event) => {
          const e = event;
          const node = e.target;
          if (e.key === "Enter" && !e.shiftKey) e.preventDefault(), node.blur();
          if (e.key === "Escape") e.preventDefault(), node.textContent = t.utterances[i]?.text ?? "", node.blur();
        },
        onblur: (event) => {
          const value = event.target.textContent?.trim() ?? "";
          const now = t.utterances[i];
          if (now && value !== now.text) {
            now.text = value;
            void patch({ utterances: { [i]: { text: value } } });
          }
        }
      });
      text.textContent = u.text;
      const who = many2 && first ? el("button", { class: "who", "data-speaker": u.speaker, title: "Another speaker" }, t.speakers[u.speaker]?.name ?? u.speaker) : null;
      who?.addEventListener("click", (event) => (event.stopPropagation(), speakerMenu(t, i, who)));
      list2.append(
        el(
          "div",
          { class: `utt${first ? " first" : ""}${who ? " has-who" : ""}${i === heard ? " now" : ""} ${speakerClass(t, u.speaker)}`, "data-i": String(i) },
          el("button", { class: "at", title: "Listen from here", onclick: () => seek(u.start) }, clock(u.start)),
          el("div", { class: "ub" }, who, text)
        )
      );
    });
    return list2;
  }
  var audio;
  var audioId = "";
  var heard = -1;
  function stopPlayer() {
    audio?.pause();
    audio?.removeAttribute("src");
    audio = void 0;
    audioId = "";
    heard = -1;
  }
  function soundOf(v, t) {
    if (audio && audioId === t.id) return audio;
    stopPlayer();
    const a = new Audio(`http://127.0.0.1:${v.speech.port}/transcripts/${encodeURIComponent(t.id)}/audio`);
    a.preload = "metadata";
    const sync = () => {
      for (const p of document.querySelectorAll(".player")) {
        const playing = !a.paused;
        p.classList.toggle("playing", playing);
        p.querySelector(".pp")?.replaceChildren(icon(playing ? "debug-pause" : "play"));
        const time = p.querySelector(".ptime");
        if (time) time.textContent = `${clock(a.currentTime)} / ${clock(t.duration)}`;
        const range = p.querySelector(".scrub");
        if (range && document.activeElement !== range) range.value = String(Math.round(a.currentTime * 10));
      }
      mark(t, a.currentTime, !a.paused);
    };
    a.addEventListener("play", sync);
    a.addEventListener("pause", sync);
    a.addEventListener("timeupdate", sync);
    audio = a;
    audioId = t.id;
    return a;
  }
  function seek(at) {
    if (!audio) return;
    audio.currentTime = Math.max(0, at - 0.3);
    void audio.play();
  }
  var SPEEDS = [1, 1.25, 1.5, 2];
  function player(v, t) {
    const a = soundOf(v, t);
    const playing = !a.paused;
    const range = el("input", { type: "range", class: "scrub", min: 0, max: Math.round(t.duration * 10), value: Math.round(a.currentTime * 10), "aria-label": "Position" });
    range.addEventListener("input", () => a.currentTime = Number(range.value) / 10);
    const speed = el("button", { class: "speed", title: "Speed" }, `${a.playbackRate}\xD7`);
    speed.addEventListener("click", () => {
      const next = SPEEDS[(SPEEDS.indexOf(a.playbackRate) + 1) % SPEEDS.length] ?? 1;
      a.playbackRate = next;
      speed.textContent = `${next}\xD7`;
    });
    return el(
      "div",
      { class: playing ? "player playing" : "player" },
      el("button", { class: "pp", title: "Play or pause \xB7 Space", "aria-label": "Play or pause", onclick: () => a.paused ? void a.play() : a.pause() }, icon(playing ? "debug-pause" : "play")),
      el("span", { class: "ptime" }, `${clock(a.currentTime)} / ${clock(t.duration)}`),
      range,
      speed
    );
  }
  function mark(t, at, follow2) {
    let lo = 0;
    let hi = t.utterances.length - 1;
    let found2 = -1;
    while (lo <= hi) {
      const mid = lo + hi >> 1;
      if ((t.utterances[mid]?.start ?? 0) <= at + 0.3) found2 = mid, lo = mid + 1;
      else hi = mid - 1;
    }
    if (found2 === heard) return;
    heard = found2;
    document.querySelector(".utt.now")?.classList.remove("now");
    const node = document.querySelector(`.utt[data-i="${found2}"]`);
    node?.classList.add("now");
    if (follow2 && node && !node.contains(document.activeElement)) node.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  window.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || !audio || !hooks.shown() || !tx.openId) return;
    const target = event.target;
    if (target.isContentEditable || target.matches("input, textarea, select") || target.classList.contains("recording")) return;
    event.preventDefault();
    if (audio.paused) void audio.play();
    else audio.pause();
  });
  window.setInterval(() => {
    const v = hooks.view();
    if (!v || !running(v) || !hooks.shown()) return;
    if (!tx.openId) void loadRows();
    else if (tx.row && tx.row.status !== "done") void loadTranscript();
  }, 1500);
  function enterTranscripts() {
    if (tx.openId) void loadTranscript();
    else void loadRows();
  }

  // src/webview/app.ts
  var save = (patch2) => post({ type: "saveSettings", patch: patch2 });
  var RELEASES = "https://github.com/ikstro/krya/releases";
  var ACTIONS = ["listen", "translate", "check", "screen", "dictate", "transcribe", "keyboard"];
  var isAction = (name) => ACTIONS.includes(name);
  var ICONS = { listen: "volume-2", translate: "languages", check: "graduation-cap", screen: "scan", dictate: "mic", transcribe: "audio-lines", keyboard: "keyboard" };
  var TITLES = {
    listen: "Listen",
    translate: "Translate",
    check: "Check",
    screen: "Screen",
    dictate: "Dictate",
    transcribe: "Transcribe",
    keyboard: "Keyboard",
    words: "Words",
    mistakes: "Mistakes",
    transcripts: "Transcripts",
    translations: "Translations",
    phrases: "Phrases",
    vocabulary: "Words to spell",
    kept: "Kept as typed",
    learned: "Learned words",
    programs: "Programs",
    layouts: "Layouts",
    settings: "Settings",
    engine: "Speech engine",
    storage: "Storage",
    computer: "This computer",
    about: "About",
    search: "Search"
  };
  var view;
  var askedTab;
  var askedTranscript = "";
  var search = "";
  var finding = "";
  var keyTrouble;
  var programOpen = "";
  var runningApps = [];
  var reduced = matchMedia("(prefers-reduced-motion: reduce)");
  var frozenAt = (name) => {
    const m = new RegExp(`(?:^#|&)${name}=([\\d.]+)`).exec(location.hash);
    return m ? parseFloat(m[1]) : void 0;
  };
  var FROZEN_T = frozenAt("t");
  var clamp = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
  var prog = (t, a, b) => clamp((t - a) / (b - a));
  var lerp = (a, b, p) => a + (b - a) * p;
  var spring = (x) => x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-8 * x) * (Math.cos(8.5 * x) + 8 / 8.5 * Math.sin(8.5 * x));
  var pop = (x) => x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-6.5 * x) * Math.cos(10 * x);
  var root = document.getElementById("root");
  var mainCol = el("section", { class: "main" });
  function rel(node) {
    const w = mainCol.getBoundingClientRect();
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
  var MEET_KEY = "Alt+Shift+M";
  function keyLines(action, s) {
    switch (action) {
      case "listen":
        return [{ label: "selection", hotkey: s.selectKey || (s.doubleCopy ? COPY_TWICE : ""), chain: "listen" }];
      case "translate":
        return [
          { label: "selection", hotkey: s.translateKey, chain: "translate" },
          ...s.typeKey ? [{ label: "type", hotkey: s.typeKey }] : [],
          { label: "paste back", hotkey: "Enter" }
        ];
      case "check":
        return [
          { label: "selection", hotkey: s.checkKey },
          ...s.typeCheckKey ? [{ label: "type", hotkey: s.typeCheckKey }] : [],
          { label: "by voice", hotkey: s.practiceKey }
        ];
      case "screen":
        return [
          { label: "listen", hotkey: s.snipKey },
          { label: "translate", hotkey: s.textKey }
        ];
      case "dictate":
        return [
          { label: "dictate", hotkey: s.dictateKey },
          { label: "note", hotkey: s.noteKey }
        ];
      case "transcribe":
        return [{ label: "in Meet", hotkey: MEET_KEY }];
      case "keyboard":
        return [
          { label: "switch", hotkey: s.switchKey },
          { label: "fix", hotkey: s.fixKey, chain: "fix" }
        ];
    }
  }
  function keysOf(action, s, chained = false, setOnly = false) {
    return keyLines(action, s).filter((k) => !setOnly || k.hotkey).flatMap((k) => [el("span", { class: "kl" }, k.label), caps(k.hotkey, chained ? k.chain : void 0)]);
  }
  function cycleOf(v) {
    const chosen = v.settings.layouts.map((id) => v.layouts.find((l) => l.id === id)).filter((l) => !!l);
    if (chosen.length > 0) return chosen;
    const languages2 = myLanguages(v.settings);
    const mine = v.layouts.filter((l) => languages2.includes(l.lang));
    return mine.length >= 2 ? mine : v.layouts;
  }
  var naturalOn = (v) => v.natural.status === "ready" && (v.settings.voice === "" || v.settings.voice.startsWith(NATURAL_PREFIX));
  var pairOf = (v) => `${v.settings.native} \u21C4 English`;
  function engineCap(v) {
    const p = v.speech.pack;
    if (p.status === "installing" && !installed(v)) return `downloading ${Math.round((p.progress ?? 0) * 100)}%`;
    if (!installed(v)) return "downloads once";
    if (!running(v)) return "speech to text";
    const c = v.speech.plan.dictation.chosen;
    return `speech to text \xB7 on your ${c.device === "cuda" ? "graphics card" : "processor"}`;
  }
  function actionText(action, v) {
    const title = TITLES[action];
    switch (action) {
      case "listen":
        return { title, cap: naturalOn(v) ? "natural voice" : "Windows voice", desc: "Reads English text aloud and shows its translation." };
      case "translate":
        return { title, cap: pairOf(v), desc: "Translates the selected text; Enter pastes the translation back." };
      case "check":
        return { title, cap: checkCap(v), desc: "Marks the mistakes in your English and shows the fix." };
      case "screen":
        return { title, cap: "text from the screen", desc: "Draw a box around text you can\u2019t select, then listen or translate." };
      case "dictate":
        return { title, cap: engineCap(v), desc: `Speak and it types where the cursor is. Speak ${v.settings.native}, get English.` };
      case "transcribe":
        return { title, cap: "files \xB7 microphone \xB7 Meet", desc: "Talks and meetings into text, speaker by speaker." };
      case "keyboard":
        return {
          title,
          cap: cycleOf(v).map((l) => l.short).join(" \xB7 "),
          desc: v.settings.autoFix ? "Fixes words typed in the wrong layout as you type." : "Switches the layout and fixes text typed in the wrong one."
        };
    }
  }
  var many = (n) => n ? String(n) : "";
  var NAV = [
    { label: "", items: [{ page: "home", icon: "house", title: "Home" }] },
    { label: "Actions", items: ACTIONS.map((a) => ({ page: a, icon: ICONS[a], title: TITLES[a] })) },
    {
      label: "Library",
      items: [
        { page: "words", icon: "book-open", title: "Words", value: (v) => many(v.words.length) },
        { page: "mistakes", icon: "list-checks", title: "Mistakes", value: (v) => many(v.mistakes.length) },
        { page: "transcripts", icon: "file-text", title: "Transcripts" },
        { page: "translations", icon: "clock", title: "Translations", value: (v) => many(v.translations.length) },
        { page: "phrases", icon: "message-square-text", title: "Phrases", value: (v) => many(v.dictation.recent.length) }
      ]
    },
    {
      label: "Your lists",
      items: [
        { page: "vocabulary", icon: "spell-check", title: "Words to spell", value: (v) => many(v.settings.vocabulary.length) },
        { page: "kept", icon: "lock", title: "Kept as typed", value: (v) => many(v.settings.keepWords.length) },
        { page: "learned", icon: "sparkles", title: "Learned words", value: (v) => many(v.learned.alwaysFix.length + v.learned.myWords.length) },
        { page: "programs", icon: "monitor", title: "Programs", value: (v) => many(v.settings.apps.length) },
        { page: "layouts", icon: "list-ordered", title: "Layouts", value: (v) => cycleOf(v).map((l) => l.short).join("\xB7") }
      ]
    },
    {
      label: "Krya",
      items: [
        { page: "settings", icon: "settings", title: "Settings" },
        { page: "engine", icon: "hard-drive", title: "Speech engine" },
        { page: "storage", icon: "database", title: "Storage", value: (v) => v.storage?.parts.length ? size(downloadsMb(v.storage)) : "" },
        { page: "computer", icon: "cpu", title: "This computer" },
        { page: "about", icon: "info", title: "About" }
      ]
    }
  ];
  var findField = el("input", {
    type: "text",
    placeholder: "Search settings",
    spellcheck: "false",
    autocomplete: "off",
    "aria-label": "Search settings",
    oninput: () => find(findField.value),
    onkeydown: (event) => {
      const key = event.key;
      if (key === "Escape") {
        event.preventDefault();
        findField.value = "";
        find("");
        findField.blur();
      } else if (key === "Enter") {
        event.preventDefault();
        pBody.querySelector(".row.found")?.click();
      }
    }
  });
  var tree = el("nav", { class: "tree" });
  var navValues = /* @__PURE__ */ new Map();
  for (const g of NAV) {
    if (g.label) tree.append(el("div", { class: "gl" }, g.label));
    for (const i of g.items) {
      const value = el("span", { class: "v" });
      navValues.set(i.page, value);
      const page = i.page;
      tree.append(el("button", { class: "it", "data-nav": page, title: i.title, onclick: () => page === "home" ? goHome() : go(page) }, lucide(i.icon), el("span", { class: "lb" }, i.title), value));
    }
  }
  var side = el(
    "aside",
    { class: "side" },
    // The text logo; a narrow sidebar has room for the icon only.
    el("div", { class: "brand" }, logo(), tile(28)),
    el("label", { class: "find", title: "Search settings (Ctrl+F)" }, lucide("search", "s"), findField, el("span", { class: "key" }, "Ctrl F")),
    tree
  );
  var maxButton = el("button", { class: "icon-btn max", title: "Maximize", "aria-label": "Maximize", onclick: () => post({ type: "window", action: "maximize" }) }, glyph("maximize"));
  var winButtons = el(
    "div",
    { class: "wbtns" },
    el("button", { class: "icon-btn", title: "Minimize", "aria-label": "Minimize", onclick: () => post({ type: "window", action: "minimize" }) }, glyph("minimize")),
    maxButton,
    el("button", { class: "icon-btn", title: "Close", "aria-label": "Close", onclick: () => post({ type: "window", action: "close" }) }, glyph("close"))
  );
  function windowState(maximized) {
    const label = maximized ? "Restore" : "Maximize";
    maxButton.replaceChildren(glyph(maximized ? "restore" : "maximize"));
    maxButton.title = label;
    maxButton.setAttribute("aria-label", label);
    root.classList.toggle("maxed", maximized);
  }
  var pBack = el("button", { class: "icon-btn back", title: "Back (Esc)", "aria-label": "Back", onclick: () => back() }, lucide("arrow-left", "s"));
  var pTitle = el("div", { class: "ptitle" });
  var pCap = el("span", { class: "pcap" });
  var pKeys = el("div", { class: "pkeys" });
  var barMark = el("div", { class: "brand bb" }, logo());
  var top = el("header", { class: "top" }, barMark, pBack, pTitle, pCap, el("span", { class: "gap" }), pKeys, winButtons);
  var home = el("main", { class: "home" });
  var pBody = el("div", { class: "pbody" });
  mainCol.append(top, home, pBody);
  root.append(side, mainCol);
  var making;
  function updateNav() {
    const lit = open?.name ?? "home";
    for (const b of tree.querySelectorAll(".it")) b.classList.toggle("on", b.dataset.nav === lit);
    const v = view;
    if (!v) return;
    for (const g of NAV) for (const i of g.items) if (i.value) navValues.get(i.page)?.replaceChildren(i.value(v));
    const busy3 = running(v) ? v.speech.health?.busy : null;
    const live = navValues.get("transcripts");
    if (!live) return;
    live.classList.toggle("live", !!busy3);
    live.title = busy3 ? "A transcript is being made" : "";
    live.replaceChildren(...busy3 ? [el("span", { class: "dot" }), making?.id === busy3 ? `${Math.round(making.progress * 100)}%` : ""] : []);
  }
  async function followMaking() {
    const id = view && running(view) ? view.speech.health?.busy : null;
    if (!id) {
      if (making) making = void 0, updateNav();
      return;
    }
    if (document.hidden) return;
    try {
      const r = await api("GET", `/transcripts/${id}`);
      making = r.row.status === "done" ? void 0 : { id, progress: r.row.progress };
    } catch {
    }
    updateNav();
  }
  window.setInterval(() => void followMaking(), 3e3);
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
    const sp = v.speech;
    const speech = !installed(v) ? sp.pack.status === "installing" ? [", ", el("b", {}, "speech"), ` ${Math.round((sp.pack.progress ?? 0) * 100)}%`] : [] : [", ", el("b", {}, "speech"), running(v) ? " ready" : sp.service === "down" ? " stopped" : " starting"];
    return [el("b", {}, pairOf(v)), ` ${translator}, `, ...voice, ...speech, ". Everything runs on this computer."];
  }
  function homeRow(action, v) {
    const t = actionText(action, v);
    const open2 = () => go(action);
    return el(
      "li",
      {
        class: "act",
        "data-page": action,
        role: "button",
        tabindex: 0,
        onclick: open2,
        onkeydown: (event) => {
          const key = event.key;
          if (key === "Enter" || key === " ") event.preventDefault(), open2();
        }
      },
      lucide(ICONS[action]),
      el("div", {}, el("div", { class: "an" }, el("b", {}, t.title), el("i", {}, t.cap)), el("div", { class: "ad" }, t.desc)),
      el("div", { class: "keys" }, ...keysOf(action, v.settings, true)),
      lucide("chevron-right", "chev")
    );
  }
  function pausedNotice(v) {
    if (!v.settings.paused) return null;
    return el(
      "div",
      { class: "row notice paused" },
      lucide("pause"),
      el("div", { class: "l" }, "Krya is paused", el("small", {}, "shortcuts and layout fixing are off until you resume")),
      btn("Resume", () => save({ paused: false }), "primary")
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
      pausedNotice(v),
      el("ul", { class: "acts" }, ...ACTIONS.map((a) => homeRow(a, v))),
      el("p", { class: "foot" }, "Tap an action to change its keys.")
    ].filter((n) => n !== null);
  }
  function renderHome(force = false) {
    if (!view || moment) return;
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
    const step2 = (n, hotkey, what) => {
      const keys = caps(hotkey);
      const small = el("small", {}, el("em", {}, String(n)), what);
      return { keys, small, node: el("div", { class: "step" }, keys, small) };
    };
    const sf = step2(1, s.fixKey, "fix"), st = step2(2, s.translateKey, "translate"), sl = step2(3, listenKey, "listen");
    const rail = el("div", { class: "rail" }, sf.node, st.node, sl.node);
    const stage = el("div", { class: "stage" }, eyebrow, t1, t2, line, line2, play, rail);
    stage.style.top = `${Math.round(Math.max(-40, Math.min(80, (mainCol.clientHeight - 620) / 2)))}px`;
    mainCol.append(stage);
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
    const fade2 = 1 - prog(t, TRAVEL, TRAVEL + 0.25);
    m.eyebrow.style.opacity = String(fade2);
    for (const s of m.smalls) s.style.opacity = String(fade2);
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
    closePage();
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
  var open;
  var visited = [];
  var samePlace = (a, b) => a?.name === b?.name && a?.sub === b?.sub;
  var scroller = () => open ? pBody : home;
  function go(name, sub, flash = "") {
    if (!view) return;
    const next = sub ? { name, sub } : { name };
    if (samePlace(open, next)) return flash ? flashRow(flash) : void 0;
    visited.push({ place: open && { ...open }, scroll: scroller().scrollTop });
    if (visited.length > 50) visited.shift();
    show(next, open?.name === name ? sub ? 1 : -1 : 0);
    if (flash) flashRow(flash);
  }
  function goHome() {
    if (!open) return;
    visited.push({ place: { ...open }, scroll: pBody.scrollTop });
    show(void 0, 0);
  }
  function closePage() {
    if (open) show(void 0, 0);
  }
  function back() {
    if (open?.name === "transcripts" && !open.sub && backToList()) return;
    let last = visited.pop();
    while (last && samePlace(last.place, open)) last = visited.pop();
    if (!last) return closePage();
    const from = open;
    const dir = last.place && from && last.place.name === from.name ? from.sub && !last.place.sub ? -1 : 1 : 0;
    show(last.place, dir, last.scroll);
    if (dir === -1 && from?.sub) pBody.querySelector(`[data-sub="${from.sub}"]`)?.focus({ preventScroll: true });
  }
  function show(place, dir, scroll = 0) {
    if (!view) return;
    if (moment) finishMoment();
    const was = open;
    if (was?.name === "transcripts" && place?.name !== "transcripts") leaveTranscripts();
    open = place;
    keyTrouble = void 0;
    if (place?.name !== was?.name) search = "";
    findField.value = place?.name === "search" ? finding : "";
    if (place?.name === "transcripts" && was?.name !== "transcripts") enterTranscripts();
    if (place?.name === "programs" && !place.sub) askRunningApps();
    if (place?.name === "storage" && was?.name !== "storage") post({ type: "storage" });
    root.classList.toggle("page-open", !!place);
    fillHeader();
    updateNav();
    if (!place) {
      renderHome();
      home.scrollTop = scroll;
      return fade(home);
    }
    if (dir && was) slideBody(dir);
    else {
      bodyPending = false;
      pBody.replaceChildren(...bodyOf(view));
      fade(pBody);
    }
    pBody.scrollTop = scroll;
  }
  function fade(node) {
    if (reduced.matches) return;
    node.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 160, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
  }
  function flashRow(title) {
    const row2 = [...pBody.querySelectorAll(".row")].find((r) => lineTitle(r) === title);
    if (!row2) return;
    row2.scrollIntoView({ block: "center" });
    row2.classList.add("flash");
    window.setTimeout(() => row2.classList.remove("flash"), 1600);
  }
  var SUBS = {
    model: { title: "Speech model", body: modelPage, valid: running },
    meet: { title: "Google Meet", cap: () => "the Krya extension for Chrome", body: meetPage },
    speakers: { title: "Who spoke when", cap: () => "the voices told apart", body: speakerRows, valid: installed },
    fixing: { title: "Fixing as I type", cap: () => "what else Krya sets right while you type", body: fixingPage },
    program: { title: () => programOpen, body: programPage, valid: () => !!programOpen },
    languages: { title: "Languages you use", body: languagesPage }
  };
  var subTitle = (id) => {
    const t = SUBS[id].title;
    return typeof t === "string" ? t : t();
  };
  var CAPS2 = {
    words: (v) => v.words.length ? `${v.words.length} saved \xB7 from your cards` : "none yet \xB7 from your cards",
    mistakes: () => "from Check \xB7 on this computer",
    transcripts: () => transcriptsCap(),
    translations: () => "kept 30 days on this computer",
    phrases: () => "dictated lately \xB7 kept 30 days on this computer",
    vocabulary: () => "for Dictate and Transcribe",
    kept: () => "never fixed by themselves",
    learned: () => "on this computer only",
    programs: () => "left out of parts, or with a layout of their own",
    layouts: () => "in the order the keys go through them",
    storage: (v) => v.storage?.measuring ? "measuring\u2026" : v.storage ? `${size(v.storage.freeMb)} free on ${v.storage.drive}` : "what Krya keeps on this computer",
    about: (v) => `Krya ${v.version}`
  };
  var sliding = [];
  function slideBody(dir) {
    if (!view || !open) return;
    for (const a of sliding) a.finish();
    sliding = [];
    const ghost = el("div", { class: "pbody pghost", inert: true, "aria-hidden": "true" });
    const scroll = pBody.scrollTop;
    ghost.append(...pBody.childNodes);
    mainCol.append(ghost);
    ghost.scrollTop = scroll;
    bodyPending = false;
    pBody.replaceChildren(...bodyOf(view));
    if (reduced.matches) return ghost.remove();
    const easing = "cubic-bezier(0.2, 0.8, 0.2, 1)";
    const duration = 220;
    const out = ghost.animate([{ transform: "none", opacity: 1 }, { transform: `translateX(${-48 * dir}px)`, opacity: 0 }], { duration, easing, fill: "forwards" });
    const inn = pBody.animate([{ transform: `translateX(${48 * dir}px)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration, easing });
    out.onfinish = () => ghost.remove();
    sliding = [out, inn];
  }
  function openSub(id) {
    if (open) go(open.name, id);
  }
  function fillHeader() {
    if (!view) return;
    const v = view;
    pBack.hidden = !open && visited.length === 0;
    if (!open) {
      pTitle.replaceChildren("Home");
      pCap.textContent = "";
      pKeys.replaceChildren();
      return;
    }
    const name = open.name;
    if (open.sub) {
      const sub = SUBS[open.sub];
      pTitle.replaceChildren(el("button", { class: "pcrumb", onclick: () => go(name) }, TITLES[name]), el("span", { class: "psep" }, "\u203A"), subTitle(open.sub));
      pCap.textContent = sub.cap?.(v) ?? "";
      pKeys.replaceChildren();
      return;
    }
    pTitle.replaceChildren(TITLES[name]);
    pCap.textContent = isAction(name) ? actionText(name, v).cap : name === "search" ? searchCap(v) : CAPS2[name]?.(v) ?? "";
    const keys = isAction(name) ? keysOf(name, v.settings, false, true) : [];
    const next = el("div", {}, ...keys);
    if (next.innerHTML !== pKeys.innerHTML) pKeys.replaceChildren(...next.childNodes);
  }
  var bodyPending = false;
  var pointerDown = false;
  function busy2() {
    const a = document.activeElement;
    return !!a && pBody.contains(a) && (a.matches("input[type=text]:not([data-live]), input[type=search], input[type=password], input[type=range]") || a.isContentEditable || a.classList.contains("recording"));
  }
  function carryFields(next) {
    const carried = [];
    for (const old of pBody.querySelectorAll("input[data-live]")) {
      if (!old.value && document.activeElement !== old) continue;
      const fresh = next.querySelector(`input[data-live="${old.dataset.live}"]`);
      if (!fresh) continue;
      fresh.replaceWith(old);
      carried.push(old);
    }
    return carried;
  }
  function renderBody() {
    if (!view || !open) return;
    if (open.sub && SUBS[open.sub].valid?.(view) === false) {
      open.sub = void 0;
      fillHeader();
    }
    const next = el("div", {}, ...bodyOf(view));
    if (next.innerHTML === pBody.innerHTML) return;
    if (busy2()) {
      bodyPending = true;
      return;
    }
    bodyPending = false;
    const scroll = pBody.scrollTop;
    const focused = document.activeElement;
    const carried = carryFields(next);
    pBody.replaceChildren(...next.childNodes);
    pBody.scrollTop = scroll;
    const live = carried.find((f) => f === focused);
    if (live) live.focus({ preventScroll: true });
  }
  pBody.addEventListener("focusout", () => {
    if (!bodyPending) return;
    const later = () => window.setTimeout(renderBody, 0);
    if (pointerDown) window.addEventListener("pointerup", later, { once: true });
    else later();
  });
  window.addEventListener("pointerdown", () => pointerDown = true, true);
  window.addEventListener("pointerup", () => pointerDown = false, true);
  function bodyOf(v) {
    if (!open) return [];
    if (open.sub) return SUBS[open.sub].body(v);
    switch (open.name) {
      case "listen":
        return listenPage(v);
      case "translate":
        return translatePage(v);
      case "check":
        return checkPage(v);
      case "screen":
        return screenPage(v);
      case "dictate":
        return dictatePage(v);
      case "transcribe":
        return transcribePage(v);
      case "keyboard":
        return keyboardPage(v);
      case "words":
        return wordsPage(v);
      case "mistakes":
        return mistakesPage(v);
      case "transcripts":
        return transcriptsBody(v);
      case "translations":
        return translationsPage(v);
      case "phrases":
        return recentPage(v);
      case "vocabulary":
        return vocabularyPage(v);
      case "kept":
        return keptPage(v);
      case "learned":
        return learnedPage(v);
      case "programs":
        return programsPage(v);
      case "layouts":
        return layoutsPage(v);
      case "settings":
        return settingsPage(v);
      case "engine":
        return enginePage(v);
      case "storage":
        return storagePage(v);
      case "computer":
        return computerPage(v);
      case "about":
        return aboutPage(v);
      case "search":
        return searchPage(v);
    }
  }
  var SEARCHED = [
    ...ACTIONS.map((name) => ({ name })),
    { name: "keyboard", sub: "fixing" },
    { name: "dictate", sub: "model" },
    { name: "transcribe", sub: "model" },
    { name: "transcribe", sub: "speakers" },
    { name: "transcribe", sub: "meet" },
    { name: "vocabulary" },
    { name: "kept" },
    { name: "learned" },
    { name: "programs" },
    { name: "layouts" },
    { name: "settings" },
    { name: "settings", sub: "languages" },
    { name: "engine" },
    { name: "storage" },
    { name: "computer" }
  ];
  var lineTitle = (row2) => (row2.querySelector(":scope > .l")?.firstChild?.textContent ?? "").trim();
  function bodyFor(v, place) {
    const was = open;
    open = place;
    try {
      return bodyOf(v);
    } catch {
      return [];
    } finally {
      open = was;
    }
  }
  var lineCache;
  function linesOf(v) {
    if (lineCache?.view === v) return lineCache.lines;
    const lines = [];
    for (const place of SEARCHED) {
      if (place.sub && SUBS[place.sub].valid?.(v) === false) continue;
      let section = "";
      for (const node of bodyFor(v, place)) {
        if (node.classList.contains("grp")) {
          section = (node.firstChild?.textContent ?? "").trim();
          continue;
        }
        for (const row2 of node.matches(".row") ? [node] : [...node.querySelectorAll(".row")]) {
          const title = lineTitle(row2);
          const note = [...row2.querySelectorAll(":scope > .l > small")].map((s) => s.textContent ?? "").join(" \xB7 ");
          if (title) lines.push({ place, section, title, note });
        }
      }
    }
    lineCache = { view: v, lines };
    return lines;
  }
  var found = (v) => {
    const q = finding.trim().toLowerCase();
    return q ? linesOf(v).filter((l) => `${l.title} ${l.note}`.toLowerCase().includes(q)) : [];
  };
  function searchCap(v) {
    const n = found(v).length;
    return finding.trim() ? `${n || "no"} ${n === 1 ? "place" : "places"} for \u201C${finding.trim()}\u201D` : "";
  }
  function whereOf(place) {
    return place.sub ? `${TITLES[place.name]} \u203A ${subTitle(place.sub)}` : TITLES[place.name];
  }
  function marked(text, q) {
    const i = text.toLowerCase().indexOf(q);
    return i < 0 ? [text] : [text.slice(0, i), el("mark", {}, text.slice(i, i + q.length)), text.slice(i + q.length)];
  }
  function searchPage(v) {
    const q = finding.trim().toLowerCase();
    const hits = found(v);
    if (!hits.length) return [aside("search", q ? `Nothing has \u201C${finding.trim()}\u201D. Words, transcripts and translations have searches of their own.` : "Type above: every line of every page is found by its name or its note.")];
    const out = [];
    let last = "";
    for (const hit of hits) {
      const where2 = whereOf(hit.place);
      if (where2 !== last) out.push(grp(where2));
      last = where2;
      out.push(
        el(
          "button",
          { class: "row navc found", onclick: () => go(hit.place.name, hit.place.sub, hit.title) },
          el("div", { class: "l" }, el("span", {}, ...marked(hit.title, q)), hit.note ? el("small", {}, ...marked(hit.note, q)) : null),
          hit.section ? el("span", { class: "v" }, hit.section) : null,
          lucide("chevron-right", "chev")
        )
      );
    }
    return out;
  }
  function find(text) {
    finding = text;
    if (!view) return;
    if (!text.trim()) {
      if (open?.name === "search") back();
      return;
    }
    if (open?.name !== "search") return go("search");
    fillHeader();
    bodyPending = false;
    pBody.replaceChildren(...bodyOf(view));
  }
  function tryIt(text, how) {
    return el("div", { class: "try" }, el("p", {}, text), el("small", {}, how));
  }
  var KEY_USE = {
    selectKey: "listening to the selection",
    snipKey: "listening to text on the screen",
    translateKey: "translating the selection",
    textKey: "translating text on the screen",
    inPlaceKey: "replacing the selection with its translation",
    checkKey: "checking your English",
    typeKey: "typing a text to translate",
    typeCheckKey: "typing a text to check",
    switchKey: "switching the layout",
    fixKey: "fixing the layout",
    dictateKey: "dictating",
    englishKey: "dictating in English",
    noteKey: "dictating a note",
    againKey: "typing the last phrase again",
    practiceKey: "checking what you say",
    pauseKey: "pausing Krya",
    windowKey: "opening Krya"
  };
  function keyTakenBy(key, self) {
    const s = view?.settings;
    if (!s || !key) return void 0;
    const other = Object.keys(KEY_USE).find((n) => n !== self && s[n] === key);
    if (other) return KEY_USE[other];
    const layout = Object.entries(s.layoutKeys).find(([id, k]) => id !== self && k === key)?.[0];
    return layout ? `going to ${view?.layouts.find((l) => l.id === layout)?.name ?? "a layout"}` : void 0;
  }
  function saveKey(name, key) {
    const other = keyTakenBy(key, name);
    if (other) {
      keyTrouble = { name, text: `${hotkeyLabel(key)} is already for ${other}.` };
      return renderBody();
    }
    keyTrouble = void 0;
    save({ [name]: key });
  }
  function keyRow(name, label, note, taken = false, iconName, extra) {
    const key = view?.settings[name] ?? "";
    const menu = menuNote(key);
    return keyRecorder(name, key, (key2) => saveKey(name, key2), label, menu ? `${note}; ${menu}` : note, taken, iconName, extra, DEFAULTS[name]);
  }
  function menuNote(key) {
    if (/^(Left|Right)Alt(\*2)?$/.test(key)) return "Alt alone no longer opens menus, F10 does";
    if (/^(Left|Right)Super(\*2)?$/.test(key)) return "Win alone no longer opens Start, Ctrl+Esc does";
    return "";
  }
  function layoutKeyRow(l, label, note) {
    const keys = () => view?.settings.layoutKeys ?? {};
    const set = (key) => {
      const next = { ...keys() };
      if (key) next[l.id] = key;
      else delete next[l.id];
      save({ layoutKeys: next });
    };
    const saveIt = (key) => {
      const other = key ? keyTakenBy(key, l.id) : void 0;
      if (other) {
        keyTrouble = { name: l.id, text: `${hotkeyLabel(key)} is already for ${other}.` };
        return renderBody();
      }
      keyTrouble = void 0;
      set(key);
    };
    return keyRecorder(l.id, keys()[l.id] ?? "", saveIt, label, note, false, "keyboard");
  }
  function keyRecorder(id, current, saveKeyAs, label, note, taken = false, iconName, extra, byDefault = "") {
    const name = id;
    const recorder = new HotkeyRecorder();
    let waiting2;
    const field = el("button", {
      class: "krec",
      title: "Click, then press the keys: Ctrl+Alt+T, Left Ctrl twice, Pause, a mouse side button\u2026",
      "aria-label": `${label}: ${current ? hotkeyLabel(current) : "not set"}. Click to change.`
    });
    field.append(caps(current));
    const showing = (...nodes) => field.replaceChildren(...nodes);
    const done2 = (key) => {
      window.clearTimeout(waiting2);
      field.blur();
      saveKeyAs(key);
    };
    const recorded = (r) => {
      window.clearTimeout(waiting2);
      if (!r) return;
      if (!r.more) return done2(r.hotkey);
      showing(caps(r.hotkey), el("span", { class: "x2" }, "\u2026"));
      waiting2 = window.setTimeout(() => done2(r.hotkey), DOUBLE_MS);
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
      window.clearTimeout(waiting2);
      field.classList.remove("recording");
      showing(caps(current));
    });
    field.addEventListener("keydown", (event) => {
      if (!field.classList.contains("recording")) return;
      event.preventDefault();
      if (event.key === "Escape") return field.blur();
      if (event.repeat) return;
      window.clearTimeout(waiting2);
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
          saveKeyAs("");
        }
      },
      lucide("x", "s")
    ) : null;
    const restore = byDefault && current !== byDefault ? el(
      "button",
      {
        class: "kx",
        title: `Back to ${hotkeyLabel(byDefault)}`,
        "aria-label": `${label}: back to ${hotkeyLabel(byDefault)}`,
        onclick: () => {
          keyTrouble = void 0;
          saveKeyAs(byDefault);
        }
      },
      lucide("rotate-ccw", "s")
    ) : null;
    const trouble = keyTrouble?.name === name ? keyTrouble.text : "";
    const notes = typeof note === "string" ? [note] : note;
    const node = row(
      label,
      [...notes, taken && current ? bad("Taken by another program; choose another.") : null, trouble ? bad(trouble) : null],
      el("span", { class: "kchg" }, field, clear, restore, linkBtn(current ? "Change" : "Set", () => field.click()), extra ?? null)
    );
    if (iconName) node.prepend(lucide(iconName));
    return node;
  }
  var fixedKey = (label, hotkey, note) => row(label, [note], caps(hotkey));
  function listenPage(v) {
    const s = v.settings;
    const how = s.selectKey ? `Select this text, ${usage(s.selectKey)}.` : s.doubleCopy ? "Select this text, press Ctrl + C twice." : "Set a key above or turn on Ctrl + C twice, then select this text.";
    return [
      grp("Keys"),
      keyRow("selectKey", "Listen to the selected text", "select text anywhere, then press the key", !v.keysOk.select, "volume-2"),
      card(
        "copy",
        "Also on Ctrl + C twice",
        ["select text, then press Ctrl + C twice, quickly; works with no key set too"],
        el("span", { class: "kchg" }, caps(COPY_TWICE), el("span", { class: "tgwrap" }, toggleKnob(s.doubleCopy, (doubleCopy) => save({ doubleCopy }), "Ctrl + C twice")))
      ),
      keyRow("snipKey", "Listen to text on the screen", "for text you can\u2019t select: draw a box around it", !v.keysOk.snip, "scan"),
      ...voiceRows(v),
      grp("The card"),
      toggleCard("volume-2", "Read aloud when a card opens", s.autoRead, (autoRead) => save({ autoRead })),
      toggleCard("spell-check", "Dotted line under less common words", s.rareWords, (rareWords) => save({ rareWords })),
      toggleCard("list", "Listen reads one sentence at a time", s.oneAtATime, (oneAtATime) => save({ oneAtATime })),
      card(
        "book-open",
        "Show word meanings on",
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
      grp("In the card"),
      card("play", "Play, stop and step through sentences", [], el("span", { class: "kg2" }, caps("Space"), caps("\u2190"), caps("\u2192"))),
      card("book-open", "Click a word", ["see its meanings, hear it, star it to keep it in Words"], null),
      card("languages", "Click a sentence", ["its translation is marked; \u25B6 in the margin reads one paragraph"], null),
      card("x", "Close the card and stop the voice", [], caps("Esc")),
      tryIt("The morning was quiet. A small boat drifted along the river, and two children watched the ducks from the bridge.", how)
    ].filter((n) => n !== null);
  }
  var TRY_TRANSLATE = {
    Russian: "\u041A\u043E\u043D\u0435\u0447\u043D\u043E, \u043F\u0440\u0438\u0448\u043B\u044E \u043E\u0431\u043D\u043E\u0432\u043B\u0451\u043D\u043D\u044B\u0435 \u043C\u0430\u043A\u0435\u0442\u044B \u0434\u043E \u0441\u043E\u0437\u0432\u043E\u043D\u0430.",
    Ukrainian: "\u0417\u0432\u0456\u0441\u043D\u043E, \u043D\u0430\u0434\u0456\u0448\u043B\u044E \u043E\u043D\u043E\u0432\u043B\u0435\u043D\u0456 \u043C\u0430\u043A\u0435\u0442\u0438 \u0434\u043E \u0434\u0437\u0432\u0456\u043D\u043A\u0430."
  };
  function translatorChip(v) {
    const level = v.settings.translationLevel;
    const from = level === "fast" ? "Mozilla" : "Hugging Face";
    switch (v.translator) {
      case "ready":
        return [chip("ready"), `${LEVEL_NAMES[level]} translation, works offline`];
      case "absent":
        return [chip("on first use", "off"), `downloads from ${from} at the first translation, then works offline`];
      case "downloading":
        return [chip("downloading"), `downloading from ${from}, once`];
      case "failed":
        return [chip("failed", "bad"), "could not download; the next translation tries again"];
      case "unsupported":
        return [chip("not offered", "off"), "no offline translator for this language yet"];
    }
  }
  var LEVEL_ABOUT = {
    fast: "Instant; short phrases may come out word for word",
    accurate: "Understands the whole sentence",
    most: "The best wording, and the slowest"
  };
  var CHECK_ABOUT = {
    accurate: "Catches nearly every mistake, quickly",
    most: "A little more careful, and slower"
  };
  var LEVEL_MODEL = {
    fast: "Firefox Translations",
    accurate: "Gemma 4 E4B",
    most: "Gemma 4 12B"
  };
  var FIT_WHERE = {
    card: "on your graphics card",
    part: "partly on your graphics card",
    processor: "on your processor"
  };
  var FIT_GUESS = {
    card: "about 1\u20132 s per sentence",
    part: "possible, but slow here",
    processor: "possible, but slow here: 30 s or more per text"
  };
  var CUDA_GUESS = "a few seconds for a short text, 15\u201320 s for a long one";
  var CUDA_SIZE = "with NVIDIA\u2019s own build, 670 MB";
  var SLOW_SENTENCE_S = 2;
  var startText = (start3) => start3 !== void 0 ? `; it starts in ${seconds(start3)} after 10 idle minutes` : "";
  function levelFitText(fit, speed) {
    const where2 = FIT_WHERE[fit.where];
    const measured = speed?.sentence === void 0 ? void 0 : { sentence: speed.sentence, start: speed.start };
    if (!measured) return fit.cuda ? `${CUDA_GUESS}, ${where2}` : fit.where === "card" ? `${FIT_GUESS.card} ${where2}` : `${FIT_GUESS[fit.where]}, ${where2}`;
    return `${measured.sentence > SLOW_SENTENCE_S ? "slow here" : "here"}: ${seconds(measured.sentence)} per sentence, ${where2}${startText(measured.start)}`;
  }
  function levelRows(v) {
    const advice = translationAdvice(v.speech.device);
    const inUse = v.settings.translationLevel;
    return ["fast", "accurate", "most"].map((level) => {
      const t = v.translation[level];
      const fit = level === "fast" ? void 0 : advice[level];
      const fetching = t.status === "downloading";
      const notes = [
        `${LEVEL_ABOUT[level]} (${LEVEL_MODEL[level]})`,
        fit && level !== "fast" ? levelFitText(fit, v.modelSpeed[level]) : null,
        level !== "fast" && inUse === "fast" && level === v.settings.model ? "Check my English uses it" : null,
        t.status === "failed" ? bad("the download failed; Use tries again") : t.status === "ready" || fetching ? null : `${size(t.size)} to download ${level === inUse ? "with the next translation" : "when you pick it"}${fit?.cuda ? ` (${CUDA_SIZE})` : ""}`,
        fetching ? bar(t.progress) : null
      ];
      const label = el("span", {}, LEVEL_NAMES[level], advice.advised === level ? el("span", { class: "chip good" }, lucide("check", "s"), "Recommended") : null);
      const control = fetching ? el("span", { class: "pct" }, `${Math.round(t.progress * 100)}%`) : level === inUse ? chip("in use", "lit") : linkBtn("Use", () => post({ type: "translationLevel", level }));
      const remove2 = level !== "fast" && t.status === "ready" ? ib("x", `Remove ${LEVEL_NAMES[level]} (${size(t.size)})`, () => post({ type: "removeModel", model: level })) : null;
      return row(label, notes, control, remove2);
    });
  }
  function translatePage(v) {
    const s = v.settings;
    const [state, note] = translatorChip(v);
    const text = TRY_TRANSLATE[s.native] ?? "Of course, I will send the updated layouts before the call.";
    const how = s.translateKey ? `Select it, ${usage(s.translateKey)}.` : "Set a key above, then select it and press the key.";
    return [
      grp("Keys"),
      keyRow("translateKey", "Translate the selected text", s.translateKey ? `select it anywhere, ${usage(s.translateKey)}` : "select it anywhere, then press one key, such as Left Ctrl twice", !v.keysOk.translate, "languages"),
      keyRow("typeKey", "Type a text to translate", "an empty card by the pointer, from any program; also in the tray menu", !v.keysOk.type, "type"),
      keyRow("inPlaceKey", "Replace the selection with its translation", "no card", !v.keysOk.inPlace, "wand-sparkles"),
      keyRow("textKey", "Translate text on the screen", "for text you can\u2019t select: draw a box around it", !v.keysOk.text, "scan"),
      fixedKey("In the card: paste the translation back", "Enter"),
      grp("Translation"),
      ...levelRows(v),
      aside("info", "Accurate and Most accurate also check your English: the one you pick here is the one Check uses."),
      grp("Languages"),
      card("globe", pairOf(v), [note], state),
      languagesCard(v),
      grp("History"),
      navCard("clock", "Recent translations", "kept for 30 days, on this computer only", v.translations.length ? String(v.translations.length) : "none", () => go("translations"), "translations"),
      tryIt(text, how)
    ];
  }
  function translationsPage(v) {
    const list2 = v.translations;
    return [
      grp("Translations", list2.length || void 0, list2.length ? linkBtn("Clear", () => post({ type: "clearTranslations" })) : null),
      ...list2.length ? list2.map(
        (e) => el(
          "div",
          { class: "row phrase" },
          el(
            "div",
            { class: "l" },
            el("span", { class: "said", title: `${e.text}

${e.translation}` }, e.translation),
            el("small", {}, `${e.text.length > 80 ? `${e.text.slice(0, 80)}\u2026` : e.text} \xB7 ${whenSaid(e.at, Date.now())}`)
          ),
          linkBtn("Copy", () => copyText(e.translation))
        )
      ) : [aside("info", "Nothing yet. Translations are kept here 30 days, 200 at most.")]
    ];
  }
  var TRY_CHECK = "I want to learn English and can we made tutor option? I dictate or tupe in English and you show my my mistake.";
  var SLOW_CHECK_S = 4;
  function checkFitText(fit, speed) {
    const where2 = FIT_WHERE[fit.where];
    if (speed?.text === void 0) return fit.where === "card" ? `about 1 s per text ${where2}` : `possible, but slow here: several seconds per text, ${where2}`;
    return `${speed.text > SLOW_CHECK_S ? "slow here" : "here"}: ${seconds(speed.text)} per text, ${where2}${startText(speed.start)}`;
  }
  function checkCap(v) {
    const t = v.models[v.settings.model];
    if (t.status === "downloading") return `downloading ${Math.round(t.progress * 100)}%`;
    return t.status === "ready" ? `English \xB7 notes in ${v.settings.native}` : "downloads once";
  }
  function checkModelRows(v) {
    const advice = translationAdvice(v.speech.device);
    const inUse = v.settings.model;
    return ["accurate", "most"].map((model) => {
      const t = v.models[model];
      const fetching = t.status === "downloading";
      const notes = [
        `${CHECK_ABOUT[model]} (${LEVEL_MODEL[model]})`,
        checkFitText(advice[model], v.modelSpeed[model]),
        t.status === "failed" ? bad("the download failed; Use tries again") : t.status === "ready" || fetching ? null : `${size(t.size)} to download ${model === inUse ? "with Download or at your first check" : "when you pick it"}${advice[model].cuda ? ` (${CUDA_SIZE})` : ""}`,
        fetching ? bar(t.progress) : null
      ];
      const label = el("span", {}, LEVEL_NAMES[model], advice.advised === model ? el("span", { class: "chip good" }, lucide("check", "s"), "Recommended") : null);
      const control = fetching ? el("span", { class: "pct" }, `${Math.round(t.progress * 100)}%`) : model !== inUse ? linkBtn("Use", () => post({ type: "useModel", model })) : t.status === "ready" ? chip("in use", "lit") : linkBtn("Download", () => post({ type: "useModel", model }));
      const remove2 = t.status === "ready" ? ib("x", `Remove ${LEVEL_NAMES[model]} (${size(t.size)})`, () => post({ type: "removeModel", model })) : null;
      return row(label, notes, control, remove2);
    });
  }
  function checkPage(v) {
    const s = v.settings;
    const typed = s.typeCheckKey ? `${usage(s.typeCheckKey)} and type it` : "use Check my English\u2026 in the tray menu";
    const how = s.checkKey ? `This text has mistakes on purpose. Select it, ${usage(s.checkKey)}, or ${typed}.` : `This text has mistakes on purpose. Select it and press your key, or ${typed}.`;
    return [
      grp("Keys"),
      keyRow("checkKey", "Check the selected text", s.checkKey ? `select it anywhere, ${usage(s.checkKey)}` : "select it anywhere, then press one key, such as Right Ctrl twice", !v.keysOk.check, "graduation-cap"),
      keyRow("typeCheckKey", "Type a text to check", "an empty card by the pointer, from any program; also in the tray menu", !v.keysOk.typeCheck, "type"),
      keyRow("practiceKey", "Check what I say", installed(v) ? "press, say a phrase in English, press again" : "needs the speech engine (see Dictate)", !v.speech.keysOk.practice, "mic"),
      fixedKey("In the card: paste the corrected text back", "Enter"),
      aside("info", "Speech recognition fixes some mistakes as it writes, so typing shows more of them."),
      grp("Model"),
      ...checkModelRows(v),
      aside("info", "The same model translates when Translate is set to Accurate or Most accurate."),
      grp("History"),
      navCard("list-checks", "Mistakes", "what Check found in your texts, repeated ones first", v.mistakes.length ? String(v.mistakes.length) : "none", () => go("mistakes"), "mistakes"),
      tryIt(TRY_CHECK, how)
    ];
  }
  var diffs = /* @__PURE__ */ new Map();
  function partsOf(e) {
    const key = `${e.text}\0${e.corrected}`;
    let parts = diffs.get(key);
    if (!parts) diffs.set(key, parts = wordDiff(e.text, e.corrected));
    return parts;
  }
  function withMarks(parts) {
    return parts.flatMap(
      (p, i) => p.kind === "same" ? [document.createTextNode(p.text)] : [el(p.kind, {}, p.text), ...p.kind === "del" && parts[i + 1]?.kind === "ins" ? [document.createTextNode(" ")] : []]
    );
  }
  function changeText(wrong, right) {
    return el("span", { class: "said marks" }, wrong ? el("del", {}, wrong) : "+", " ", right ? el("ins", {}, right) : "");
  }
  function mistakesPage(v) {
    const counts = /* @__PURE__ */ new Map();
    for (const e of v.mistakes)
      for (const c of changesOf(partsOf(e))) {
        const key = c.wrong ? c.wrong.toLowerCase() : `+${c.right.toLowerCase()}`;
        const known = counts.get(key);
        if (known) known.rights.push(c.right);
        else counts.set(key, { wrong: c.wrong, rights: [c.right] });
      }
    const commonest = (rights) => rights.slice().sort((a, b) => rights.filter((r) => r === b).length - rights.filter((r) => r === a).length || a.length - b.length)[0] ?? "";
    const repeated = [...counts.values()].filter((c) => c.rights.length > 1).sort((a, b) => b.rights.length - a.rights.length).slice(0, 12).map((c) => ({ wrong: c.wrong, right: commonest(c.rights), n: c.rights.length }));
    const list2 = el("div", {});
    const fill = () => {
      const all = view?.mistakes ?? v.mistakes;
      const q = search.trim().toLowerCase();
      const shown2 = q ? all.filter((e) => `${e.text} ${e.corrected} ${e.note}`.toLowerCase().includes(q)) : all;
      list2.replaceChildren(
        ...shown2.length ? shown2.map(
          (e) => el(
            "div",
            { class: "row phrase mistake" },
            el("div", { class: "l" }, el("span", { class: "said marks", title: e.corrected }, ...withMarks(partsOf(e))), el("small", {}, [e.note, whenSaid(e.at, Date.now())].filter(Boolean).join(" \xB7 "))),
            linkBtn("Copy", () => copyText(e.corrected)),
            ib("x", "Forget it", () => post({ type: "forgetMistake", at: e.at }))
          )
        ) : [aside("info", all.length ? "No such mistake." : "Nothing yet. The texts Check my English set right are kept here, on this computer.")]
      );
    };
    fill();
    return [
      ...repeated.length ? [grp("You repeat"), ...repeated.map((c) => row(changeText(c.wrong, c.right), [`${c.n} times`]))] : [],
      grp("Mistakes", v.mistakes.length || void 0, v.mistakes.length ? linkBtn("Clear", () => post({ type: "clearMistakes" })) : null),
      ...v.mistakes.length ? [
        el(
          "div",
          { class: "tools" },
          el(
            "label",
            { class: "search" },
            icon("search"),
            el("input", {
              type: "search",
              placeholder: "Search your mistakes",
              value: search,
              oninput: (event) => {
                search = event.target.value;
                fill();
              }
            })
          )
        )
      ] : [],
      list2
    ];
  }
  function screenPage(v) {
    return [
      grp("Keys"),
      keyRow("snipKey", "Listen to text on the screen", "for text you can\u2019t select: draw a box around it", !v.keysOk.snip, "volume-2"),
      keyRow("textKey", "Translate text on the screen", "for text you can\u2019t select: draw a box around it", !v.keysOk.text, "languages"),
      grp("How it works"),
      card("scan", "Draw a box around the text", ["Windows dims the screen while you draw"], null),
      card("type", "Krya reads the text on this computer", ["it reads the languages Windows has installed; add more there (Windows OCR)"], linkBtn("Languages\u2026", () => post({ type: "openLanguageSettings" }))),
      card("spell-check", "Fix misread words in the card", ["then listen or translate"], null)
    ];
  }
  var pathNote = (path) => el("small", { class: "path", title: path }, el("bdi", {}, path));
  function kbRows(v) {
    const e = engineSettings(v);
    if (!running(v) || !e) return [card("folder", "Notes folder", [installed(v) ? "shown once the speech engine runs" : "chosen once the speech engine is installed"], null)];
    const inbox = el("input", {
      type: "text",
      class: "field",
      value: e.kbInbox,
      placeholder: "the folder itself",
      "aria-label": "Folder for notes",
      onkeydown: (event) => event.key === "Enter" && event.target.blur(),
      onchange: (event) => void saveEngine({ kbInbox: event.target.value.trim() })
    });
    return [
      card("folder", "Notes folder", [e.kbDir ? pathNote(e.kbDir) : "not chosen yet; notes need a folder (an Obsidian vault will do)"], linkBtn(e.kbDir ? "Change" : "Choose\u2026", () => void pickKb())),
      card("notebook-pen", "Subfolder for notes", ["a folder inside it; leave empty to use the folder itself"], inbox)
    ];
  }
  function vocabularyCard(v) {
    const n = v.settings.vocabulary.length;
    return navCard("spell-check", "Words to spell", "names and terms, written the way you want them", n ? `${n} ${n === 1 ? "word" : "words"}` : "none yet", () => go("vocabulary"), "vocabulary");
  }
  function modelCard(v, feature) {
    if (!running(v)) return null;
    const p = feature === "dictation" ? v.speech.plan.dictation : v.speech.plan.transcripts;
    const how = feature === "dictation" ? `about ${seconds(p.chosen.estimate)} per phrase` : `about ${minutesText(p.chosen.estimate)} per hour of recording`;
    return navCard("cpu", "Speech model", `${how} on this computer`, p.pinned ? p.chosen.label : `Automatic \xB7 ${p.chosen.label}`, () => openSub("model"), "model");
  }
  var minutesText = (m) => m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.max(1, Math.round(m))} min`;
  function dictatePage(v) {
    const s = v.settings;
    const k = v.speech.keysOk;
    const offer = engineRows(v, "Dictate");
    const recent = v.dictation.recent;
    return [
      ...offer.length ? [grp("Speech engine"), ...offer] : [],
      testOffer(v),
      grp("Keys"),
      keyRow("dictateKey", "Type what I say", "press, speak, press again; the words appear where the cursor is", !k.dictate, "mic"),
      keyRow("englishKey", "Type what I say, in English", `press, speak ${s.native}, press again; English is typed`, !k.english, "languages"),
      keyRow("noteKey", "Dictate a note", "saved as a Markdown file in your notes folder", !k.note, "notebook-pen"),
      keyRow("againKey", "Type the last phrase again", "repeats it where the cursor is", !k.again, "rotate-cw"),
      keyRow("practiceKey", "Check what I say", "press, say a phrase in English, press again", !k.practice, "graduation-cap"),
      aside("info", "The words appear as you speak. Esc cancels the phrase before it is typed."),
      grp("Notes"),
      ...kbRows(v),
      grp("Words and phrases"),
      vocabularyCard(v),
      navCard("clock", "Recent phrases", "phrases you dictated lately, to copy again", recent.length ? recent[0]?.text ?? "" : "none yet", () => go("phrases"), "phrases"),
      modelCard(v, "dictation"),
      el("p", { class: "privacy" }, lucide("lock", "s"), "Speech is recognized on this computer; nothing is sent anywhere.")
    ].filter((n) => n !== null);
  }
  function vocabularyPage(v) {
    const s = v.settings;
    const wordOf = (line) => parseEntry(line).word.toLowerCase();
    const word = liveField("word", "Word, as it should be written", "Word to spell", (key) => key === "Enter" ? add() : clear());
    const heard2 = liveField("heard", "Heard as (optional): \u043A\u0440\u044F, \u043A\u0440\u0430\u044F", "What it is heard as", (key) => key === "Enter" ? add() : clear());
    const clear = () => {
      word.value = "";
      heard2.value = "";
      word.focus();
    };
    const add = () => {
      const w = word.value.replace(/\s+/g, " ").trim();
      const h = heard2.value.replace(/\s+/g, " ").replace(/[()]/g, "").trim();
      if (!w) return word.focus();
      const line = h ? `${w} (${h})` : w;
      if (!parseEntry(line).word) return;
      const lines = (view?.settings.vocabulary ?? s.vocabulary).filter((l) => wordOf(l) !== w.toLowerCase());
      clear();
      save({ vocabulary: [...lines, line] });
    };
    const edit = (line) => {
      const { word: w, heard: hs } = parseEntry(line);
      word.value = w;
      heard2.value = hs.join(", ");
      word.focus();
    };
    const items = s.vocabulary.map((line) => {
      const { word: w, heard: hs } = parseEntry(line);
      return el(
        "div",
        { class: "row" },
        el("button", { class: "l", title: "Change it", onclick: () => edit(line) }, w, hs.length ? el("small", {}, `heard as ${hs.join(", ")}`) : null),
        ib("x", `Remove ${w}`, () => save({ vocabulary: (view?.settings.vocabulary ?? s.vocabulary).filter((l) => l !== line) }))
      );
    });
    return [
      grp("Add a word"),
      el(
        "div",
        { class: "row add" },
        el("div", { class: "fields" }, word, heard2, btn([lucide("plus", "s"), "Add"], add, "primary")),
        el("small", {}, "A name or a term; dictation and transcripts write it this way, and a heard form is replaced wherever it is said.")
      ),
      grp("Words", items.length || void 0, items.length ? linkBtn("Clear all", () => save({ vocabulary: [] })) : null),
      ...items.length ? items : [aside("info", "Nothing yet. Add a name or a word above.")],
      aside("info", "Shared by Dictate and Transcribe.")
    ];
  }
  function recentPage(v) {
    const recent = v.dictation.recent;
    return [
      grp("Phrases", recent.length || void 0, recent.length ? linkBtn("Clear", () => post({ type: "clearDictation" })) : null),
      ...recent.length ? recent.map(
        (e) => el(
          "div",
          { class: "row phrase" },
          el("div", { class: "l" }, el("span", { class: "said", title: e.heard ? `${e.text}

Said: ${e.heard}` : e.text }, e.text), el("small", {}, whenSaid(e.at, Date.now()))),
          linkBtn("Copy", () => copyText(e.text))
        )
      ) : [aside("info", "Nothing yet. Dictated phrases (not notes) are kept here 30 days, 200 at most.")]
    ];
  }
  function modelPage(v) {
    const feature = open?.name === "dictate" ? "dictation" : "transcripts";
    return [
      grp(feature === "dictation" ? "For dictation" : "For transcripts"),
      ...modelRows(v, feature),
      aside("info", feature === "dictation" ? "Transcripts have a model of their own, on the Transcribe page." : "Dictation has a model of its own, on the Dictate page.")
    ];
  }
  function whenSaid(iso, now) {
    const at = new Date(iso);
    const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((day(new Date(now)) - day(at)) / 864e5);
    if (days === 0) return time;
    if (days === 1) return `yesterday ${time}`;
    return `${at.getDate()} ${at.toLocaleDateString("en-GB", { month: "short" })} ${time}`;
  }
  var copyText = (text) => void window.tutorHost.call({ call: "copy", text }).then(() => toast(`Copied: ${text}`), fault);
  function ago(epochSeconds) {
    const s = Math.max(0, Date.now() / 1e3 - epochSeconds);
    if (s < 90) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 2 * 86400) return "yesterday";
    const d = new Date(epochSeconds * 1e3);
    return `${d.getDate()} ${d.toLocaleDateString("en-GB", { month: "short" })}`;
  }
  function openChrome(url) {
    void window.tutorHost.call({ call: "openChrome", url }).then((opened) => {
      if (opened === "typed") return;
      const say = opened === "opened" ? "Chrome is open: the address is copied, paste it into its address bar and press Enter." : "Chrome was not found. The address is copied: paste it into Chrome\u2019s address bar.";
      void window.tutorHost.call({ call: "copy", text: url }).then(() => toast(say), fault);
    }, fault);
  }
  var extensionSeen = (v) => v.speech.health?.extension ?? null;
  function olderVersion(a, b) {
    const x = a.split(".").map(Number);
    const y = b.split(".").map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d) return d < 0;
    }
    return false;
  }
  var extensionStale = (v) => {
    const ext = extensionSeen(v);
    return !!ext && !!v.speech.extensionShipped && olderVersion(ext.version, v.speech.extensionShipped);
  };
  var FIXED_ID_SINCE = "0.4.0";
  var extensionReload = (v) => {
    const ext = extensionSeen(v);
    return !!ext && olderVersion(ext.version, FIXED_ID_SINCE);
  };
  var extensionsPage = (v) => {
    const id = extensionSeen(v)?.id;
    return id && /^[a-p]{32}$/.test(id) ? `chrome://extensions/?id=${id}` : "chrome://extensions/";
  };
  function meetCard(v) {
    const ext = extensionSeen(v);
    const stale = extensionStale(v);
    const value = !ext ? "set up in Chrome" : extensionReload(v) ? `Load again in Chrome \xB7 v${ext.version} \u2192 v${v.speech.extensionShipped}` : stale ? `Reload in Chrome \xB7 v${ext.version} \u2192 v${v.speech.extensionShipped}` : `Installed \xB7 v${ext.version}`;
    return navCard("video", "Google Meet", "record a call in Chrome with the Krya extension", value, () => openSub("meet"), "meet", !!ext && !stale);
  }
  function meetPage(v) {
    const dir = v.speech.extensionDir;
    const ext = extensionSeen(v);
    const offer = engineRows(v, "Google Meet");
    const status = !ext ? card("video", "Not set up yet", [running(v) ? "three steps in Chrome, once; this line says when the extension is in" : "the speech engine must run for the extension to work"], null) : extensionReload(v) ? card(
      "rotate-cw",
      `Chrome runs v${ext.version}, which Krya no longer takes recordings from`,
      ["remove it on Chrome\u2019s extensions page (Remove on its card), then Load unpacked again: steps 1 and 2 below; Chrome asks for the microphone once more"],
      btn("Open in Chrome", () => openChrome("chrome://extensions/"), "primary")
    ) : extensionStale(v) ? card("rotate-cw", `Chrome runs v${ext.version}; Krya has v${v.speech.extensionShipped}`, ["press Reload on the extension\u2019s card in Chrome: Open in Chrome goes straight to it"], btn("Open in Chrome", () => openChrome(extensionsPage(v)), "primary")) : card("circle-check", `Installed in Chrome \xB7 v${ext.version}`, [el("small", { class: "ok" }, `seen ${ago(ext.seen)} \xB7 the call\u2019s sound and your microphone go to the speech engine on this computer`)], caps(MEET_KEY));
    return [
      ...offer.length ? [grp("Speech engine"), ...offer] : [],
      grp("Chrome extension"),
      status,
      grp("Set it up"),
      card("external-link", "1 \xB7 Open Chrome\u2019s extensions page and turn on Developer mode", ["chrome://extensions \xB7 the switch is at the top right"], btn("Open in Chrome", () => openChrome("chrome://extensions/"))),
      card(
        "folder",
        "2 \xB7 Load unpacked, paste the folder\u2019s path",
        [pathNote(dir), "Ctrl+V into the folder picker\u2019s address line, then Select folder"],
        el("span", { class: "kchg" }, linkBtn("Show the folder", () => post({ type: "showInFolder", path: dir })), btn([lucide("copy", "s"), "Copy path"], () => copyText(dir), "primary"))
      ),
      card("mic", "3 \xB7 In a meeting: the Krya icon \u2192 Record, or the key", ["the call\u2019s sound and your microphone \xB7 the transcript appears in Transcripts"], caps(MEET_KEY)),
      grp("If something is off"),
      card("keyboard", "The key does nothing", ["set it at chrome://extensions/shortcuts"], btn("Open in Chrome", () => openChrome("chrome://extensions/shortcuts"))),
      card("rotate-cw", "After Krya updates, press Reload on the extension", ["Chrome keeps the old copy until then"], btn("Open in Chrome", () => openChrome(extensionsPage(v))))
    ].filter((n) => n !== null);
  }
  function speakersCard(v) {
    if (!installed(v)) return null;
    const s = v.speech;
    const note = "the words are recognized already; this tells the voices apart";
    const open2 = () => openSub("speakers");
    const work = s.pack.status === "installing" && s.pack.installing?.includes("speakers");
    if (work) return navCard("users", "Who spoke when", note, "downloading\u2026", open2, "speakers");
    if (!hasPart(v, "speakers")) {
      const sz = s.speakers.sizes[s.speakers.on];
      return navCard("users", "Who spoke when", note, `not installed \xB7 \u2248${size(sz.download)}`, open2, "speakers");
    }
    const on = DEVICE_NAMES[s.pack.speakersOn ?? "cpu"];
    if (!running(v)) return navCard("users", "Who spoke when", note, `on the ${on}`, open2, "speakers");
    const state = diarizationOf(v);
    const STATES = {
      ready: ["ready", true],
      missing: ["key saved", true],
      checking: ["checking\u2026", false],
      downloading: ["downloading\u2026", false],
      "needs-token": ["needs a key", false],
      "bad-token": ["the key failed", false],
      "no-access": ["no access yet", false],
      failed: ["could not check", false]
    };
    const [value, ok] = STATES[state];
    return navCard("users", "Who spoke when", note, ok ? `${value} \xB7 ${on}` : value, open2, "speakers", ok);
  }
  function transcribePage(v) {
    const offer = engineRows(v, "Transcribe");
    return [
      ...offer.length ? [grp("Speech engine"), ...offer] : [],
      testOffer(v),
      ...running(v) ? [grp("New transcription"), ...newRows(v)] : [],
      grp("Setup"),
      speakersCard(v),
      vocabularyCard(v),
      meetCard(v),
      modelCard(v, "transcripts"),
      grp("Library"),
      navCard("file-text", "Transcripts", "every transcript, searched by its words", null, () => go("transcripts"))
    ].filter((n) => n !== null);
  }
  function layoutsPage(v) {
    const cycle = cycleOf(v);
    const ids = cycle.map((l) => l.id);
    const rest = v.layouts.filter((l) => !ids.includes(l.id));
    const own = v.settings.layouts.length > 0;
    const move2 = (id, to) => {
      const next = ids.filter((x) => x !== id);
      next.splice(to, 0, id);
      save({ layouts: next });
    };
    return [
      grp("In this order", cycle.length),
      ...cycle.map(
        (l, i) => card(
          "keyboard",
          `${i + 1} \xB7 ${l.name}`,
          [l.short],
          el(
            "span",
            { class: "kchg" },
            ib("arrow-up", "Earlier", () => move2(l.id, i - 1), i === 0),
            ib("arrow-down", "Later", () => move2(l.id, i + 1), i === ids.length - 1),
            // The last one left cannot go: the keys need a layout to go to.
            linkBtn("Leave out", () => save({ layouts: ids.filter((id) => id !== l.id) }), ids.length === 1)
          )
        )
      ),
      rest.length ? card(
        "plus",
        "Add a layout",
        ["one Windows has; it goes last"],
        select("", [["", "Pick a layout"], ...rest.map((l) => [l.id, l.name])], (id) => id && save({ layouts: [...ids, id] }))
      ) : null,
      aside("info", own ? "Your own order. Leave every layout out to go back to the languages you use." : "The order comes from the languages you use (Settings); move one or leave one out to set your own."),
      grp("A key of its own"),
      ...cycle.map((l) => layoutKeyRow(l, l.name, ["goes straight to it"]))
    ].filter((n) => n !== null);
  }
  function fixingPage(v) {
    const s = v.settings;
    return [
      grp("Capitals"),
      toggleCard("type", "Fix two capitals at the start", s.fixTwoCaps, (fixTwoCaps) => save({ fixTwoCaps }), "\u041F\u0420\u0438\u0432\u0435\u0442 \u2192 \u041F\u0440\u0438\u0432\u0435\u0442; IDs and URLs stay"),
      toggleCard("type", "Fix a word typed with Caps Lock on", s.fixCapsLock, (fixCapsLock) => save({ fixCapsLock }), "\u043F\u0420\u0418\u0412\u0415\u0422 \u2192 \u041F\u0440\u0438\u0432\u0435\u0442, and Caps Lock is turned off"),
      toggleCard("lock", "Leave words in capitals as typed", s.keepCaps, (keepCaps) => save({ keepCaps }), "abbreviations in capitals are never fixed"),
      grp("When"),
      toggleCard("clock", "Also fix after a pause", s.fixOnPause, (fixOnPause) => save({ fixOnPause }), "a clearly wrong word is fixed about a second after you stop typing"),
      toggleCard("volume-2", "Play a quiet click when a word is fixed", s.fixSound, (fixSound) => save({ fixSound })),
      aside("info", "Short words are fixed together with the word after them: z rfr \u2192 \u044F \u043A\u0430\u043A. After you switch the layout yourself, the next word is left as typed.")
    ];
  }
  function programsPage(v) {
    const s = v.settings;
    const apps = () => view?.settings.apps ?? s.apps;
    const add = (exe) => {
      if (!apps().some((a) => a.exe === exe)) save({ apps: [...apps(), { exe, off: ["fix"], layout: "" }] });
    };
    const known = new Set(s.apps.map((a) => a.exe));
    const running2 = runningApps.filter((exe) => !known.has(exe));
    const suggest = v.lastApp && !known.has(v.lastApp) ? v.lastApp : "";
    const addTyped = (field2) => {
      const name = field2.value.trim().toLowerCase();
      field2.value = "";
      if (name) add(/\.exe$/.test(name) ? name : `${name}.exe`);
    };
    const field = liveField("add", "program.exe", "Add a program", (key, f) => key === "Enter" ? addTyped(f) : (f.value = "", f.blur()));
    return [
      grp("Add a program"),
      el(
        "div",
        { class: "row add" },
        el("div", { class: "fields" }, field, btn([lucide("plus", "s"), "Add"], () => addTyped(field), "primary")),
        el("small", {}, "The name of its .exe. It starts with fixing as you type left out; open it to choose more.")
      ),
      suggest ? card("plus", `Add ${suggest}`, ["the program in front a moment ago"], btn("Add", () => add(suggest))) : null,
      running2.length ? card(
        "plus",
        "Add a running program",
        ["one with a window open now"],
        select("", [["", "Pick a program"], ...running2.map((exe) => [exe, exe])], (exe) => exe && add(exe))
      ) : null,
      grp("Programs", s.apps.length || void 0),
      ...s.apps.length ? s.apps.map(
        (a) => navCard(
          "monitor",
          a.exe,
          programNote(v, a),
          null,
          () => {
            programOpen = a.exe;
            go("programs", "program");
          },
          `program-${a.exe}`
        )
      ) : [aside("info", "None yet. Add a program above: Krya leaves out what you choose there, or switches to its own layout when it comes to the front.")]
    ].filter((n) => n !== null);
  }
  var APP_PART_NAMES = { fix: "fixing as you type", switch: "the switch keys", badge: "the badge", keys: "every key of Krya" };
  function programNote(v, a) {
    const off = a.off.length ? `left out: ${a.off.map((p) => APP_PART_NAMES[p]).join(", ")}` : "";
    const layout = a.layout ? `starts in ${v.layouts.find((l) => l.id === a.layout)?.name ?? a.layout}` : "";
    return [off, layout].filter(Boolean).join(" \xB7 ") || "nothing left out";
  }
  function programPage(v) {
    const rule = v.settings.apps.find((a) => a.exe === programOpen);
    if (!rule) return [aside("info", "This program is no longer in the list.")];
    const apps = () => view?.settings.apps ?? v.settings.apps;
    const change = (next) => save({ apps: apps().map((a) => a.exe === rule.exe ? { ...a, ...next } : a) });
    const part = (p, iconName, label, note) => toggleCard(iconName, label, !rule.off.includes(p), (on) => change({ off: on ? rule.off.filter((x) => x !== p) : [...rule.off, p] }), note);
    return [
      grp("Here, Krya"),
      part("fix", "spell-check", "Fixes words as you type", "off: words stay as typed; the fix key still works"),
      part("switch", "keyboard", "Switches the layout by its keys", "the switch key and the layouts' own keys"),
      part("badge", "type", "Shows the layout by the cursor", "the badge"),
      part("keys", "circle-alert", "Hears its keys at all", "off: none of Krya's keys works here, but the pause key"),
      grp("Layout"),
      card(
        "globe",
        "Starts in",
        ["each time the program comes to the front"],
        select(rule.layout, [["", "As it was"], ...v.layouts.map((l) => [l.id, l.name])], (layout) => change({ layout }))
      ),
      card(
        "trash-2",
        "Out of the list",
        ["everything works here again"],
        linkBtn("Remove", () => {
          save({ apps: apps().filter((a) => a.exe !== rule.exe) });
          back();
        })
      )
    ];
  }
  function learnedPage(v) {
    const { alwaysFix, myWords } = v.learned;
    const name = (code) => languageName(code);
    const item = (list2, w, note) => card(list2 === "alwaysFix" ? "wand-sparkles" : "book-open", w.word, [note], ib("x", `Forget ${w.word}`, () => post({ type: "unlearn", list: list2, word: w.word })));
    return [
      toggleCard("sparkles", "Learn from my typing", v.settings.learn, (learn) => save({ learn }), "never in a password field, a program left out of fixing, or on the full screen"),
      grp("Fixed always", alwaysFix.length || void 0),
      ...alwaysFix.length ? alwaysFix.map((w) => item("alwaysFix", w, `into ${name(w.lang)}`)) : [aside("info", "A word you fix by hand twice (the fix key, or erased and typed again in the other layout) is fixed by itself from then on.")],
      grp("Your words", myWords.length || void 0),
      ...myWords.length ? myWords.map((w) => item("myWords", w, `${name(w.lang)} \xB7 never fixed, and fixed into`)) : [aside("info", "A word in no dictionary that you type right three times becomes yours: Krya leaves it as typed, and fixes it into when it is typed in the wrong layout. Until then only an unreadable fingerprint of it is kept.")],
      grp("Never fixed"),
      navCard("lock", "Kept as typed", "words never fixed by themselves", String(v.settings.keepWords.length || "none"), () => go("kept"), "kept"),
      alwaysFix.length || myWords.length ? card("trash-2", "Forget all", ["what Krya learned goes; Kept as typed stays"], linkBtn("Forget", () => post({ type: "forgetLearned" }))) : null
    ].filter((n) => n !== null);
  }
  function keptPage(v) {
    const s = v.settings;
    const words = () => view?.settings.keepWords ?? s.keepWords;
    return listPage({
      label: "Add a word",
      placeholder: "word, as you type it",
      note: "Backspace right after a fix adds the word too.",
      items: s.keepWords,
      count: "Words",
      empty: "None yet. Add a word above, or press Backspace right after a fix you did not want.",
      normalize: keptForm,
      add: (word) => save({ keepWords: [...words(), word] }),
      remove: (word) => save({ keepWords: words().filter((w) => w !== word) })
    });
  }
  function othersLine(v) {
    const presses = "presses keys by itself; Krya ignores those.";
    const text = v.keyboardApps.length ? `Also using the keyboard: ${v.keyboardApps.join(", ")}.${v.foreignKeys ? ` One of them ${presses}` : ""}` : v.foreignKeys ? `A program ${presses}` : "";
    return text ? aside("info", text) : null;
  }
  function askRunningApps() {
    void window.tutorHost.call({ call: "runningApps" }).then((list2) => {
      runningApps = Array.isArray(list2) ? list2.filter((x) => typeof x === "string") : [];
      if (open?.name === "programs" && !open.sub) renderBody();
    }, fault);
  }
  function keyboardPage(v) {
    const s = v.settings;
    const sample = sampleOf(s.native);
    const [typed = "", fixed = ""] = [sample.typed.split(" ")[0], sample.fixed.split(" ")[0]];
    const count = (n, one) => n ? `${n} ${n === 1 ? one : one + "s"}` : "none";
    const ownKeys = Object.keys(s.layoutKeys).length;
    const learnedCount = v.learned.alwaysFix.length + v.learned.myWords.length;
    const onOff = (on, key, label, has) => has ? el("span", { class: "tgwrap" }, toggleKnob(on, (next) => save({ [key]: next }), label)) : null;
    return [
      grp("Keys"),
      keyRow(
        "switchKey",
        "Switch to the next layout",
        s.switchKey && usage(s.switchKey).startsWith("tap") ? "tap the key, nothing else" : "goes to the next of the layouts listed below",
        false,
        "keyboard",
        onOff(s.switchOn, "switchOn", "Switching by keys", !!s.switchKey || ownKeys > 0)
      ),
      keyRow("fixKey", "Fix the last words", "retypes words that came out in the wrong layout; press again for the next one", false, "rotate-cw", onOff(s.fixKeyOn, "fixKeyOn", "The fix key", !!s.fixKey)),
      grp("As you type"),
      toggleCard("spell-check", "Fix words as I type", s.autoFix, (autoFix) => save({ autoFix }), `${typed} \u2192 ${fixed} when you press space; Backspace undoes it`),
      s.autoFix ? navCard("type", "Fixing as I type", "capitals, short words, fixing after a pause", null, () => openSub("fixing"), "fixing") : null,
      toggleCard("type", "Show the layout by the cursor", s.layoutBadge, (layoutBadge) => save({ layoutBadge }), "a small badge appears when the layout or Caps Lock changes"),
      toggleCard("keyboard", "Show the layout in the tray", s.trayLayout, (trayLayout) => save({ trayLayout }), "the tray icon shows the current layout, such as en or ru"),
      toggleCard("monitor", "Stay off in full screen", s.quietFullScreen, (quietFullScreen) => save({ quietFullScreen }), "games, presentations, videos"),
      grp("Lists"),
      navCard("keyboard", "Layouts", ownKeys ? `the layouts the switch key goes through; ${ownKeys} with a key of their own` : "the layouts the switch key goes through, in order", cycleOf(v).map((l) => l.short).join(" \xB7 "), () => go("layouts"), "layouts"),
      navCard("monitor", "Programs", "turn parts of Krya off in a program, or give it its own layout", count(s.apps.length, "program"), () => go("programs"), "programs"),
      navCard("sparkles", "Learned words", s.learn ? "words Krya learned from your typing" : "learning from your typing is off", count(learnedCount, "word"), () => go("learned"), "learned"),
      navCard("lock", "Kept as typed", "words Krya never fixes by itself", count(s.keepWords.length, "word"), () => go("kept"), "kept"),
      v.rivals.length ? warn(`${v.rivals.join(" and ")} ${v.rivals.length > 1 ? "are" : "is"} running: turn off its layout switching, or words get fixed twice.`) : null,
      v.elevatedApp ? warn(`${v.elevatedApp} runs as administrator: Windows keeps its keys from Krya, so nothing is fixed or switched there.`) : null,
      v.keyboardTrouble ? warn(`The keyboard helper: ${v.keyboardTrouble}`) : null,
      othersLine(v),
      el("p", { class: "privacy" }, lucide("lock", "s"), "Krya reads your keystrokes only to fix the layout, and sends nothing anywhere. It keeps only the words it learned, on this computer.")
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
    const list2 = el("ul", { class: "wl" });
    const fill = () => {
      const words = view?.words ?? v.words;
      const q = search.trim().toLowerCase();
      const shown2 = q ? words.filter((w) => matches(w, q)) : words;
      list2.replaceChildren(
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
      list2
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
        return row("Natural voice", [`${n.size} MB to download, then it reads offline (Kokoro)`], download("Download"));
      case "failed":
        return row("Natural voice", [bad("The download failed.")], download("Try again"));
      case "downloading": {
        const bar2 = el("i", { class: "fill" });
        bar2.style.width = `${Math.round(n.progress * 100)}%`;
        return row("Natural voice", [el("span", { class: "bar" }, bar2)], el("span", { class: "pct" }, `${Math.round(n.progress * 100)}%`));
      }
      default:
        return null;
    }
  }
  var removingSpeech = false;
  function enginePage(v) {
    const sp = v.speech;
    const p = sp.pack;
    const h = sp.health;
    if (!installed(v)) {
      const offer = engineRows(v, "Dictate and Transcribe");
      if (p.status === "installing" || p.status === "removing") return [grp("Download"), ...offer];
      return [grp("Download"), ...offer];
    }
    const out = [grp("On this computer")];
    const busy3 = p.status !== "ready";
    const here = (text) => el("small", { class: "ok" }, text);
    const speakersOnCard2 = p.speakersOn === "cuda";
    out.push(
      card("mic", "Speech to text", [here(`Installed \xB7 \u2248${size(sp.installed.core)}`), "Whisper and Parakeet on the processor: Dictate and Transcribe"], null),
      p.nvidia ? card(
        "monitor",
        "The graphics card\u2019s part",
        [
          hasPart(v, "gpu") ? here(speakersOnCard2 ? "Installed \xB7 inside the speakers\u2019 PyTorch" : `Installed \xB7 \u2248${size(sp.installed.gpu)}`) : `Not installed \xB7 \u2248${size(sp.download.gpu)} download`,
          "speech on the NVIDIA card, several times quicker"
        ],
        hasPart(v, "gpu") ? null : Object.assign(btn("Add", () => post({ type: "installSpeech", parts: ["gpu"] })), { disabled: busy3 })
      ) : null,
      navCard(
        "users",
        "Who spoke when",
        sp.speakers.model ? "PyTorch and pyannote \xB7 the voices\u2019 model is here already" : "PyTorch and pyannote \xB7 the voices\u2019 model comes with a free Hugging Face key",
        hasPart(v, "speakers") ? `Installed \xB7 ${DEVICE_NAMES[p.speakersOn ?? "cpu"]}` : `Not installed \xB7 \u2248${size(sp.speakers.sizes[sp.speakers.on].download)}`,
        () => go("transcribe", "speakers"),
        "speakers",
        hasPart(v, "speakers")
      ),
      ...engineRows(v, ""),
      card("monitor", "Graphics card", [cardNote(v)], null),
      card(
        "cpu",
        "Speech models",
        [v.settings.speechPrefer === "speed" ? "quicker ones, a little less accurate" : "the most accurate ones this computer runs in time"],
        seg(
          v.settings.speechPrefer,
          [
            ["accuracy", "Accuracy"],
            ["speed", "Speed"]
          ],
          (speechPrefer) => post({ type: "saveSettings", patch: { speechPrefer } })
        )
      ),
      grp("Service")
    );
    const service = { off: "off", starting: "starting\u2026", ready: h?.busy ? "running \xB7 transcribing now" : "running", down: "stopped" }[sp.service];
    out.push(card("play", "Service", [`${service} \xB7 127.0.0.1:${sp.port}`, sp.trouble ? bad(sp.trouble) : null], linkBtn("Restart", () => post({ type: "restartSpeech" }), p.status !== "ready")));
    if (h) {
      out.push(
        card("folder", "Transcripts are kept in", [pathNote(h.dataDir)], linkBtn("Open", () => post({ type: "openPath", path: h.dataDir }))),
        card("folder", "Notes go to", [h.kbDir ? pathNote(h.kbDir) : "no knowledge base folder yet"], linkBtn(h.kbDir ? "Change" : "Choose\u2026", () => void pickKb()))
      );
    }
    out.push(
      grp("Remove"),
      card(
        "trash-2",
        "Remove the speech engine",
        [removingSpeech ? "its parts and models go; transcripts and notes stay. Remove?" : "gives the space back \xB7 transcripts and notes stay"],
        removingSpeech ? el(
          "span",
          { class: "kchg" },
          linkBtn("Keep", () => (removingSpeech = false, renderBody())),
          btn("Remove", () => (removingSpeech = false, post({ type: "removeSpeech" })), "danger")
        ) : linkBtn("Remove\u2026", () => (removingSpeech = true, renderBody()), p.status !== "ready")
      )
    );
    return out.filter((n) => n !== null);
  }
  function computerPage(v) {
    const rows = computerRows(v);
    const first = rows[0];
    if (first) first.prepend(lucide("monitor"));
    return [grp("Hardware"), ...rows, testOffer(v), card("cpu", "Graphics card", [cardNote(v)], null)].filter((n) => n !== null);
  }
  var STORED = {
    fast: { icon: "languages", title: "Fast translation", note: "the models for your languages (Firefox Translations)" },
    voice: { icon: "volume-2", title: "Natural voice", note: "reads English aloud (Kokoro)" },
    dict: { icon: "book-open", title: "Word meanings", note: "the dictionary for your language (Wiktionary)" },
    accurate: { icon: "languages", title: "Accurate model", note: "translates and checks your English (Gemma 4 E4B)" },
    most: { icon: "languages", title: "Most accurate model", note: "translates and checks your English (Gemma 4 12B)" },
    unused: { icon: "database", title: "Models no longer used", note: "an older Krya\u2019s translation models; nothing uses them now (TranslateGemma)" },
    llama: { icon: "cpu", title: "The models\u2019 runner", note: "runs the models above; goes with the last of them (llama.cpp)" },
    speech: { icon: "audio-lines", title: "Speech engine", note: "Dictate and Transcribe: the program and its speech models" },
    yours: { icon: "file-text", title: "Your settings and lists", note: "words, mistakes, what Krya learned, logs" },
    transcripts: { icon: "folder", title: "Transcripts", note: "yours: the text and a small copy of the sound" }
  };
  var DOWNLOADED = ["fast", "voice", "dict", "accurate", "most", "unused", "llama", "speech"];
  var downloadsMb = (s) => s.parts.filter((p) => DOWNLOADED.includes(p.id)).reduce((mb, p) => mb + p.bytes / 1e6, 0);
  function storagePage(v) {
    const s = v.storage;
    if (!s?.parts.length) return [aside("loader", "Measuring what Krya keeps\u2026")];
    const busy3 = {
      fast: v.translation.fast.status === "downloading",
      voice: v.natural.status === "downloading",
      dict: v.dictionary.status === "downloading",
      accurate: v.models.accurate.status === "downloading",
      most: v.models.most.status === "downloading"
    };
    const remove2 = {
      fast: () => post({ type: "removeDownload", part: "fast" }),
      voice: () => post({ type: "removeDownload", part: "voice" }),
      dict: () => post({ type: "removeDownload", part: "dict" }),
      accurate: () => post({ type: "removeModel", model: "accurate" }),
      most: () => post({ type: "removeModel", model: "most" }),
      unused: () => post({ type: "removeDownload", part: "unused" })
    };
    const mb = (p) => p.bytes / 1e6;
    const where2 = (p) => p.away ? pathNote(p.path) : null;
    const line = (p) => {
      const { icon: name, title, note } = STORED[p.id];
      if (p.id === "speech") {
        const shared = p.shared / 1e6;
        const freed = shared >= 100 ? `; removing it frees ${size(mb(p) - shared)}, as ${size(shared)} of its files are shared with other Python tools here` : "";
        return navCard(name, title, [`${note}${freed}`, where2(p)], size(mb(p)), () => go("engine"), "storage-speech");
      }
      const x = remove2[p.id];
      const control = x && !busy3[p.id] ? ib("x", `Remove; it downloads again when needed`, x) : null;
      const open2 = DOWNLOADED.includes(p.id) ? null : linkBtn("Open", () => post({ type: "openPath", path: p.path }));
      return card(name, title, [note, where2(p)], el("span", { class: "kchg" }, el("span", { class: "v num" }, size(mb(p))), control, open2));
    };
    const got = s.parts.filter((p) => DOWNLOADED.includes(p.id) && p.bytes > 0);
    const own = s.parts.filter((p) => p.id === "yours" || p.id === "transcripts");
    return [
      oldNotice(s),
      grp("Downloads"),
      card(
        "database",
        `Everything Krya downloads: ${size(downloadsMb(s))}`,
        [`${got.some((p) => p.away) ? "in Krya\u2019s folder, but for the parts that say where they are" : "in one folder"} \xB7 ${size(s.freeMb)} free on ${s.drive}`, pathNote(s.root)],
        linkBtn("Open folder", () => post({ type: "openPath", path: s.root }))
      ),
      ...got.length ? got.map(line) : [aside("info", "Nothing downloaded yet: each part downloads when you first use it.")],
      grp("Yours"),
      ...own.map(line)
    ].filter((n) => n !== null);
  }
  function oldNotice(s) {
    const away = s.parts.filter((p) => p.away);
    if (!s.old || !away.length) return null;
    const total = size(away.reduce((sum, p) => sum + p.bytes / 1e6, 0));
    const inOld = away.every((p) => p.path.toLowerCase().startsWith(s.old.dir.toLowerCase()));
    const names = away.map((p) => STORED[p.id].title).join(", ");
    return el(
      "div",
      { class: "row notice old" },
      lucide("folder"),
      el(
        "div",
        { class: "l" },
        inOld ? `${total} still in the old Altype folder` : `${total} still outside Krya\u2019s folder`,
        el("small", {}, `${names}: Krya uses them from there. Moving stops the speech engine and the model, then starts Krya again`),
        s.old.why ? el("small", { class: "bad" }, `Not moved: ${s.old.why}`) : null
      ),
      s.old.moving ? el("span", { class: "v" }, "Moving\u2026") : btn("Move to Krya", () => post({ type: "moveToKrya" }), "primary")
    );
  }
  var languageName = (code) => LANGUAGES.find((l) => l.code === code)?.name ?? code;
  function languagesCard(v) {
    return navCard("globe", "Languages you use", "when Krya hears or reads a text, it guesses among these", myLanguages(v.settings).map(languageName).join(", "), () => go("settings", "languages"), "languages");
  }
  function languagesPage(v) {
    const s = v.settings;
    const used = myLanguages(s);
    const rest = LANGUAGES.filter((l) => !used.includes(l.code));
    const mine = () => view?.settings.languages ?? s.languages;
    return [
      grp("Add a language"),
      card(
        "plus",
        "Add a language",
        ["dictation never picks another; translation and the screen\u2019s text guess among them"],
        select("", [["", "Pick a language"], ...rest.map((l) => [l.code, `${l.name} \xB7 ${l.native}`])], (code) => code && save({ languages: [...mine(), code] }))
      ),
      grp("Languages", used.length),
      card("globe", languageName(used[0] ?? ""), ["your language \xB7 changed in Settings"], null),
      card("globe", "English", ["always: the language Krya teaches"], null),
      ...s.languages.map((code) => card("globe", languageName(code), [], ib("x", `Remove ${languageName(code)}`, () => save({ languages: mine().filter((c) => c !== code) }))))
    ];
  }
  function voiceRows(v) {
    const s = v.settings;
    const rtf = v.natural.rtf;
    const windows = v.hostVoices.find((h) => /^en/i.test(h.lang));
    const slow = naturalOn(v) && rtf !== void 0 && rtf > 1;
    const voiceNote = !naturalOn(v) ? ["reads with a Windows voice"] : slow ? [`natural voice, ${v.natural.size} MB on this computer`, bad("it prepares speech slower than it plays, so it pauses between sentences; a Windows voice is instant")] : [`natural voice, ${v.natural.size} MB on this computer${rtf ? ` \xB7 prepares speech ${Math.max(1, Math.round(1 / rtf))}\xD7 faster than it plays` : ""}`];
    return [
      grp("Voice"),
      card("volume-2", "Voice", voiceNote, slow && windows ? linkBtn(`Use ${windows.name.replace(/^Microsoft /, "").replace(/ Desktop$/, "")}`, () => save({ voice: windows.name })) : null, select(s.voice, voiceOptions(v), (voice) => save({ voice }))),
      naturalRow(v),
      card(
        "play",
        "Speed",
        ["how fast it reads"],
        seg(
          s.rate,
          RATES.map((r) => [r, String(r)]),
          (rate) => save({ rate }),
          true
        )
      )
    ];
  }
  function settingsPage(v) {
    const s = v.settings;
    return [
      grp("Language"),
      card(
        "languages",
        "Your language",
        ["Krya translates into it and shows word meanings in it"],
        select(
          s.native,
          v.languages.map((l) => [l.name, `${l.native} \xB7 ${l.name}`]),
          (native) => save({ native })
        )
      ),
      languagesCard(v),
      grp("Krya"),
      card(
        "monitor",
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
      toggleCard("power", "Start with Windows", s.startWithWindows, (startWithWindows) => save({ startWithWindows })),
      toggleCard("pause", "Pause Krya", s.paused, (paused) => save({ paused }), "all shortcuts and fixing stop until you turn it back on; also in the tray menu"),
      keyRow("pauseKey", "Pause or resume with a key", "works while paused too", !v.keysOk.pause, "pause"),
      keyRow("windowKey", "Open this window with a key", "from any program", !v.keysOk.window, "house"),
      card("rotate-ccw", "Reset all keys", ["every shortcut back to how it came; \u21BA by a key brings back just that one"], linkBtn("Reset keys", () => post({ type: "resetKeys" }))),
      // New versions are downloaded by hand from GitHub (the owner, 2026-10-30): nothing installs itself.
      card(
        "rotate-cw",
        `Version ${v.version}${v.dev ? " dev" : ""}`,
        [v.dev ? `built ${v.build}` : "new versions: download the installer from GitHub and run it; your settings and downloads stay"],
        linkBtn("New versions", () => post({ type: "openLink", url: RELEASES }))
      ),
      grp("Backup"),
      card(
        "file-text",
        "Back up or move to another computer",
        ["settings, words, mistakes, what Krya learned from your typing, recent translations and phrases, in one file; models download again"],
        el("span", { class: "kchg" }, linkBtn("Export", () => post({ type: "exportBackup" })), linkBtn("Import", () => post({ type: "importBackup" })))
      ),
      aside("info", "Import replaces your settings with the backup\u2019s and adds its words and history to yours; nothing of yours is removed."),
      card("rotate-ccw", "Reset all settings", ["keys, switches and lists back to how they came; your words and history stay"], linkBtn("Reset", () => post({ type: "resetSettings" })))
    ].filter((n) => n !== null);
  }
  function aboutPage(v) {
    const fact = (term, ...detail) => [el("dt", {}, term), el("dd", {}, ...detail)];
    return [
      el(
        "div",
        { class: "about" },
        el("div", { class: "mk" }, tile(88), logo()),
        el("p", { class: "tag" }, "Talk to the duck."),
        // A run from source says when it was built, so it is never taken for the last release.
        el("p", { class: "ver" }, `Version ${v.version}${v.dev ? ` dev, built ${v.build}` : ""} \xB7 free and open source, MIT`),
        el(
          "dl",
          { class: "facts" },
          ...fact("made by", "Yevhen Peshynskyi \xB7 Design automation engineer", el("br"), link("https://ikstro.com", "ikstro.com")),
          ...fact(
            "runs offline",
            "Firefox Translations by Mozilla \xB7 Gemma 4 by Google (Apache 2.0), run by llama.cpp \xB7 Kokoro-82M by hexgrad, eSpeak NG \xB7 Windows OCR \xB7 WikDict, from Wiktionary \xB7 FrequencyWords by Hermit Dave ",
            el("span", { class: "q" }, "\u2014 your text is never sent anywhere")
          ),
          ...fact("made with", "Inter and JetBrains Mono (SIL OFL) \xB7 Electron \xB7 VS Code icons"),
          ...fact("goes online only for", `a one-time download of each part: the translator for your language, the natural voice (${v.natural.size} MB), word meanings`),
          ...fact(
            "links",
            link(RELEASES, "New versions and what changed"),
            " \xB7 ",
            link("https://github.com/ikstro/krya", "Source on GitHub"),
            " \xB7 ",
            link("https://github.com/ikstro/krya/blob/main/NOTICE", "Licenses")
          )
        )
      )
    ];
  }
  function showTab(tab) {
    if (tab !== "home" && tab !== "howto") return go(tab);
    visited.length = 0;
    closePage();
    fillHeader();
  }
  function start2(v) {
    if (!v.settings.setupDone) return;
    const asked = askedTab && askedTab !== "home" && askedTab !== "howto" ? askedTab : void 0;
    if (askedTranscript) return openTranscript(askedTranscript);
    if (asked) return go(asked);
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
    if (m.type === "openTranscript") {
      if (view) openTranscript(m.id);
      else askedTranscript = m.id, askedTab = "transcripts";
      return;
    }
    if (m.type === "appWindow") return windowState(m.maximized);
    if (m.type !== "app") return;
    const first = view === void 0;
    view = m.view;
    if (m.view.speech.service !== "ready") forgetEngine();
    updateNav();
    if (!m.view.settings.setupDone) {
      closePage();
      if (moment) finishMoment();
      root.classList.add("setup");
      home.classList.add("setup");
      renderSetup();
      return;
    }
    if (root.classList.contains("setup")) {
      root.classList.remove("setup");
      home.classList.remove("setup");
      resetSetup();
      renderHome(true);
      if (!m.view.settings.introSeen) {
        if (reduced.matches) save({ introSeen: true });
        else playMoment(true);
      }
      return;
    }
    renderHome();
    fillHeader();
    renderBody();
    if (first) start2(m.view);
  });
  function renderSetup() {
    if (!view) return;
    home.replaceChildren(...setupNodes(view, { save, post, redraw: renderSetup }));
  }
  window.addEventListener("pointerdown", () => moment && moment.raf && finishMoment(), true);
  window.addEventListener("keydown", (event) => {
    if (moment?.raf) return finishMoment();
    if (event.defaultPrevented) return;
    if (event.key === "Escape" && open) {
      event.preventDefault();
      back();
    }
    if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f" && !document.querySelector(".recording") && !root.classList.contains("setup")) {
      event.preventDefault();
      findField.focus();
      findField.select();
    }
  });
  onRedraw(() => {
    fillHeader();
    renderBody();
  });
  setTranscriptHooks({
    view: () => view,
    shown: () => open?.name === "transcripts",
    show: () => go("transcripts"),
    setup: () => go("transcribe", "speakers")
  });
  post({ type: "appReady" });
})();
