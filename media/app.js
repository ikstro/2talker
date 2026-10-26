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

  // src/webview/keys.ts
  function acceleratorOf(event) {
    const mods = [event.ctrlKey && "Control", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Super"].filter(Boolean);
    const key = event.key;
    if (["Control", "Alt", "Shift", "Meta"].includes(key)) return void 0;
    let name;
    if (/^[a-z]$/i.test(key)) name = key.toUpperCase();
    else if (/^[0-9]$/.test(key)) name = key;
    else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) name = key;
    else if (key === " ") name = "Space";
    else if (["Escape", "Enter", "Tab", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown"].includes(key)) name = key;
    else if (/^Arrow(Up|Down|Left|Right)$/.test(key)) name = key.slice(5);
    else if (/^`~!@#$%^&*()\-_=+\[\]{};:'",.<>\/?\\|$/.test(key) || key.length === 1) name = key;
    else return void 0;
    if (mods.length === 0 && !/^F\d+$/.test(name)) return void 0;
    return [...mods, name].join("+");
  }
  function keyLabel(accelerator) {
    return accelerator.replace(/CommandOrControl|CmdOrCtrl|Control/g, "Ctrl");
  }

  // src/webview/app.ts
  var post = (message) => window.tutorHost.post(message);
  var view;
  var tab = "howto";
  var askedTab;
  var search = "";
  var keyTrouble = "";
  var root = document.getElementById("root");
  var tabs = el("div", { class: "tabs", role: "tablist" });
  var page = el("div", { class: "page" });
  root.append(tabs, page);
  var TABS = [
    ["words", "Words"],
    ["settings", "Settings"],
    ["howto", "How to use"],
    ["about", "About"]
  ];
  function renderTabs() {
    tabs.replaceChildren(
      ...TABS.map(
        ([id, label]) => el("button", { class: "tab", role: "tab", "aria-selected": String(tab === id), onclick: () => show(id) }, label)
      )
    );
  }
  function show(next) {
    tab = next;
    renderTabs();
    render();
  }
  function render() {
    if (!view) return;
    switch (tab) {
      case "words":
        page.replaceChildren(...wordsPage(view));
        return;
      case "settings":
        page.replaceChildren(...settingsPage(view));
        return;
      case "howto":
        page.replaceChildren(...howToPage());
        return;
      case "about":
        page.replaceChildren(...aboutPage(view));
        return;
    }
  }
  function wordsPage(v) {
    const query = search.trim().toLowerCase();
    const words = query ? v.words.filter((w) => `${w.word} ${w.base} ${w.senses.map((s) => s[1]).join(" ")}`.toLowerCase().includes(query)) : v.words;
    const searchBox = el("input", {
      type: "search",
      placeholder: "Search",
      value: search,
      oninput: (event) => {
        search = event.target.value;
        renderList();
      }
    });
    const list = el("div", { class: "word-list" });
    const renderList = () => {
      const q = search.trim().toLowerCase();
      const shown = q ? v.words.filter((w) => `${w.word} ${w.base} ${w.senses.map((s) => s[1]).join(" ")}`.toLowerCase().includes(q)) : v.words;
      list.replaceChildren(...shown.length ? shown.map(wordRow) : [empty(v.words.length ? "No such word." : "No words yet. Click a word in a card and press the bookmark.")]);
    };
    renderList();
    return [
      el(
        "div",
        { class: "toolbar" },
        searchBox,
        el("button", { class: "text-btn", disabled: words.length === 0, onclick: () => post({ type: "exportWords" }) }, "Export for Anki\u2026"),
        el("button", { class: "text-btn", disabled: words.length === 0, onclick: () => post({ type: "copyWords" }) }, "Copy")
      ),
      list
    ];
  }
  function empty(text) {
    return el("div", { class: "empty" }, text);
  }
  function wordRow(w) {
    const form = w.word.toLowerCase() !== w.base ? el("span", { class: "form" }, w.word) : null;
    return el(
      "div",
      { class: "word-row" },
      el("div", {}, el("span", { class: "word" }, w.base), form),
      el(
        "div",
        { class: "senses" },
        ...w.senses.flatMap(([pos, translations], i) => [i ? "; " : "", pos ? el("span", { class: "pos" }, pos + " ") : "", translations])
      ),
      w.sentence ? el("div", { class: "sentence" }, w.sentence) : el("div"),
      el("button", { class: "icon-btn", title: "Remove", "aria-label": "Remove", onclick: () => post({ type: "removeWord", id: w.id }) }, icon("trash"))
    );
  }
  function save(patch) {
    post({ type: "saveSettings", patch });
  }
  function select(value, options, onchange) {
    const node = el("select", {
      onchange: (event) => {
        const raw = event.target.value;
        const picked = options.find(([v]) => String(v) === raw)?.[0];
        if (picked !== void 0) onchange(picked);
      }
    });
    for (const [v, label] of options) {
      const option = el("option", { value: String(v) }, label);
      if (v === value) option.selected = true;
      node.append(option);
    }
    return node;
  }
  function check(label, on, onchange) {
    const box = el("input", { type: "checkbox", onchange: (event) => onchange(event.target.checked) });
    box.checked = on;
    return el("label", { class: "check" }, box, label);
  }
  function row(label, ...controls) {
    return el("div", { class: "row" }, el("label", {}, label), ...controls);
  }
  function voiceOptions(v) {
    const options = [["", "Automatic"]];
    if (v.natural.status === "ready") for (const voice of NATURAL_VOICES) options.push([NATURAL_PREFIX + voice.id, naturalLabel(voice)]);
    for (const h of v.hostVoices) if (/^en\b/i.test(h.lang)) options.push([h.name, h.name]);
    return options;
  }
  function naturalLine(v) {
    const n = v.natural;
    switch (n.status) {
      case "absent":
      case "failed":
        return el(
          "div",
          { class: "row" },
          el("span", { class: "label" }),
          el("button", { class: "text-btn", onclick: () => post({ type: "downloadNatural" }) }, `Download the natural voice \xB7 ${n.size} MB`),
          n.status === "failed" ? el("span", { class: "status bad" }, "The download failed.") : null
        );
      case "downloading":
        return el("div", { class: "row" }, el("span", { class: "label" }), el("span", { class: "status" }, `Downloading the natural voice\u2026 ${Math.round(n.progress * 100)}%`));
      default:
        return null;
    }
  }
  var KEY_USE = { snipKey: "snipping the screen", selectKey: "translating the selection" };
  function keyField(v, name) {
    const current = () => view?.settings[name] ?? "";
    const shown = () => current() ? keyLabel(current()) : "Not set";
    const field = el("input", { type: "text", class: "key-field", readonly: true, value: shown(), title: "Click, then press the keys" });
    field.addEventListener("focus", () => {
      field.classList.add("recording");
      field.value = "Press keys\u2026";
    });
    field.addEventListener("blur", () => {
      field.classList.remove("recording");
      field.value = shown();
    });
    field.addEventListener("keydown", (event) => {
      event.preventDefault();
      if (event.key === "Escape") return field.blur();
      const accelerator = acceleratorOf(event);
      if (!accelerator) return;
      const other = name === "snipKey" ? "selectKey" : "snipKey";
      if (accelerator === v.settings[other]) {
        keyTrouble = `${keyLabel(accelerator)} is already for ${KEY_USE[other]}.`;
        field.blur();
        return render();
      }
      keyTrouble = "";
      save({ [name]: accelerator });
      field.blur();
    });
    const clear = el("button", { class: "icon-btn", title: "Clear", "aria-label": "Clear", disabled: !current(), onclick: () => save({ [name]: "" }) }, icon("close"));
    return [field, clear];
  }
  function takenLine(ok) {
    return ok ? null : el("span", { class: "status bad" }, "Taken by another program; choose another.");
  }
  function updateLine(u, version) {
    const text = (() => {
      switch (u.status) {
        case "dev":
          return "A run from source does not update.";
        case "checking":
          return "Checking\u2026";
        case "none":
          return "This is the latest version.";
        case "downloading":
          return "Downloading an update\u2026";
        case "ready":
          return `Version ${u.version} is ready: it installs when 2Talker quits.`;
        case "failed":
          return `Could not check: ${u.message}`;
        default:
          return "";
      }
    })();
    return [
      row(
        "Version",
        el("span", {}, version),
        el("button", { class: "text-btn", disabled: u.status === "dev" || u.status === "checking" || u.status === "downloading", onclick: () => post({ type: "checkUpdates" }) }, "Check for updates")
      ),
      el("div", { class: "row" }, el("span", { class: "label" }), el("span", { class: `status${u.status === "failed" ? " bad" : ""}` }, text))
    ];
  }
  function settingsPage(v) {
    const s = v.settings;
    return [
      el("h2", {}, "Language and voice"),
      row(
        "Your language",
        select(
          s.native,
          v.languages.map((l) => [l.name, `${l.native} \xB7 ${l.name}`]),
          (native) => save({ native })
        )
      ),
      row("Voice", select(s.voice, voiceOptions(v), (voice) => save({ voice }))),
      naturalLine(v),
      row(
        "Speed",
        select(
          s.rate,
          RATES.map((r) => [r, r === 1 ? "Normal" : `${r}\xD7`]),
          (rate) => save({ rate })
        )
      ),
      row(
        "Theme",
        select(
          s.theme,
          [
            ["system", "As Windows"],
            ["light", "Light"],
            ["dark", "Dark"]
          ],
          (theme) => save({ theme })
        )
      ),
      el("h2", {}, "The card"),
      check("Read aloud when a card opens", s.autoRead, (autoRead) => save({ autoRead })),
      check("Dotted line under less common words", s.rareWords, (rareWords) => save({ rareWords })),
      check("Listen reads one sentence at a time", s.oneAtATime, (oneAtATime) => save({ oneAtATime })),
      row(
        "Word meanings on",
        select(
          s.wordHint,
          [
            ["shift", "click, or Shift + hover"],
            ["hover", "click, or hover"],
            ["off", "click only"]
          ],
          (wordHint) => save({ wordHint })
        )
      ),
      el("h2", {}, "Shortcuts"),
      check("Ctrl + C twice translates the copied text", s.doubleCopy, (doubleCopy) => save({ doubleCopy })),
      row("Translate the selection", ...keyField(v, "selectKey"), takenLine(v.keysOk.select)),
      row("Snip a piece of the screen", ...keyField(v, "snipKey"), takenLine(v.keysOk.snip)),
      keyTrouble ? el("div", { class: "row" }, el("span", { class: "label" }), el("span", { class: "status bad" }, keyTrouble)) : null,
      el("p", { class: "muted hint" }, "The selection shortcut copies the selected text itself: select, press it, and the card opens."),
      el("h2", {}, "Windows"),
      check("Start 2Talker with Windows", s.startWithWindows, (startWithWindows) => save({ startWithWindows })),
      ...updateLine(v.update, v.version)
    ].filter((n) => n !== null);
  }
  function step(name, title, ...text) {
    return el("li", { class: "step" }, icon(name), el("div", {}, el("b", {}, title), ...text));
  }
  function howToPage() {
    const kbd = (k) => el("kbd", {}, k);
    const s = view?.settings;
    const ways = [];
    if (s?.doubleCopy !== false) ways.push(kbd("Ctrl"), " + ", kbd("C"), " twice");
    if (s?.selectKey) ways.push(ways.length ? " or " : "", kbd(keyLabel(s.selectKey)));
    const snipKey = s?.snipKey ?? "Control+Alt+S";
    return [
      el(
        "ol",
        { class: "steps" },
        ways.length ? step("copy", "Any text", "Select it in any program and press ", ...ways, ". A card opens by the pointer.") : step("copy", "Any text", "Turn on Ctrl + C twice, or set a shortcut, in Settings."),
        snipKey ? step("device-camera", "A piece of the screen", "Press ", kbd(keyLabel(snipKey)), " and draw a box over the words. 2Talker reads them from the picture.") : step("device-camera", "A piece of the screen", "Set a shortcut for it in Settings, or snip from the tray menu."),
        step("unmute", "Listen", "The card reads the English aloud at once. Its translation is under it.")
      ),
      el("h2", {}, "Try it here"),
      el("p", { class: "muted" }, "Select the text below, then press ", ...ways.length ? ways : ["the shortcut"], "."),
      el(
        "div",
        { class: "try" },
        "The morning was quiet. A small boat drifted along the river, and two children watched the ducks from the bridge."
      ),
      el("h2", {}, "In the card"),
      el(
        "ul",
        { class: "tips" },
        el("li", {}, "Click a word: its meanings, how to say it, and a star to keep it in Words."),
        el("li", {}, "Click a sentence to see which line is its translation."),
        el("li", {}, kbd("Space"), " plays or stops, ", kbd("\u2190"), " ", kbd("\u2192"), " step through the sentences; ", el("b", {}, "One by one"), " reads a sentence and waits."),
        el("li", {}, "With several paragraphs, the \u25B6 in the margin reads one paragraph."),
        el("li", {}, "The dotted line marks words outside the 3000 most common ones."),
        el("li", {}, "Drag an edge of the card to make it wider or taller; it keeps the size."),
        el("li", {}, "The pin keeps the card open; ", kbd("Esc"), " closes it and stops the voice.")
      )
    ];
  }
  function link(url, text) {
    return el("a", { href: url, onclick: (event) => (event.preventDefault(), post({ type: "openLink", url })) }, text);
  }
  function aboutPage(v) {
    return [
      el(
        "div",
        { class: "about-head" },
        el("img", { src: "icon.png", alt: "", width: 56, height: 56 }),
        el("div", {}, el("div", { class: "about-name" }, "2Talker"), el("div", { class: "muted" }, `Version ${v.version} \xB7 free and open source`))
      ),
      el("p", {}, "Select a text, hear it in English. Translation and voice run on your computer: nothing you read leaves it."),
      el("h2", {}, "Made by"),
      el(
        "div",
        { class: "author" },
        el("div", { class: "about-name" }, "Yevhen Peshynskyi"),
        el("div", { class: "muted" }, "Design automation engineer"),
        el("div", {}, link("https://ikstro.com", "ikstro.com"))
      ),
      el("h2", {}, "Project"),
      el(
        "ul",
        { class: "links" },
        el("li", {}, link("https://github.com/ikstro/2talker", "Source code on GitHub"), " \xB7 MIT License"),
        el("li", {}, link("https://github.com/ikstro/2talker/releases", "Releases and what changed"))
      ),
      el("h2", {}, "Made with"),
      el(
        "ul",
        { class: "tips" },
        el("li", {}, "Firefox Translations by Mozilla: the offline translator."),
        el("li", {}, "Kokoro-82M by hexgrad: the natural voice. eSpeak NG: pronunciation."),
        el("li", {}, "WikDict, from Wiktionary: word meanings."),
        el("li", {}, "FrequencyWords by Hermit Dave: the common words."),
        el("li", {}, "Electron, VS Code icons. ", link("https://github.com/ikstro/2talker/blob/main/NOTICE", "Licenses"))
      )
    ];
  }
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const m = event.data;
    if (m.type === "appTab") {
      if (view) show(m.tab);
      else askedTab = m.tab;
      return;
    }
    if (m.type !== "app") return;
    const first = view === void 0;
    view = m.view;
    if (first) {
      tab = askedTab ?? (m.view.words.length > 0 ? "words" : "howto");
      renderTabs();
    }
    render();
  });
  renderTabs();
  post({ type: "appReady" });
})();
